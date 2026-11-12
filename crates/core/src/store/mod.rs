//! The `SpaceStore` trait: every filesystem operation in one place.
//!
//! Paths are relative to the space directory, which is the same spelling
//! `trashed_from` uses in frontmatter. Each read returns the parsed value plus
//! the [`FileFingerprint`] it was read at; each write takes the fingerprint the
//! caller last saw, so a concurrent edit is a `Conflict` instead of a lost file.

use std::ffi::OsStr;
use std::path::{Component, Path, PathBuf};
use std::time::SystemTime;

use time::OffsetDateTime;
use uuid::Uuid;

use crate::error::CoreError;
use crate::model::{ObjectDoc, PropertyDef, Revision, SpaceMeta, TypeDef};

pub mod fs;

/// `space.yml`: the file that makes a directory a space.
pub const SPACE_FILE: &str = "space.yml";
/// Types, one `<key>.yml` per type.
pub const TYPES_DIR: &str = "types";
/// Properties, one `<key>.yml` per property.
pub const PROPERTIES_DIR: &str = "properties";
/// Live objects, `<type-key>/<slug>.md`.
pub const OBJECTS_DIR: &str = "objects";
/// Trashed objects, `<object-uuid>.md`.
pub const TRASH_DIR: &str = "trash";
/// Revision lines, `<object-uuid>.ndjson`.
pub const HISTORY_DIR: &str = "history";
/// Attachment bytes, `files/<sha256>/<name>`.
pub const FILES_DIR: &str = "files";
/// The derived thumbnail cache, `files/.thumbs/<sha256>-<width>.jpg|png`.
pub const THUMBS_DIR: &str = "files/.thumbs";
/// Where an attachment write stages before its rename into place.
pub const FILES_TMP_DIR: &str = "files/.tmp";
/// Suffix of the temporary file an atomic write renames into place.
pub const TMP_SUFFIX: &str = ".tmp";

/// Length of the sha256 directory name every attachment path carries.
pub const SHA256_HEX_LEN: usize = 64;
/// Longest stored attachment name, extension included.
pub const MAX_FILE_NAME_LEN: usize = 96;
/// Longest stem of a stored attachment name.
pub const MAX_FILE_STEM_LEN: usize = 64;
/// Longest extension of a stored attachment name.
pub const MAX_FILE_EXTENSION_LEN: usize = 8;
/// The only widths a thumbnail is generated at.
pub const THUMB_WIDTHS: [u32; 2] = [256, 512];
/// The extensions an `image` value may carry, as the sniffer writes them.
pub const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "webp", "gif"];

/// What a file under the space directory is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SpaceFileKind {
    Space,
    Type,
    Property,
    Object,
    Trash,
    History,
    Attachment,
    Thumbnail,
}

/// One file under the space directory, with its path relative to the space.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SpaceFile {
    pub kind: SpaceFileKind,
    pub path: PathBuf,
}

/// What a space-relative path names, or `None` when it is not part of the layout.
pub fn classify(path: &Path) -> Option<SpaceFileKind> {
    if path == Path::new(SPACE_FILE) {
        return Some(SpaceFileKind::Space);
    }
    if is_thumbnail_path(path) {
        return Some(SpaceFileKind::Thumbnail);
    }
    if is_file_path(path) {
        return Some(SpaceFileKind::Attachment);
    }
    let parent = path.parent()?;
    let directory = parent.file_name()?.to_str()?;
    let above = parent
        .parent()
        .and_then(Path::file_name)
        .and_then(|name| name.to_str());
    match (above, directory) {
        (None, TYPES_DIR) if has_extension(path, "yml") => Some(SpaceFileKind::Type),
        (None, PROPERTIES_DIR) if has_extension(path, "yml") => Some(SpaceFileKind::Property),
        (None, TRASH_DIR) if has_extension(path, "md") => Some(SpaceFileKind::Trash),
        (None, HISTORY_DIR) if has_extension(path, "ndjson") => Some(SpaceFileKind::History),
        (Some(OBJECTS_DIR), _) if has_extension(path, "md") => Some(SpaceFileKind::Object),
        _ => None,
    }
}

/// The key a `types/<key>.yml` or `properties/<key>.yml` path names.
pub fn key_from_path(path: &Path) -> Option<&str> {
    path.extension()?;
    path.file_stem().and_then(|stem| stem.to_str())
}

/// The relative path of a type's definition, `types/<key>.yml`.
pub fn type_path(key: &str) -> PathBuf {
    Path::new(TYPES_DIR).join(format!("{key}.yml"))
}

/// The relative path of a property's definition, `properties/<key>.yml`.
pub fn property_path(key: &str) -> PathBuf {
    Path::new(PROPERTIES_DIR).join(format!("{key}.yml"))
}

/// The relative path of a trashed object, `trash/<id>.md`.
pub fn trash_path(id: Uuid) -> PathBuf {
    Path::new(TRASH_DIR).join(format!("{id}.md"))
}

/// The relative path of an object's revisions, `history/<id>.ndjson`.
pub fn history_path(id: Uuid) -> PathBuf {
    Path::new(HISTORY_DIR).join(format!("{id}.ndjson"))
}

/// The relative path of attachment bytes, `files/<sha256>/<name>`.
pub fn file_path(hash: &str, name: &str) -> PathBuf {
    Path::new(FILES_DIR).join(hash).join(name)
}

/// The relative path of a cached thumbnail, `files/.thumbs/<sha256>-<width>.<ext>`.
pub fn thumb_path(hash: &str, width: u32, extension: &str) -> PathBuf {
    Path::new(THUMBS_DIR).join(format!("{hash}-{width}.{extension}"))
}

/// Whether `path` is a canonical attachment path, `files/<sha256>/<name>`.
///
/// This is the one spelling a frontmatter value, a route parameter and a stored
/// file share: three components, a lowercase hex digest and a safe name.
pub fn is_file_path(path: &Path) -> bool {
    let mut parts = path.components();
    let files = parts.next();
    let hash = parts.next();
    let name = parts.next();
    let rest = parts.next();
    let canonical = files == Some(Component::Normal(OsStr::new(FILES_DIR))) && rest.is_none();
    let named = match (hash, name) {
        (Some(Component::Normal(hash)), Some(Component::Normal(name))) => {
            hash.to_str().is_some_and(is_hash) && name.to_str().is_some_and(is_file_name)
        }
        _ => false,
    };
    canonical && named
}

/// The hash and name of a canonical attachment path.
pub fn split_file_path(path: &Path) -> Option<(&str, &str)> {
    if !is_file_path(path) {
        return None;
    }
    let mut parts = path.components();
    parts.next()?;
    let hash = parts.next()?.as_os_str().to_str()?;
    let name = parts.next()?.as_os_str().to_str()?;
    Some((hash, name))
}

/// The source hash and width of a cached thumbnail, `files/.thumbs/<hash>-<width>.<ext>`.
pub fn split_thumb_path(path: &Path) -> Option<(&str, u32)> {
    if !is_thumbnail_path(path) {
        return None;
    }
    let name = path.file_name()?.to_str()?;
    let (stem, _extension) = name.rsplit_once('.')?;
    let (hash, width) = stem.rsplit_once('-')?;
    Some((hash, width.parse().ok()?))
}

/// Whether `path` is a canonical attachment path whose extension an `image`
/// value may carry.
pub fn is_image_path(path: &Path) -> bool {
    is_file_path(path)
        && path
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| IMAGE_EXTENSIONS.contains(&extension))
}

/// Every attachment path a markdown body names, in first-mention order.
///
/// A body renders `![alt](files/<sha256>/<name>)`, the same spelling
/// frontmatter carries, so garbage collection and the missing-file report have
/// to see it. Each `files/` occurrence is followed by its `[A-Za-z0-9._/-]` run;
/// a run that is not [`is_file_path`] is prose, not a reference.
pub fn paths_in_body(body: &str) -> Vec<String> {
    let mut paths: Vec<String> = Vec::new();
    let mut cursor = 0;
    while let Some(offset) = body[cursor..].find(FILES_DIR) {
        let start = cursor + offset;
        let after = start + FILES_DIR.len();
        if !body[after..].starts_with('/') {
            // `filesystem` is prose; only the directory opens a path.
            cursor = after;
            continue;
        }
        let name = after + 1;
        let run = body[name..]
            .bytes()
            .position(|byte| !is_body_path_byte(byte))
            .unwrap_or(body.len() - name);
        let token = &body[start..name + run];
        if is_file_path(Path::new(token)) && !paths.iter().any(|known| known == token) {
            paths.push(token.to_owned());
        }
        cursor = name + run;
    }
    paths
}

/// The bytes a `files/` token in prose spans; it ends at the first other one.
fn is_body_path_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'/' | b'-')
}

fn has_extension(path: &Path, extension: &str) -> bool {
    path.extension().is_some_and(|found| found == extension)
}

/// Whether `hash` is a sha256 in the layout's lowercase hex spelling.
fn is_hash(hash: &str) -> bool {
    hash.len() == SHA256_HEX_LEN
        && hash
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

/// Whether `name` is a stored attachment name: a slugged stem and a sniffed
/// extension, `monstera.png`. A name without an extension is refused.
fn is_file_name(name: &str) -> bool {
    if name.len() > MAX_FILE_NAME_LEN {
        return false;
    }
    let Some((stem, extension)) = name.rsplit_once('.') else {
        return false;
    };
    !stem.is_empty()
        && stem.len() <= MAX_FILE_STEM_LEN
        && !stem.starts_with('-')
        && !stem.ends_with('-')
        && !stem.contains("--")
        && stem
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        && !extension.is_empty()
        && extension.len() <= MAX_FILE_EXTENSION_LEN
        && extension
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
}

/// Whether `name` is a cached thumbnail name, `<sha256>-<width>.jpg|png`.
fn is_thumbnail_name(name: &str) -> bool {
    let Some((stem, extension)) = name.rsplit_once('.') else {
        return false;
    };
    if !matches!(extension, "jpg" | "png") {
        return false;
    }
    let Some((hash, width)) = stem.rsplit_once('-') else {
        return false;
    };
    let canonical_width = width.bytes().all(|byte| byte.is_ascii_digit())
        && !width.starts_with('0')
        && width
            .parse::<u32>()
            .is_ok_and(|width| THUMB_WIDTHS.contains(&width));
    is_hash(hash) && canonical_width
}

/// Whether `path` is a cached thumbnail under `files/.thumbs/`.
fn is_thumbnail_path(path: &Path) -> bool {
    path.parent() == Some(Path::new(THUMBS_DIR))
        && path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(is_thumbnail_name)
}

/// Modification time and length of a file, as recorded when it was read.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FileFingerprint {
    pub modified: SystemTime,
    pub len: u64,
}

/// Reads and writes one space directory.
pub trait SpaceStore {
    /// The space directory every path in this trait is relative to.
    fn space_dir(&self) -> &Path;

    /// Every canonical file in the space, sorted by path.
    fn list_files(&self) -> Result<Vec<SpaceFile>, CoreError>;

    /// Whether a space-relative path currently exists.
    fn exists(&self, path: &Path) -> Result<bool, CoreError>;

    fn load_space(&self) -> Result<(SpaceMeta, FileFingerprint), CoreError>;

    /// Writes `space.yml`; `expected` is `None` to require the file be absent.
    fn save_space(
        &self,
        meta: &SpaceMeta,
        expected: Option<FileFingerprint>,
    ) -> Result<FileFingerprint, CoreError>;

    fn load_type(&self, key: &str) -> Result<(TypeDef, FileFingerprint), CoreError>;

    fn save_type(
        &self,
        def: &TypeDef,
        expected: Option<FileFingerprint>,
    ) -> Result<FileFingerprint, CoreError>;

    /// Deletes a type's definition file. Its objects are the caller's problem.
    fn remove_type(&self, key: &str) -> Result<(), CoreError>;

    fn load_property(&self, key: &str) -> Result<(PropertyDef, FileFingerprint), CoreError>;

    fn save_property(
        &self,
        def: &PropertyDef,
        expected: Option<FileFingerprint>,
    ) -> Result<FileFingerprint, CoreError>;

    /// Reads `objects/<type-key>/<slug>.md` or `trash/<uuid>.md`.
    fn load_object(&self, path: &Path) -> Result<(ObjectDoc, FileFingerprint), CoreError>;

    fn save_object(
        &self,
        path: &Path,
        doc: &ObjectDoc,
        expected: Option<FileFingerprint>,
    ) -> Result<FileFingerprint, CoreError>;

    /// An unused object path for a title, `objects/<type-key>/<slug>.md`.
    fn new_object_path(&self, type_key: &str, title: &str) -> Result<PathBuf, CoreError>;

    /// Deletes an object's file, which a retitle leaves behind under its old slug.
    fn remove_object(
        &self,
        path: &Path,
        expected: Option<FileFingerprint>,
    ) -> Result<(), CoreError>;

    /// Moves an object to `trash/<uuid>.md`, stamping `trashed_at`/`trashed_from`.
    fn move_to_trash(
        &self,
        path: &Path,
        at: OffsetDateTime,
        expected: Option<FileFingerprint>,
    ) -> Result<FileFingerprint, CoreError>;

    /// Moves a trashed object back, re-slugging if its old path is taken.
    fn restore(&self, id: Uuid) -> Result<PathBuf, CoreError>;

    /// Deletes a trashed object and its history.
    fn purge(&self, id: Uuid) -> Result<(), CoreError>;

    /// Appends one line to `history/<uuid>.ndjson`, creating it as needed.
    fn append_revision(&self, id: Uuid, revision: &Revision) -> Result<(), CoreError>;

    /// Every revision of an object, oldest first; empty when it has none.
    fn read_revisions(&self, id: Uuid) -> Result<Vec<Revision>, CoreError>;

    /// Reads the bytes of an attachment or a cached thumbnail; the path must be
    /// one of the two grammars under `files/`.
    fn load_attachment(&self, path: &Path) -> Result<Vec<u8>, CoreError>;

    /// Writes attachment or thumbnail bytes atomically, through the staging
    /// directory; `expected` is `None` to require the file be absent, and a
    /// different fingerprint is a `Conflict`.
    fn save_attachment(
        &self,
        path: &Path,
        bytes: &[u8],
        expected: Option<FileFingerprint>,
    ) -> Result<FileFingerprint, CoreError>;

    /// Deletes an attachment or a cached thumbnail file.
    fn remove_attachment(&self, path: &Path) -> Result<(), CoreError>;

    /// Byte length of an attachment or a cached thumbnail, without reading it.
    fn attachment_len(&self, path: &Path) -> Result<u64, CoreError>;

    /// Renames a property key in its definition, in every type that uses it and
    /// in every object that holds a value for it, appending a revision to each
    /// object it rewrote. History keeps the keys it recorded at the time.
    fn rename_property_key(
        &self,
        old: &str,
        new: &str,
        at: OffsetDateTime,
        by: Uuid,
    ) -> Result<(), CoreError>;

    /// Deletes a property's definition and strips its key from every type and
    /// every object, appending a revision to each object it rewrote so the
    /// values it dropped stay readable in history.
    fn remove_property_key(&self, key: &str, at: OffsetDateTime, by: Uuid)
    -> Result<(), CoreError>;
}

/// Rewrites `old` to `new` in a type's property list and every saved view;
/// returns whether anything changed.
pub(crate) fn rename_property_in_type(def: &mut TypeDef, old: &str, new: &str) -> bool {
    let mut changed = false;
    for member in &mut def.properties {
        if member.key == old {
            member.key = new.to_owned();
            changed = true;
        }
    }
    for view in &mut def.views {
        for column in &mut view.columns {
            if column == old {
                *column = new.to_owned();
                changed = true;
            }
        }
        if let Some(width) = view.widths.remove(old) {
            view.widths.insert(new.to_owned(), width);
            changed = true;
        }
        for hidden in &mut view.footer_hidden {
            if hidden == old {
                *hidden = new.to_owned();
                changed = true;
            }
        }
        for sort in &mut view.sorts {
            if sort.property == old {
                sort.property = new.to_owned();
                changed = true;
            }
        }
        for condition in &mut view.filter.conditions {
            if condition.property == old {
                condition.property = new.to_owned();
                changed = true;
            }
        }
        for field in [&mut view.group_by, &mut view.cover, &mut view.date_property] {
            if field.as_deref() == Some(old) {
                *field = Some(new.to_owned());
                changed = true;
            }
        }
    }
    changed
}

/// Moves an object's stored value onto the new key; returns whether it moved.
///
/// An object that already holds `new` is left alone: the rename never drops a
/// value that is already stored, and the leftover old key is then reported as an
/// unknown property rather than lost.
pub(crate) fn rename_property_in_object(doc: &mut ObjectDoc, old: &str, new: &str) -> bool {
    if doc.properties.contains_key(new) {
        return false;
    }
    match doc.properties.remove(old) {
        Some(value) => {
            doc.properties.insert(new.to_owned(), value);
            true
        }
        None => false,
    }
}

/// Drops a key from a type's property list and every saved view; returns
/// whether anything changed.
///
/// Routes guard the structural cases (`group_by`, `date_property`) first; this
/// helper is the one place that knows every field a view may name, so a member
/// removal can never leave a saved query pointing at a dead property.
pub fn remove_property_from_type(def: &mut TypeDef, key: &str) -> bool {
    let mut changed = false;
    if def.properties.iter().any(|member| member.key == key) {
        def.properties.retain(|member| member.key != key);
        changed = true;
    }
    for view in &mut def.views {
        let columns = view.columns.len();
        view.columns.retain(|column| column != key);
        changed |= view.columns.len() != columns;

        changed |= view.widths.remove(key).is_some();

        let hidden = view.footer_hidden.len();
        view.footer_hidden.retain(|entry| entry != key);
        changed |= view.footer_hidden.len() != hidden;

        let sorts = view.sorts.len();
        view.sorts.retain(|sort| sort.property != key);
        changed |= view.sorts.len() != sorts;

        let conditions = view.filter.conditions.len();
        view.filter
            .conditions
            .retain(|condition| condition.property != key);
        changed |= view.filter.conditions.len() != conditions;

        for field in [&mut view.group_by, &mut view.cover, &mut view.date_property] {
            if field.as_deref() == Some(key) {
                *field = None;
                changed = true;
            }
        }
    }
    changed
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use time::OffsetDateTime;

    use super::*;
    use crate::model::{
        CondOp, Condition, Direction, EmptyPlacement, Filter, FilterOp, Sort, TypeProperty, Value,
        ViewDef, ViewKind,
    };

    fn at() -> OffsetDateTime {
        OffsetDateTime::from_unix_timestamp(1_760_000_000).expect("valid timestamp")
    }

    #[test]
    fn classify_names_every_part_of_the_layout() {
        let hash = "0".repeat(SHA256_HEX_LEN);
        for (path, kind) in [
            ("space.yml".to_owned(), SpaceFileKind::Space),
            ("types/plant.yml".to_owned(), SpaceFileKind::Type),
            ("properties/room.yml".to_owned(), SpaceFileKind::Property),
            (
                "objects/plant/monstera.md".to_owned(),
                SpaceFileKind::Object,
            ),
            (
                "trash/0199f2c1-8f3a-7c2e-9b1d-2a4f6e8c0a1b.md".to_owned(),
                SpaceFileKind::Trash,
            ),
            (
                "history/0199f2c1-8f3a-7c2e-9b1d-2a4f6e8c0a1b.ndjson".to_owned(),
                SpaceFileKind::History,
            ),
            (
                format!("files/{hash}/monstera.png"),
                SpaceFileKind::Attachment,
            ),
            (
                format!("files/{hash}/garden-notes-2026.pdf"),
                SpaceFileKind::Attachment,
            ),
            (
                format!("files/.thumbs/{hash}-256.jpg"),
                SpaceFileKind::Thumbnail,
            ),
            (
                format!("files/.thumbs/{hash}-512.png"),
                SpaceFileKind::Thumbnail,
            ),
        ] {
            assert_eq!(classify(Path::new(&path)), Some(kind), "{path}");
        }
    }

    #[test]
    fn classify_refuses_anything_else() {
        for path in [
            "space.yaml",
            "spaces/space.yml",
            "types/plant.yaml",
            "objects/plant/monstera.md.bak",
            "objects/monstera.md",
            "trash/note.txt",
            "notes/todo.md",
            "objects/plant/room.yml",
        ] {
            assert_eq!(classify(Path::new(path)), None, "{path}");
        }
    }

    #[test]
    fn classify_refuses_paths_outside_the_file_grammar() {
        let hash = "0".repeat(SHA256_HEX_LEN);
        for path in [
            "files/monstera.png".to_owned(),
            format!("files/{hash}"),
            format!("files/{hash}/cover.png/extra"),
            format!("files/{}/monstera.png", "0".repeat(SHA256_HEX_LEN - 1)),
            format!("files/{hash}/monstera"),
            format!("files/{hash}/Monstera.png"),
            format!("files/{hash}/bad name.png"),
            format!("files/{hash}/../escape.png"),
            format!("files/.thumbs/{hash}-128.jpg"),
            format!("files/.thumbs/{hash}-256.webp"),
            "files/.tmp/0199f2c1-8f3a-7c2e-9b1d-2a4f6e8c0a1b".to_owned(),
        ] {
            assert_eq!(classify(Path::new(&path)), None, "{path}");
        }
    }

    #[test]
    fn file_paths_are_one_grammar() {
        let hash = "0123456789abcdef".repeat(4);
        let path = file_path(&hash, "monstera.png");
        assert_eq!(
            path,
            Path::new(&format!("files/{hash}/monstera.png")),
            "the path is the frontmatter value"
        );
        assert_eq!(
            split_file_path(&path),
            Some((hash.as_str(), "monstera.png"))
        );
        assert_eq!(
            thumb_path(&hash, 256, "jpg"),
            Path::new(&format!("files/.thumbs/{hash}-256.jpg"))
        );
        assert_eq!(
            split_thumb_path(&thumb_path(&hash, 256, "jpg")),
            Some((hash.as_str(), 256))
        );
        assert_eq!(
            split_thumb_path(&thumb_path(&hash, 512, "png")),
            Some((hash.as_str(), 512))
        );
        assert_eq!(split_thumb_path(&path), None);
        assert!(!is_file_path(&thumb_path(&hash, 512, "png")));
        for path in [
            "../escape.png",
            "/etc/passwd",
            "files/../escape.png",
            "files/0123456789abcdef/monstera.png",
            "files/0123456789abcdef/monstera.png/extra",
            "files/0123456789abcdef/..",
            "files/0123456789abcdef/.",
        ] {
            assert!(!is_file_path(Path::new(path)), "{path}");
            assert_eq!(split_file_path(Path::new(path)), None, "{path}");
        }
    }

    #[test]
    fn key_from_path_strips_only_the_extension() {
        assert_eq!(key_from_path(Path::new("types/plant.yml")), Some("plant"));
        assert_eq!(
            key_from_path(Path::new("properties/room.yml")),
            Some("room")
        );
        // A dotted key keeps its dots on both sides of the read.
        assert_eq!(
            key_from_path(Path::new("types/plant.care.yml")),
            Some("plant.care")
        );
        assert_eq!(key_from_path(Path::new("types")), None);
    }

    fn type_def() -> TypeDef {
        TypeDef {
            key: "plant".to_owned(),
            name: "Plant".to_owned(),
            name_plural: "Plants".to_owned(),
            icon: None,
            description: String::new(),
            schedule: false,
            schedule_labels: Default::default(),
            properties: vec![
                TypeProperty {
                    key: "room".to_owned(),
                    required: true,
                    featured: true,
                },
                TypeProperty {
                    key: "notes".to_owned(),
                    required: false,
                    featured: false,
                },
            ],
            views: vec![
                ViewDef {
                    key: "all".to_owned(),
                    name: "All".to_owned(),
                    kind: ViewKind::Table,
                    sorts: vec![Sort {
                        property: "room".to_owned(),
                        direction: Direction::Asc,
                        empty: EmptyPlacement::End,
                    }],
                    filter: Filter {
                        op: FilterOp::And,
                        conditions: vec![Condition {
                            property: "room".to_owned(),
                            condition: CondOp::Equal,
                            value: Some(Value::Text("kitchen".to_owned())),
                        }],
                    },
                    columns: vec!["title".to_owned(), "room".to_owned()],
                    widths: BTreeMap::from([("title".to_owned(), 240), ("room".to_owned(), 140)]),
                    group_by: None,
                    cover: None,
                    date_property: None,
                    footer: None,
                    footer_hidden: Vec::new(),
                },
                ViewDef {
                    key: "by_room".to_owned(),
                    name: "By room".to_owned(),
                    kind: ViewKind::Board,
                    sorts: Vec::new(),
                    filter: Filter {
                        op: FilterOp::And,
                        conditions: Vec::new(),
                    },
                    columns: vec!["title".to_owned(), "room".to_owned()],
                    widths: BTreeMap::new(),
                    group_by: Some("room".to_owned()),
                    cover: None,
                    date_property: None,
                    footer: None,
                    footer_hidden: Vec::new(),
                },
            ],
            default_view: "all".to_owned(),
        }
    }

    fn object() -> ObjectDoc {
        ObjectDoc {
            id: Uuid::from_u128(9),
            type_key: "plant".to_owned(),
            title: "Monstera".to_owned(),
            icon: None,
            cover: None,
            cover_position: None,
            rev: 1,
            created_at: at(),
            updated_at: at(),
            created_by: Uuid::from_u128(1),
            updated_by: Uuid::from_u128(1),
            trashed_at: None,
            trashed_from: None,
            properties: BTreeMap::from([("room".to_owned(), Value::Text("kitchen".to_owned()))]),
            body: String::new(),
        }
    }

    #[test]
    fn renaming_a_property_rewrites_every_reference_in_a_type() {
        let mut def = type_def();
        def.views[0].footer_hidden = vec!["room".to_owned(), "title".to_owned()];
        assert!(rename_property_in_type(&mut def, "room", "space"));
        assert_eq!(
            def.properties
                .iter()
                .map(|member| member.key.as_str())
                .collect::<Vec<_>>(),
            vec!["space", "notes"]
        );
        assert_eq!(def.views[0].columns, vec!["title", "space"]);
        assert_eq!(def.views[0].sorts[0].property, "space");
        assert_eq!(def.views[0].filter.conditions[0].property, "space");
        assert_eq!(def.views[0].widths.get("space").copied(), Some(140));
        assert_eq!(def.views[0].footer_hidden, vec!["space", "title"]);
        assert_eq!(def.views[1].columns, vec!["title", "space"]);
        assert_eq!(def.views[1].group_by.as_deref(), Some("space"));
        assert!(!rename_property_in_type(&mut def, "room", "space"));
    }

    #[test]
    fn renaming_a_property_moves_the_stored_value() {
        let mut doc = object();
        assert!(rename_property_in_object(&mut doc, "room", "space"));
        assert_eq!(
            doc.properties.get("space"),
            Some(&Value::Text("kitchen".to_owned()))
        );
        assert_eq!(doc.properties.get("room"), None);
        assert!(!rename_property_in_object(&mut doc, "room", "space"));
    }

    #[test]
    fn removing_a_property_from_a_type_drops_every_reference() {
        let mut def = type_def();
        def.views[0].footer_hidden = vec!["room".to_owned(), "title".to_owned()];
        assert!(remove_property_from_type(&mut def, "room"));
        assert_eq!(
            def.properties
                .iter()
                .map(|member| member.key.as_str())
                .collect::<Vec<_>>(),
            vec!["notes"]
        );
        assert_eq!(def.views[0].columns, vec!["title"]);
        assert!(def.views[0].sorts.is_empty());
        assert!(def.views[0].filter.conditions.is_empty());
        assert_eq!(def.views[0].widths.get("room"), None);
        assert_eq!(def.views[0].widths.get("title").copied(), Some(240));
        assert_eq!(def.views[0].footer_hidden, vec!["title"]);
        assert_eq!(def.views[1].columns, vec!["title"]);
        assert_eq!(def.views[1].group_by, None);
        assert!(!remove_property_from_type(&mut def, "room"));
    }

    #[test]
    fn paths_in_body_names_every_stored_path_once() {
        let first = format!("files/{}/leaf.png", "a".repeat(SHA256_HEX_LEN));
        let second = format!("files/{}/notes.pdf", "b".repeat(SHA256_HEX_LEN));
        let body = format!(
            "![leaf]({first})\n\nA second look: {first}\n\n[notes]: {second}\n\n\
             The filesystem is not a path, and files/ is a directory.\n\n\
             ![bad](files/not-a-hash/leaf.png)\n"
        );

        assert_eq!(paths_in_body(&body), vec![first, second]);
    }

    #[test]
    fn paths_in_body_ignores_prose_that_only_mentions_the_directory() {
        assert!(paths_in_body("No images here; files/ stays a word.").is_empty());
    }

    #[test]
    fn renaming_never_drops_a_value_already_stored_under_the_new_key() {
        let mut doc = object();
        doc.properties
            .insert("space".to_owned(), Value::Text("attic".to_owned()));
        assert!(!rename_property_in_object(&mut doc, "room", "space"));
        assert_eq!(
            doc.properties.get("space"),
            Some(&Value::Text("attic".to_owned()))
        );
        assert_eq!(
            doc.properties.get("room"),
            Some(&Value::Text("kitchen".to_owned())),
            "the value that could not move stays put, and validation reports it"
        );
    }
}
