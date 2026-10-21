//! The `SpaceStore` trait: every filesystem operation in one place.
//!
//! Paths are relative to the space directory, which is the same spelling
//! `trashed_from` uses in frontmatter. Each read returns the parsed value plus
//! the [`FileFingerprint`] it was read at; each write takes the fingerprint the
//! caller last saw, so a concurrent edit is a `Conflict` instead of a lost file.

use std::path::{Path, PathBuf};
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
/// Suffix of the temporary file an atomic write renames into place.
pub const TMP_SUFFIX: &str = ".tmp";

/// What a file under the space directory is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SpaceFileKind {
    Space,
    Type,
    Property,
    Object,
    Trash,
    History,
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

fn has_extension(path: &Path, extension: &str) -> bool {
    path.extension().is_some_and(|found| found == extension)
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

/// Rewrites `old` to `new` in a type's property list, view columns, filter and
/// sorts; returns whether anything changed.
pub(crate) fn rename_property_in_type(def: &mut TypeDef, old: &str, new: &str) -> bool {
    let mut changed = false;
    for member in &mut def.properties {
        if member.key == old {
            member.key = new.to_owned();
            changed = true;
        }
    }
    for column in &mut def.view.columns {
        if column == old {
            *column = new.to_owned();
            changed = true;
        }
    }
    for sort in &mut def.view.sorts {
        if sort.property == old {
            sort.property = new.to_owned();
            changed = true;
        }
    }
    for condition in &mut def.view.filter.conditions {
        if condition.property == old {
            condition.property = new.to_owned();
            changed = true;
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

/// Drops a key from a type's property list, view columns, filter and sorts;
/// returns whether anything changed.
pub(crate) fn remove_property_from_type(def: &mut TypeDef, key: &str) -> bool {
    let before = (
        def.properties.len(),
        def.view.columns.len(),
        def.view.sorts.len(),
        def.view.filter.conditions.len(),
    );
    def.properties.retain(|member| member.key != key);
    def.view.columns.retain(|column| column != key);
    def.view.sorts.retain(|sort| sort.property != key);
    def.view
        .filter
        .conditions
        .retain(|condition| condition.property != key);
    before
        != (
            def.properties.len(),
            def.view.columns.len(),
            def.view.sorts.len(),
            def.view.filter.conditions.len(),
        )
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use time::OffsetDateTime;

    use super::*;
    use crate::model::{
        CondOp, Condition, Direction, EmptyPlacement, Filter, FilterOp, Sort, TypeProperty, Value,
        ViewDef,
    };

    fn at() -> OffsetDateTime {
        OffsetDateTime::from_unix_timestamp(1_760_000_000).expect("valid timestamp")
    }

    #[test]
    fn classify_names_every_part_of_the_layout() {
        for (path, kind) in [
            ("space.yml", SpaceFileKind::Space),
            ("types/plant.yml", SpaceFileKind::Type),
            ("properties/room.yml", SpaceFileKind::Property),
            ("objects/plant/monstera.md", SpaceFileKind::Object),
            (
                "trash/0199f2c1-8f3a-7c2e-9b1d-2a4f6e8c0a1b.md",
                SpaceFileKind::Trash,
            ),
            (
                "history/0199f2c1-8f3a-7c2e-9b1d-2a4f6e8c0a1b.ndjson",
                SpaceFileKind::History,
            ),
        ] {
            assert_eq!(classify(Path::new(path)), Some(kind), "{path}");
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
            view: ViewDef {
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
            },
        }
    }

    fn object() -> ObjectDoc {
        ObjectDoc {
            id: Uuid::from_u128(9),
            type_key: "plant".to_owned(),
            title: "Monstera".to_owned(),
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
        assert!(rename_property_in_type(&mut def, "room", "space"));
        assert_eq!(
            def.properties
                .iter()
                .map(|member| member.key.as_str())
                .collect::<Vec<_>>(),
            vec!["space", "notes"]
        );
        assert_eq!(def.view.columns, vec!["title", "space"]);
        assert_eq!(def.view.sorts[0].property, "space");
        assert_eq!(def.view.filter.conditions[0].property, "space");
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
        assert!(remove_property_from_type(&mut def, "room"));
        assert_eq!(
            def.properties
                .iter()
                .map(|member| member.key.as_str())
                .collect::<Vec<_>>(),
            vec!["notes"]
        );
        assert_eq!(def.view.columns, vec!["title"]);
        assert!(def.view.sorts.is_empty());
        assert!(def.view.filter.conditions.is_empty());
        assert!(!remove_property_from_type(&mut def, "room"));
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
