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
}
