//! Attachment bytes: one upload surface and one read surface.
//!
//! The bytes live in the space's own `files/` tree, addressed by their SHA-256.
//! Nothing here parses multipart: the body is the file and the name is a query
//! parameter, so the upload has one field and no parser to jail. The caller is
//! resolved — and the role checked — before the body is read, so an anonymous
//! or viewer request is refused without buffering a file.

use std::fmt::Write;
use std::path::Path as FsPath;

use axum::body::{Body, to_bytes};
use axum::extract::{Path, Request, State};
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::json;
use sha2::{Digest, Sha256};
use thing_core::error::CoreError;
use thing_core::model::Role;
use thing_core::slug::slugify;
use thing_core::store::{MAX_FILE_EXTENSION_LEN, SpaceStore, file_path, is_file_path};

use super::{ApiQuery, space_for, uuid_param};
use crate::auth::Caller;
use crate::error::ApiError;
use crate::state::SharedState;

/// Most bytes one upload may carry; the refusal names this number.
const MAX_UPLOAD_BYTES: usize = 10 * 1024 * 1024;
/// Longest name the client may offer, before it is reduced to its stored form.
const MAX_RAW_NAME_LEN: usize = 255;
/// The content type a stored non-image file is served as.
const GENERIC_MIME: &str = "application/octet-stream";

pub fn routes() -> Router<SharedState> {
    Router::new()
        .route("/api/spaces/{space}/files", post(upload))
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

    Ok((status, Json(body)).into_response())
}

/// `GET /api/spaces/{space}/files/{hash}/{name}` [viewer]
///
/// The canonical pair reconstructs the stored path; anything else is a `404`.
/// An image is inline, every other type is an attachment, and the ETag is the
/// content hash so a repeat read can be answered from the client's cache.
async fn read(
    State(state): State<SharedState>,
    caller: Caller,
    Path((space, hash, name)): Path<(String, String, String)>,
    query: ApiQuery,
) -> Result<Response, ApiError> {
    let space = uuid_param(&space, "space")?;
    query.finish()?;
    let handle = space_for(&state, &caller, space, Role::Viewer)?;

    let path = file_path(&hash, &name);
    if !is_file_path(&path) {
        return Err(ApiError::not_found(format!("file {hash}/{name}")));
    }
    let bytes = handle.store.load_attachment(&path)?;
    let sniffed = sniff(&bytes);
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
        .header(
            header::CACHE_CONTROL,
            "private, max-age=31536000, immutable",
        )
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
