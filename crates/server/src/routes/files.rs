//! Attachment bytes: one upload surface and one read surface.
//!
//! The bytes live in the space's own `files/` tree, addressed by their SHA-256.
//! Nothing here parses multipart: the body is the file and the name is a query
//! parameter, so the upload has one field and no parser to jail. The caller is
//! resolved — and the role checked — before the body is read, so an anonymous
//! or viewer request is refused without buffering a file.

use std::collections::BTreeSet;
use std::fmt::Write;
use std::io::Cursor;
use std::path::Path as FsPath;
use std::path::PathBuf;

use axum::body::{Body, to_bytes};
use axum::extract::{Path, Request, State};
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use image::ImageEncoder;
use image::codecs::jpeg::JpegEncoder;
use image::codecs::png::PngEncoder;
use image::imageops::FilterType;
use image::{ColorType, DynamicImage, ImageDecoder, ImageReader, Limits};
use serde_json::json;
use sha2::{Digest, Sha256};
use thing_core::error::CoreError;
use thing_core::model::Role;
use thing_core::slug::slugify;
use thing_core::store::{
    MAX_FILE_EXTENSION_LEN, SpaceFileKind, SpaceStore, THUMB_WIDTHS, file_path, is_file_path,
    split_file_path, split_thumb_path, thumb_path,
};

use super::{ApiQuery, space_for, uuid_param};
use crate::auth::Caller;
use crate::error::ApiError;
use crate::spaces::SpaceHandle;
use crate::state::SharedState;

/// Most bytes one upload may carry; the refusal names this number.
const MAX_UPLOAD_BYTES: usize = 10 * 1024 * 1024;
/// Longest name the client may offer, before it is reduced to its stored form.
const MAX_RAW_NAME_LEN: usize = 255;
/// The content type a stored non-image file is served as.
const GENERIC_MIME: &str = "application/octet-stream";
/// JPEG quality of an opaque thumbnail; visually faithful at a quarter of the bytes.
const THUMB_QUALITY: u8 = 82;
/// Largest side the thumbnail decoder will accept.
const MAX_IMAGE_SIDE: u32 = 12_000;
/// Largest pixel count the thumbnail decoder will accept (40 megapixels).
const MAX_IMAGE_PIXELS: u64 = 40_000_000;
/// The cache-control every stored byte carries.
const FILE_CACHE_CONTROL: &str = "private, max-age=31536000, immutable";

pub fn routes() -> Router<SharedState> {
    Router::new()
        .route("/api/spaces/{space}/files", post(upload))
        .route("/api/spaces/{space}/files/gc", post(gc))
        .route("/api/spaces/{space}/files/{hash}/{name}", get(read))
}

/// `POST /api/spaces/{space}/files?name=<name>` [editor]
///
/// The raw body is the file. The server hashes it, sniffs its type, reduces the
/// name to its stored form and writes it atomically. The same bytes under the
/// same name are the same path, so a repeat upload is `200` and writes nothing.
async fn upload(
    State(state): State<SharedState>,
    caller: Caller,
    Path(space): Path<String>,
    mut query: ApiQuery,
    request: Request,
) -> Result<Response, ApiError> {
    let space = uuid_param(&space, "space")?;
    let raw_name = query
        .raw("name")
        .ok_or_else(|| ApiError::bad_request("name", "a file name is required"))?;
    query.finish()?;

    // Resolve the caller and the role first: no body is read for a request that
    // cannot write.
    let handle = space_for(&state, &caller, space, Role::Editor)?;
    let name = StoredName::parse(&raw_name)?;

    let claimed = request
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| {
            value
                .split(';')
                .next()
                .unwrap_or("")
                .trim()
                .to_ascii_lowercase()
        });
    if let Some(length) = request
        .headers()
        .get(header::CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
        && length > MAX_UPLOAD_BYTES as u64
    {
        return Err(too_large());
    }

    // The body is read only after the role check. `to_bytes` bounds a chunked
    // body at one byte past the cap, so an oversized upload is refused without
    // ever buffering more than the limit allows.
    let bytes = to_bytes(request.into_body(), MAX_UPLOAD_BYTES + 1)
        .await
        .map_err(|_| too_large())?;
    if bytes.len() > MAX_UPLOAD_BYTES {
        return Err(too_large());
    }

    let sniffed = sniff(&bytes);
    let claims_image = claimed
        .as_deref()
        .is_some_and(|mime| mime.starts_with("image/"));
    if sniffed.is_svg() || name.extension.as_deref() == Some("svg") {
        return Err(unsupported(
            "SVG is not accepted; upload a PNG, JPEG, WebP or GIF image",
        ));
    }
    if claims_image && !sniffed.is_image() {
        return Err(unsupported(
            "the body is not a PNG, JPEG, WebP or GIF image",
        ));
    }

    let stored = name.stored(&sniffed);
    let hash = sha256_hex(&bytes);
    let path = file_path(&hash, &stored);
    let body = json!({
        "path": posix(&path),
        "hash": hash,
        "name": stored,
        "mime": sniffed.mime(),
        "size": bytes.len(),
    });

    let status = match handle.store.exists(&path)? {
        true => {
            ensure_same_bytes(&handle.store, &path, &bytes)?;
            StatusCode::OK
        }
        false => match handle.store.save_attachment(&path, &bytes, None) {
            Ok(_) => StatusCode::CREATED,
            // Another writer won the same path between the check and the write;
            // identical bytes make that the idempotent case, not a conflict.
            Err(CoreError::Conflict { .. }) => {
                ensure_same_bytes(&handle.store, &path, &bytes)?;
                StatusCode::OK
            }
            Err(err) => return Err(err.into()),
        },
    };

    // The index tracks which attachment paths exist, so a record that names this
    // file right after the upload is not reported missing before the watcher runs.
    handle.with_index_mut(|index| index.reload_file(&handle.store, &path))?;

    Ok((status, Json(body)).into_response())
}

/// `POST /api/spaces/{space}/files/gc` [owner]
///
/// Deletes every attachment and derived thumbnail no live or trashed object
/// references. It is the cleanup path for an upload that never reached a
/// record and for bytes whose value a record dropped; an ordinary write never
/// scans the space.
async fn gc(
    State(state): State<SharedState>,
    caller: Caller,
    Path(space): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let space = uuid_param(&space, "space")?;
    let handle = space_for(&state, &caller, space, Role::Owner)?;
    let _guard = handle.write.lock().await;
    let report = collect_garbage(&handle)?;
    tracing::info!(
        space = %space,
        user = %caller.user.id,
        removed = report.removed,
        freed_bytes = report.freed_bytes,
        "files collected"
    );
    Ok(Json(json!({
        "removed": report.removed,
        "freed_bytes": report.freed_bytes,
    })))
}

/// What one garbage collection removed.
pub(super) struct GcReport {
    /// Attachment files removed; a thumbnail is not counted as a file.
    pub removed: usize,
    /// Every byte removed, thumbnails included.
    pub freed_bytes: u64,
}

/// Removes the bytes under `files/` that nothing references.
///
/// The caller holds the space write lock, so the reference set cannot change
/// between the scan and the deletions. A path a trashed object names stays: a
/// restore must find its bytes. A thumbnail goes when no referenced attachment
/// carries its source hash.
pub(super) fn collect_garbage(handle: &SpaceHandle) -> Result<GcReport, ApiError> {
    let (referenced, hashes) = handle.with_index(|index| {
        let referenced = index.referenced_files();
        let hashes: BTreeSet<String> = referenced
            .iter()
            .filter_map(|path| split_file_path(path).map(|(hash, _)| hash.to_owned()))
            .collect();
        (referenced, hashes)
    });

    let mut report = GcReport {
        removed: 0,
        freed_bytes: 0,
    };
    let mut removed: Vec<PathBuf> = Vec::new();
    for file in handle.store.list_files()? {
        let orphaned = match file.kind {
            SpaceFileKind::Attachment => !referenced.contains(&file.path),
            SpaceFileKind::Thumbnail => {
                split_thumb_path(&file.path).is_none_or(|(hash, _)| !hashes.contains(hash))
            }
            _ => continue,
        };
        if !orphaned {
            continue;
        }
        let bytes = match handle.store.attachment_len(&file.path) {
            Ok(bytes) => bytes,
            // Already gone: someone else collected it first, which is the result asked for.
            Err(CoreError::NotFound(_)) => 0,
            Err(err) => return Err(err.into()),
        };
        match handle.store.remove_attachment(&file.path) {
            Ok(()) => {}
            Err(CoreError::NotFound(_)) => continue,
            Err(err) => return Err(err.into()),
        }
        report.freed_bytes = report.freed_bytes.saturating_add(bytes);
        if file.kind == SpaceFileKind::Attachment {
            report.removed += 1;
            removed.push(file.path);
        }
    }

    if !removed.is_empty() {
        handle.with_index_mut(|index| -> Result<(), CoreError> {
            for path in &removed {
                index.reload_file(&handle.store, path)?;
            }
            Ok(())
        })?;
    }
    Ok(report)
}

/// `GET /api/spaces/{space}/files/{hash}/{name}[?w=256|512]` [viewer]
///
/// The canonical pair reconstructs the stored path; anything else is a `404`.
/// An image is inline, every other type is an attachment, and the ETag is the
/// content hash so a repeat read can be answered from the client's cache.
///
/// `?w=` on an image serves a derived thumbnail, generated once into
/// `files/.thumbs/`. Any other width, a non-image, or an image the decoder
/// cannot reduce serves the original bytes with the original ETag instead.
async fn read(
    State(state): State<SharedState>,
    caller: Caller,
    Path((space, hash, name)): Path<(String, String, String)>,
    mut query: ApiQuery,
) -> Result<Response, ApiError> {
    let space = uuid_param(&space, "space")?;
    let requested_width = query.raw("w");
    query.finish()?;
    let handle = space_for(&state, &caller, space, Role::Viewer)?;

    let path = file_path(&hash, &name);
    if !is_file_path(&path) {
        return Err(ApiError::not_found(format!("file {hash}/{name}")));
    }
    let bytes = handle.store.load_attachment(&path)?;
    let sniffed = sniff(&bytes);

    let width = requested_width
        .as_deref()
        .and_then(|raw| raw.parse::<u32>().ok())
        .filter(|width| THUMB_WIDTHS.contains(width));
    if let Some(width) = width
        && sniffed.is_image()
    {
        if let Some(thumbnail) = cached_thumbnail(&handle.store, &hash, width)? {
            return thumbnail_response(thumbnail, &hash, width);
        }
        if let Some(thumbnail) = build_thumbnail(&bytes, width) {
            let cache = thumb_path(&hash, width, thumbnail.extension);
            match handle.store.save_attachment(&cache, &thumbnail.bytes, None) {
                Ok(_) => {}
                // Another reader wrote the same derived bytes first; either
                // copy is correct, so serve the one on disk.
                Err(CoreError::Conflict { .. }) => {
                    if let Some(stored) = cached_thumbnail(&handle.store, &hash, width)? {
                        return thumbnail_response(stored, &hash, width);
                    }
                }
                Err(err) => tracing::warn!(
                    path = %cache.display(),
                    %err,
                    "thumbnail could not be cached"
                ),
            }
            return thumbnail_response(thumbnail, &hash, width);
        }
    }

    original_response(bytes, sniffed, &name, &hash)
}

/// A derived thumbnail, encoded but not necessarily cached.
struct Thumbnail {
    bytes: Vec<u8>,
    extension: &'static str,
}

impl Thumbnail {
    fn mime(&self) -> &'static str {
        match self.extension {
            "png" => "image/png",
            _ => "image/jpeg",
        }
    }
}

/// Reads a cached thumbnail, if one of the two encodings is present.
fn cached_thumbnail(
    store: &impl SpaceStore,
    hash: &str,
    width: u32,
) -> Result<Option<Thumbnail>, ApiError> {
    for extension in ["jpg", "png"] {
        let path = thumb_path(hash, width, extension);
        match store.load_attachment(&path) {
            Ok(bytes) => {
                return Ok(Some(Thumbnail { bytes, extension }));
            }
            Err(CoreError::NotFound(_)) => {}
            Err(err) => return Err(err.into()),
        }
    }
    Ok(None)
}

/// Decodes, orients and scales `bytes` to `width`. `None` means the original is
/// the answer: unreadable bytes, oversized dimensions, an orientation the
/// decoder could not report, or an image already at or below the width (a
/// thumbnail never upscales).
fn build_thumbnail(bytes: &[u8], width: u32) -> Option<Thumbnail> {
    let mut reader = match ImageReader::new(Cursor::new(bytes)).with_guessed_format() {
        Ok(reader) => reader,
        Err(err) => {
            tracing::warn!(%err, "thumbnail skipped: the image header could not be read");
            return None;
        }
    };
    let mut limits = Limits::default();
    limits.max_image_width = Some(MAX_IMAGE_SIDE);
    limits.max_image_height = Some(MAX_IMAGE_SIDE);
    reader.limits(limits);
    let mut decoder = match reader.into_decoder() {
        Ok(decoder) => decoder,
        Err(err) => {
            tracing::warn!(%err, "thumbnail skipped: the image could not be decoded");
            return None;
        }
    };
    let (source_width, source_height) = decoder.dimensions();
    if source_width == 0
        || source_height == 0
        || u64::from(source_width) * u64::from(source_height) > MAX_IMAGE_PIXELS
    {
        tracing::warn!(
            source_width,
            source_height,
            "thumbnail skipped: the image is larger than the decode bounds"
        );
        return None;
    }
    // The orientation is read before any pixels are scaled, so a phone photo is
    // upright in the tile. A decoder that errors here cannot be trusted with the
    // rotation, so the original is served instead of a sideways thumbnail.
    let orientation = match decoder.orientation() {
        Ok(orientation) => orientation,
        Err(err) => {
            tracing::warn!(%err, "thumbnail skipped: the image orientation could not be read");
            return None;
        }
    };
    let mut image = match DynamicImage::from_decoder(decoder) {
        Ok(image) => image,
        Err(err) => {
            tracing::warn!(%err, "thumbnail skipped: the image could not be decoded");
            return None;
        }
    };
    image.apply_orientation(orientation);
    if image.width() <= width {
        return None;
    }
    let resized = image.resize(width, u32::MAX, FilterType::Lanczos3);
    encode_thumbnail(&resized)
}

/// JPEG for an opaque image, PNG when the source carries an alpha channel.
fn encode_thumbnail(image: &DynamicImage) -> Option<Thumbnail> {
    let mut bytes = Vec::new();
    if image.color().has_alpha() {
        let rgba = image.to_rgba8();
        PngEncoder::new(&mut bytes)
            .write_image(
                rgba.as_raw(),
                rgba.width(),
                rgba.height(),
                ColorType::Rgba8.into(),
            )
            .map_err(|err| {
                tracing::warn!(%err, "thumbnail skipped: the image could not be encoded");
            })
            .ok()?;
        Some(Thumbnail {
            bytes,
            extension: "png",
        })
    } else {
        let rgb = image.to_rgb8();
        JpegEncoder::new_with_quality(&mut bytes, THUMB_QUALITY)
            .encode_image(&rgb)
            .map_err(|err| {
                tracing::warn!(%err, "thumbnail skipped: the image could not be encoded");
            })
            .ok()?;
        Some(Thumbnail {
            bytes,
            extension: "jpg",
        })
    }
}

/// A cached thumbnail's response; its ETag names the source hash and the width.
fn thumbnail_response(thumbnail: Thumbnail, hash: &str, width: u32) -> Result<Response, ApiError> {
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, thumbnail.mime())
        .header(header::CONTENT_LENGTH, thumbnail.bytes.len())
        .header(header::ETAG, format!("\"{hash}-{width}\""))
        .header(header::CACHE_CONTROL, FILE_CACHE_CONTROL)
        .header(header::CONTENT_DISPOSITION, "inline")
        .body(Body::from(thumbnail.bytes))
        .map_err(|err| ApiError::internal(err.to_string()))
}

/// The stored bytes themselves, as an inline image or a download.
fn original_response(
    bytes: Vec<u8>,
    sniffed: Sniffed,
    name: &str,
    hash: &str,
) -> Result<Response, ApiError> {
    let disposition = if sniffed.is_image() {
        "inline".to_owned()
    } else {
        format!("attachment; filename=\"{name}\"")
    };
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, sniffed.mime())
        .header(header::CONTENT_LENGTH, bytes.len())
        .header(header::ETAG, format!("\"{hash}\""))
        .header(header::CACHE_CONTROL, FILE_CACHE_CONTROL)
        .header(header::CONTENT_DISPOSITION, disposition)
        .body(Body::from(bytes))
        .map_err(|err| ApiError::internal(err.to_string()))
}

/// The stored form of a client's file name: a slugged stem and an extension.
struct StoredName {
    stem: String,
    extension: Option<String>,
}

impl StoredName {
    /// Reduces `raw` to a name the path grammar accepts, refusing anything that
    /// tries to address a directory. An extension is kept only when it is a
    /// plain lowercase token; a sniffed type replaces it for images.
    fn parse(raw: &str) -> Result<Self, ApiError> {
        let raw = raw.trim();
        if raw.is_empty() {
            return Err(ApiError::bad_request("name", "a file name is required"));
        }
        if raw.len() > MAX_RAW_NAME_LEN {
            return Err(ApiError::bad_request(
                "name",
                format!("keep the file name under {MAX_RAW_NAME_LEN} characters"),
            ));
        }
        if raw == "."
            || raw == ".."
            || raw
                .chars()
                .any(|ch| ch == '/' || ch == '\\' || ch == '\0' || ch.is_control())
        {
            return Err(ApiError::bad_request(
                "name",
                "a file name cannot contain a path",
            ));
        }

        let (stem, extension) = match raw.rsplit_once('.') {
            Some((stem, extension)) => (stem, Some(extension.to_ascii_lowercase())),
            None => (raw, None),
        };
        let stem = if stem.chars().any(|ch| ch.is_ascii_alphanumeric()) {
            slugify(stem)
        } else {
            "file".to_owned()
        };
        let extension = extension.filter(|extension| {
            !extension.is_empty()
                && extension.len() <= MAX_FILE_EXTENSION_LEN
                && extension.bytes().all(|byte| byte.is_ascii_alphanumeric())
        });
        Ok(Self { stem, extension })
    }

    /// The stored name: the sniffed extension for an image, otherwise the
    /// client's extension, otherwise `bin`.
    fn stored(&self, sniffed: &Sniffed) -> String {
        let extension = sniffed
            .extension()
            .map(str::to_owned)
            .or_else(|| self.extension.clone())
            .unwrap_or_else(|| "bin".to_owned());
        format!("{}.{extension}", self.stem)
    }
}

/// What the first bytes of a file say it is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Sniffed {
    Png,
    Jpeg,
    Gif,
    Webp,
    Svg,
    Other,
}

impl Sniffed {
    fn is_image(self) -> bool {
        matches!(self, Self::Png | Self::Jpeg | Self::Gif | Self::Webp)
    }

    fn is_svg(self) -> bool {
        self == Self::Svg
    }

    fn mime(self) -> &'static str {
        match self {
            Self::Png => "image/png",
            Self::Jpeg => "image/jpeg",
            Self::Gif => "image/gif",
            Self::Webp => "image/webp",
            Self::Svg | Self::Other => GENERIC_MIME,
        }
    }

    fn extension(self) -> Option<&'static str> {
        match self {
            Self::Png => Some("png"),
            Self::Jpeg => Some("jpg"),
            Self::Gif => Some("gif"),
            Self::Webp => Some("webp"),
            Self::Svg | Self::Other => None,
        }
    }
}

/// The magic bytes of the four accepted image types, plus the XML shape SVG is
/// refused by. A `Content-Type` is never trusted over this.
fn sniff(bytes: &[u8]) -> Sniffed {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Sniffed::Png;
    }
    if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        return Sniffed::Jpeg;
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Sniffed::Gif;
    }
    if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Sniffed::Webp;
    }
    if looks_like_svg(bytes) {
        return Sniffed::Svg;
    }
    Sniffed::Other
}

/// Whether a document opens as SVG, or as XML whose first 2 KiB names one.
fn looks_like_svg(bytes: &[u8]) -> bool {
    let head = &bytes[..bytes.len().min(2048)];
    let head = head.strip_prefix(b"\xef\xbb\xbf").unwrap_or(head);
    let text = String::from_utf8_lossy(head);
    let text = text
        .trim_start_matches(|ch: char| ch.is_ascii_whitespace())
        .to_ascii_lowercase();
    text.starts_with("<svg")
        || ((text.starts_with("<?xml") || text.starts_with("<!doctype")) && text.contains("<svg"))
}

/// The lowercase hex SHA-256 of `bytes`, the stored path's directory.
fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut hash = String::with_capacity(64);
    for byte in digest {
        let _ = write!(hash, "{byte:02x}");
    }
    hash
}

/// A space-relative path in its frontmatter spelling, always `/`.
fn posix(path: &FsPath) -> String {
    path.iter()
        .map(|part| part.to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

/// The `200` case of an upload: the path already holds exactly these bytes. A
/// different body under a reached path is a conflict, never an overwrite.
fn ensure_same_bytes(store: &impl SpaceStore, path: &FsPath, bytes: &[u8]) -> Result<(), ApiError> {
    match store.load_attachment(path) {
        Ok(current) if current == bytes => Ok(()),
        Ok(_) => Err(ApiError::conflict(
            "the stored file differs from these bytes",
            json!({ "path": posix(path) }),
        )),
        Err(err) => Err(err.into()),
    }
}

fn too_large() -> ApiError {
    ApiError::too_large(format!(
        "a file may be at most {} MiB",
        MAX_UPLOAD_BYTES / (1024 * 1024)
    ))
}

fn unsupported(message: &str) -> ApiError {
    ApiError::unsupported_media_type(message)
}
