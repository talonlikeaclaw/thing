//! The filesystem space store: one directory of markdown and YAML files.
//!
//! Every write goes to `<file>.tmp` next to its target, is fsynced, renamed over
//! it, and the directory is fsynced, so no partial file is ever visible.

use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};

use time::OffsetDateTime;
use uuid::Uuid;

/// Creates `path` and missing parents with owner-only permissions, and tightens
/// an existing directory too. `/data` holds password hashes and every record.
pub fn create_private_dir_all(path: &Path) -> std::io::Result<()> {
    // `THING_DATA_DIR=.` is a supported choice; never chmod the working tree.
    if path.as_os_str().is_empty() || path == Path::new(".") {
        return Ok(());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
        fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(path)?;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    }
    #[cfg(not(unix))]
    fs::create_dir_all(path)?;
    Ok(())
}

/// Restricts an existing file to owner read/write. A no-op off Unix and for a
/// path that does not exist (SQLite's `-wal`/`-shm` before they are created).
pub fn restrict_file(path: &Path) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if path.exists() {
            fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
        }
    }
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

use super::{
    FileFingerprint, HISTORY_DIR, OBJECTS_DIR, PROPERTIES_DIR, SPACE_FILE, SpaceFile,
    SpaceFileKind, SpaceStore, TMP_SUFFIX, TRASH_DIR, TYPES_DIR, history_path, key_from_path,
    property_path, remove_property_from_type, rename_property_in_object, rename_property_in_type,
    trash_path, type_path,
};
use crate::error::CoreError;
use crate::markdown;
use crate::model::{
    ObjectDoc, PropertyDef, Revision, RevisionAction, Snapshot, SpaceMeta, TypeDef,
};
use crate::slug::{slugify, unique_slug};

/// A space directory on disk.
#[derive(Debug, Clone)]
pub struct FsSpaceStore {
    root: PathBuf,
}

impl FsSpaceStore {
    /// Creates a space directory and writes its `space.yml`.
    pub fn create(root: impl Into<PathBuf>, meta: &SpaceMeta) -> Result<Self, CoreError> {
        let store = Self { root: root.into() };
        if store.full(Path::new(SPACE_FILE)).exists() {
            return Err(CoreError::AlreadyExists(SPACE_FILE.to_owned()));
        }
        for dir in [
            TYPES_DIR,
            PROPERTIES_DIR,
            OBJECTS_DIR,
            TRASH_DIR,
            HISTORY_DIR,
        ] {
            create_private_dir_all(&store.full(Path::new(dir)))?;
        }
        store.save_space(meta, None)?;
        Ok(store)
    }

    /// Opens a space directory, refusing one whose `space.yml` will not read.
    pub fn open(root: impl Into<PathBuf>) -> Result<Self, CoreError> {
        let store = Self { root: root.into() };
        store.load_space()?;
        Ok(store)
    }

    fn full(&self, relative: &Path) -> PathBuf {
        self.root.join(relative)
    }

    /// Deletes a definition file, `types/<key>.yml` or `properties/<key>.yml`.
    fn remove_definition(&self, relative: &Path) -> Result<(), CoreError> {
        check_relative(relative)?;
        if !self.full(relative).is_file() {
            return Err(CoreError::NotFound(relative.display().to_string()));
        }
        fs::remove_file(self.full(relative))?;
        fsync_dir(self.full(relative).parent())
    }

    /// Writes `contents`, then returns the fingerprint of the renamed file.
    fn write_atomic(&self, relative: &Path, contents: &str) -> Result<FileFingerprint, CoreError> {
        check_relative(relative)?;
        let full = self.full(relative);
        let dir = full.parent().ok_or_else(|| malformed(relative))?;
        create_private_dir_all(dir)?;
        let temp = dir.join(format!("{}{TMP_SUFFIX}", file_name(relative)?));

        // `create_new` refuses a symlink or an existing file at the temp path;
        // remove a leftover from an interrupted write first.
        match fs::remove_file(&temp) {
            Ok(()) => {}
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
            Err(err) => return Err(err.into()),
        }
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)?;
        restrict_file(&temp)?;
        file.write_all(contents.as_bytes())?;
        file.sync_all()?;
        drop(file);

        fs::rename(&temp, &full)?;
        fs::File::open(dir)?.sync_all()?;
        Ok(fingerprint(&full)?.expect("the file was just renamed into place"))
    }

    /// Reads a file and the fingerprint it was read at.
    fn read(&self, relative: &Path) -> Result<(String, FileFingerprint), CoreError> {
        let full = self.full(relative);
        let text = fs::read_to_string(&full).map_err(|err| match err.kind() {
            std::io::ErrorKind::NotFound => CoreError::NotFound(relative.display().to_string()),
            _ => CoreError::Io(err),
        })?;
        let at = fingerprint(&full)?.expect("the file was just read");
        Ok((text, at))
    }

    /// Refuses a write unless the file still looks the way the caller last saw it.
    fn guard(&self, relative: &Path, expected: Option<FileFingerprint>) -> Result<(), CoreError> {
        if fingerprint(&self.full(relative))? == expected {
            Ok(())
        } else {
            Err(CoreError::Conflict {
                reason: "file changed on disk".to_owned(),
            })
        }
    }
}

impl SpaceStore for FsSpaceStore {
    fn space_dir(&self) -> &Path {
        &self.root
    }

    fn list_files(&self) -> Result<Vec<SpaceFile>, CoreError> {
        let mut files = Vec::new();
        if self.full(Path::new(SPACE_FILE)).is_file() {
            files.push(SpaceFile {
                kind: SpaceFileKind::Space,
                path: PathBuf::from(SPACE_FILE),
            });
        }
        collect(
            &mut files,
            &self.full(Path::new(TYPES_DIR)),
            Path::new(TYPES_DIR),
            "yml",
            SpaceFileKind::Type,
        )?;
        collect(
            &mut files,
            &self.full(Path::new(PROPERTIES_DIR)),
            Path::new(PROPERTIES_DIR),
            "yml",
            SpaceFileKind::Property,
        )?;
        collect(
            &mut files,
            &self.full(Path::new(TRASH_DIR)),
            Path::new(TRASH_DIR),
            "md",
            SpaceFileKind::Trash,
        )?;
        collect(
            &mut files,
            &self.full(Path::new(HISTORY_DIR)),
            Path::new(HISTORY_DIR),
            "ndjson",
            SpaceFileKind::History,
        )?;

        let objects = self.full(Path::new(OBJECTS_DIR));
        for type_key in sorted_entries(&objects)? {
            let dir = Path::new(OBJECTS_DIR).join(&type_key);
            collect(
                &mut files,
                &objects.join(&type_key),
                &dir,
                "md",
                SpaceFileKind::Object,
            )?;
        }

        files.sort_by(|left, right| left.path.cmp(&right.path));
        Ok(files)
    }

    fn exists(&self, path: &Path) -> Result<bool, CoreError> {
        check_relative(path)?;
        Ok(self.full(path).exists())
    }

    fn load_space(&self) -> Result<(SpaceMeta, FileFingerprint), CoreError> {
        let (text, at) = self.read(Path::new(SPACE_FILE))?;
        Ok((markdown::parse_space(&text)?, at))
    }

    fn save_space(
        &self,
        meta: &SpaceMeta,
        expected: Option<FileFingerprint>,
    ) -> Result<FileFingerprint, CoreError> {
        let path = Path::new(SPACE_FILE);
        self.guard(path, expected)?;
        self.write_atomic(path, &markdown::serialize_space(meta))
    }

    fn load_type(&self, key: &str) -> Result<(TypeDef, FileFingerprint), CoreError> {
        let path = type_path(check_key(key)?);
        let (text, at) = self.read(&path)?;
        Ok((markdown::parse_type(&text)?, at))
    }

    fn save_type(
        &self,
        def: &TypeDef,
        expected: Option<FileFingerprint>,
    ) -> Result<FileFingerprint, CoreError> {
        let path = type_path(check_key(&def.key)?);
        self.guard(&path, expected)?;
        self.write_atomic(&path, &markdown::serialize_type(def))
    }

    fn remove_type(&self, key: &str) -> Result<(), CoreError> {
        self.remove_definition(&type_path(check_key(key)?))
    }

    fn load_property(&self, key: &str) -> Result<(PropertyDef, FileFingerprint), CoreError> {
        let path = property_path(check_key(key)?);
        let (text, at) = self.read(&path)?;
        Ok((markdown::parse_property(&text)?, at))
    }

    fn save_property(
        &self,
        def: &PropertyDef,
        expected: Option<FileFingerprint>,
    ) -> Result<FileFingerprint, CoreError> {
        let path = property_path(check_key(&def.key)?);
        self.guard(&path, expected)?;
        self.write_atomic(&path, &markdown::serialize_property(def))
    }

    fn load_object(&self, path: &Path) -> Result<(ObjectDoc, FileFingerprint), CoreError> {
        check_relative(path)?;
        let (text, at) = self.read(path)?;
        Ok((markdown::parse_object(&text)?, at))
    }

    fn save_object(
        &self,
        path: &Path,
        doc: &ObjectDoc,
        expected: Option<FileFingerprint>,
    ) -> Result<FileFingerprint, CoreError> {
        check_relative(path)?;
        self.guard(path, expected)?;
        self.write_atomic(path, &markdown::serialize_object(doc))
    }

    fn new_object_path(&self, type_key: &str, title: &str) -> Result<PathBuf, CoreError> {
        let dir = Path::new(OBJECTS_DIR).join(check_key(type_key)?);
        let taken = sorted_entries(&self.full(&dir))?
            .into_iter()
            .filter_map(|name| name.strip_suffix(".md").map(str::to_owned))
            .collect::<Vec<String>>();
        let slug = unique_slug(&slugify(title), taken.iter().map(String::as_str));
        Ok(dir.join(format!("{slug}.md")))
    }

    fn remove_object(
        &self,
        path: &Path,
        expected: Option<FileFingerprint>,
    ) -> Result<(), CoreError> {
        check_relative(path)?;
        self.guard(path, expected)?;
        fs::remove_file(self.full(path))?;
        fsync_dir(self.full(path).parent())
    }

    fn move_to_trash(
        &self,
        path: &Path,
        at: OffsetDateTime,
        expected: Option<FileFingerprint>,
    ) -> Result<FileFingerprint, CoreError> {
        let (mut doc, current) = self.load_object(path)?;
        if expected.is_some() && expected != Some(current) {
            return Err(CoreError::Conflict {
                reason: "file changed on disk".to_owned(),
            });
        }
        let trash = trash_path(doc.id);
        if self.full(&trash).exists() {
            return Err(CoreError::AlreadyExists(trash.display().to_string()));
        }
        doc.trashed_at = Some(at);
        doc.trashed_from = Some(path.display().to_string());

        // Written before the original is removed, so a crash leaves the object
        // in both places rather than in neither.
        let written = self.write_atomic(&trash, &markdown::serialize_object(&doc))?;
        fs::remove_file(self.full(path))?;
        fsync_dir(self.full(path).parent())?;
        Ok(written)
    }

    fn restore(&self, id: Uuid) -> Result<PathBuf, CoreError> {
        let trash = trash_path(id);
        let (mut doc, _) = self.load_object(&trash)?;
        let from = doc
            .trashed_from
            .clone()
            .ok_or_else(|| CoreError::ValidationFailed {
                field: "trashed_from".to_owned(),
                message: "missing from a trashed object".to_owned(),
            })?;
        let from = PathBuf::from(from);
        check_relative(&from)?;
        let target = if self.full(&from).exists() {
            self.new_object_path(&doc.type_key, &doc.title)?
        } else {
            from
        };

        doc.trashed_at = None;
        doc.trashed_from = None;
        self.write_atomic(&target, &markdown::serialize_object(&doc))?;
        fs::remove_file(self.full(&trash))?;
        fsync_dir(self.full(&trash).parent())?;
        Ok(target)
    }

    fn purge(&self, id: Uuid) -> Result<(), CoreError> {
        let trash = trash_path(id);
        if !self.full(&trash).exists() {
            return Err(CoreError::NotFound(trash.display().to_string()));
        }
        fs::remove_file(self.full(&trash))?;
        fsync_dir(self.full(&trash).parent())?;

        let history = history_path(id);
        if self.full(&history).exists() {
            fs::remove_file(self.full(&history))?;
            fsync_dir(self.full(&history).parent())?;
        }
        Ok(())
    }

    fn append_revision(&self, id: Uuid, revision: &Revision) -> Result<(), CoreError> {
        let path = history_path(id);
        let full = self.full(&path);
        create_private_dir_all(full.parent().ok_or_else(|| malformed(&path))?)?;

        let mut line = markdown::serialize_revision(revision);
        line.push('\n');
        let mut file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&full)?;
        restrict_file(&full)?;
        file.write_all(line.as_bytes())?;
        file.sync_all()?;
        Ok(())
    }

    fn rename_property_key(
        &self,
        old: &str,
        new: &str,
        at: OffsetDateTime,
        by: Uuid,
    ) -> Result<(), CoreError> {
        check_key(new)?;
        if old == new {
            return Err(CoreError::ValidationFailed {
                field: "key".to_owned(),
                message: format!("{new} is already the property key"),
            });
        }
        let (mut def, _) = self.load_property(old)?;
        let new_path = property_path(check_key(new)?);
        if self.full(&new_path).exists() {
            return Err(CoreError::AlreadyExists(new_path.display().to_string()));
        }

        // Definition first, then its consumers, then the old file: a crash
        // halfway leaves values under a key whose definition already exists.
        def.key = new.to_owned();
        self.write_atomic(&new_path, &markdown::serialize_property(&def))?;
        for file in self.list_files()? {
            match file.kind {
                SpaceFileKind::Type => {
                    let Some(key) = key_from_path(&file.path) else {
                        continue;
                    };
                    let (mut type_def, at) = self.load_type(key)?;
                    if rename_property_in_type(&mut type_def, old, new) {
                        self.save_type(&type_def, Some(at))?;
                    }
                }
                SpaceFileKind::Object | SpaceFileKind::Trash => {
                    let (mut doc, expected) = self.load_object(&file.path)?;
                    if !rename_property_in_object(&mut doc, old, new) {
                        continue;
                    }
                    // The rewrite is a write like any other: it counts as one.
                    doc.rev += 1;
                    doc.updated_at = at;
                    doc.updated_by = by;
                    self.save_object(&file.path, &doc, Some(expected))?;
                    self.append_revision(
                        doc.id,
                        &Revision {
                            rev: doc.rev,
                            at,
                            by,
                            action: RevisionAction::Update,
                            snapshot: Snapshot {
                                title: doc.title.clone(),
                                properties: doc.properties.clone(),
                            },
                            body: None,
                        },
                    )?;
                }
                SpaceFileKind::Space | SpaceFileKind::Property | SpaceFileKind::History => {}
            }
        }

        let old_path = property_path(check_key(old)?);
        fs::remove_file(self.full(&old_path))?;
        fsync_dir(self.full(&old_path).parent())
    }

    fn remove_property_key(
        &self,
        key: &str,
        at: OffsetDateTime,
        by: Uuid,
    ) -> Result<(), CoreError> {
        // The definition goes first: a crash halfway then leaves values under a
        // key nothing defines, which validation reports, rather than a key that
        // still looks usable while its consumers were already stripped.
        let path = property_path(check_key(key)?);
        self.remove_definition(&path)?;
        for file in self.list_files()? {
            match file.kind {
                SpaceFileKind::Type => {
                    let Some(definition_key) = key_from_path(&file.path) else {
                        continue;
                    };
                    let (mut type_def, expected) = self.load_type(definition_key)?;
                    if remove_property_from_type(&mut type_def, key) {
                        self.save_type(&type_def, Some(expected))?;
                    }
                }
                SpaceFileKind::Object | SpaceFileKind::Trash => {
                    let (mut doc, expected) = self.load_object(&file.path)?;
                    if doc.properties.remove(key).is_none() {
                        continue;
                    }
                    doc.rev += 1;
                    doc.updated_at = at;
                    doc.updated_by = by;
                    self.save_object(&file.path, &doc, Some(expected))?;
                    self.append_revision(
                        doc.id,
                        &Revision {
                            rev: doc.rev,
                            at,
                            by,
                            action: RevisionAction::Update,
                            snapshot: Snapshot {
                                title: doc.title.clone(),
                                properties: doc.properties.clone(),
                            },
                            body: None,
                        },
                    )?;
                }
                SpaceFileKind::Space | SpaceFileKind::Property | SpaceFileKind::History => {}
            }
        }
        Ok(())
    }

    fn read_revisions(&self, id: Uuid) -> Result<Vec<Revision>, CoreError> {
        let path = history_path(id);
        if !self.full(&path).exists() {
            return Ok(Vec::new());
        }
        let (text, _) = self.read(&path)?;
        text.lines().map(markdown::parse_revision).collect()
    }
}

/// Lists `<dir>/*.<extension>`, skipping atomic-write temp files.
fn collect(
    files: &mut Vec<SpaceFile>,
    dir: &Path,
    relative: &Path,
    extension: &str,
    kind: SpaceFileKind,
) -> Result<(), CoreError> {
    for name in sorted_entries(dir)? {
        if name.ends_with(TMP_SUFFIX) || !name.ends_with(extension) {
            continue;
        }
        files.push(SpaceFile {
            kind,
            path: relative.join(name),
        });
    }
    Ok(())
}

/// Entry names in `dir`, sorted; an absent directory lists as empty.
fn sorted_entries(dir: &Path) -> Result<Vec<String>, CoreError> {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(err) => return Err(err.into()),
    };
    let mut names = Vec::new();
    for entry in entries {
        let name = entry?.file_name();
        if let Some(name) = name.to_str() {
            names.push(name.to_owned());
        }
    }
    names.sort();
    Ok(names)
}

fn fingerprint(path: &Path) -> Result<Option<FileFingerprint>, CoreError> {
    match fs::metadata(path) {
        Ok(meta) => Ok(Some(FileFingerprint {
            modified: meta.modified()?,
            len: meta.len(),
        })),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(err.into()),
    }
}

fn fsync_dir(dir: Option<&Path>) -> Result<(), CoreError> {
    if let Some(dir) = dir {
        fs::File::open(dir)?.sync_all()?;
    }
    Ok(())
}

/// Rejects a path that would escape the space directory.
fn check_relative(path: &Path) -> Result<(), CoreError> {
    let escapes = path.is_absolute()
        || path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        });
    if escapes {
        return Err(malformed(path));
    }
    Ok(())
}

/// Rejects a key that could name a file outside its directory.
fn check_key(key: &str) -> Result<&str, CoreError> {
    let plain = !key.is_empty()
        && key != "."
        && key != ".."
        && !key.contains(['/', '\\'])
        && Path::new(key).components().count() == 1;
    if plain {
        Ok(key)
    } else {
        Err(CoreError::ValidationFailed {
            field: "key".to_owned(),
            message: format!("{key:?} is not a plain name"),
        })
    }
}

fn file_name(path: &Path) -> Result<&str, CoreError> {
    path.file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| malformed(path))
}

fn malformed(path: &Path) -> CoreError {
    CoreError::ValidationFailed {
        field: "path".to_owned(),
        message: format!("{} is not a path inside the space", path.display()),
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use tempfile::TempDir;

    use super::*;
    use crate::model::{
        Filter, FilterOp, Member, PropertyFormat, Role, Snapshot, TypeProperty, Value, ViewDef,
    };

    fn id(n: u128) -> Uuid {
        Uuid::from_u128(n)
    }

    fn at(seconds: i64) -> OffsetDateTime {
        OffsetDateTime::from_unix_timestamp(seconds).expect("valid timestamp")
    }

    fn space_meta() -> SpaceMeta {
        SpaceMeta {
            id: id(1),
            name: "Garden".to_owned(),
            icon: Some("🪴".to_owned()),
            timezone: "Europe/Berlin".to_owned(),
            created_at: at(1_760_000_000),
            members: vec![Member {
                user: id(2),
                role: Role::Owner,
            }],
        }
    }

    fn store() -> (TempDir, FsSpaceStore) {
        let dir = TempDir::new().expect("temp dir");
        let store = FsSpaceStore::create(dir.path(), &space_meta()).expect("create space");
        (dir, store)
    }

    fn object(type_key: &str, title: &str) -> ObjectDoc {
        ObjectDoc {
            id: id(9),
            type_key: type_key.to_owned(),
            title: title.to_owned(),
            rev: 1,
            created_at: at(1_760_000_000),
            updated_at: at(1_760_000_000),
            created_by: id(2),
            updated_by: id(2),
            trashed_at: None,
            trashed_from: None,
            properties: BTreeMap::from([("room".to_owned(), Value::Text("kitchen".to_owned()))]),
            body: "\nWatered.\n".to_owned(),
        }
    }

    fn revision(rev: u64) -> Revision {
        Revision {
            rev,
            at: at(1_760_000_000),
            by: id(2),
            action: crate::model::RevisionAction::Update,
            snapshot: Snapshot {
                title: "Monstera".to_owned(),
                properties: BTreeMap::new(),
            },
            body: None,
        }
    }

    #[test]
    fn create_makes_the_documented_layout_and_reads_back() {
        let (dir, store) = store();
        for sub in [
            TYPES_DIR,
            PROPERTIES_DIR,
            OBJECTS_DIR,
            TRASH_DIR,
            HISTORY_DIR,
        ] {
            assert!(dir.path().join(sub).is_dir(), "{sub} missing");
        }
        let space_yml = fs::read_to_string(dir.path().join(SPACE_FILE)).expect("space.yml");
        assert_eq!(space_yml, markdown::serialize_space(&space_meta()));

        let (meta, _) = store.load_space().expect("load");
        assert_eq!(meta, space_meta());
        assert_eq!(
            FsSpaceStore::open(dir.path()).expect("reopen").space_dir(),
            dir.path()
        );
    }

    #[cfg(unix)]
    #[test]
    fn created_files_are_owner_only() {
        use std::os::unix::fs::PermissionsExt;

        fn mode(path: &Path) -> u32 {
            fs::metadata(path).expect("metadata").permissions().mode() & 0o777
        }

        let (dir, store) = store();
        for sub in [
            TYPES_DIR,
            PROPERTIES_DIR,
            OBJECTS_DIR,
            TRASH_DIR,
            HISTORY_DIR,
        ] {
            assert_eq!(mode(&dir.path().join(sub)), 0o700, "{sub}");
        }
        assert_eq!(mode(&dir.path().join(SPACE_FILE)), 0o600);

        let doc = object("plant", "Monstera in the study");
        let path = store
            .new_object_path("plant", &doc.title)
            .expect("a new object path");
        store.save_object(&path, &doc, None).expect("save");
        assert_eq!(mode(&dir.path().join(&path)), 0o600);

        store
            .append_revision(doc.id, &revision(1))
            .expect("a revision");
        assert_eq!(mode(&dir.path().join(history_path(doc.id))), 0o600);
    }

    #[test]
    fn create_refuses_an_existing_space() {
        let (dir, _) = store();
        let err = FsSpaceStore::create(dir.path(), &space_meta()).expect_err("second create");
        assert_eq!(err.to_string(), "space.yml already exists");
        assert!(FsSpaceStore::open(TempDir::new().expect("temp").path()).is_err());
    }

    #[test]
    fn object_bytes_land_on_disk_unchanged_and_leave_no_temp_file() {
        let (dir, store) = store();
        let doc = object("plant", "Monstera in the study");
        let path = store
            .new_object_path("plant", &doc.title)
            .expect("path for a new object");
        assert_eq!(
            path,
            PathBuf::from("objects/plant/monstera-in-the-study.md")
        );

        store.save_object(&path, &doc, None).expect("save");
        let written = fs::read_to_string(dir.path().join(&path)).expect("read back");
        assert_eq!(written, markdown::serialize_object(&doc));

        let mut names: Vec<String> = fs::read_dir(dir.path().join("objects/plant"))
            .expect("objects dir")
            .map(|entry| {
                entry
                    .expect("entry")
                    .file_name()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        names.sort();
        assert_eq!(names, vec!["monstera-in-the-study.md"]);

        let (loaded, _) = store.load_object(&path).expect("load");
        assert_eq!(loaded, doc);
    }

    #[test]
    fn new_object_path_avoids_taken_slugs() {
        let (_dir, store) = store();
        let first = store.new_object_path("plant", "Monstera").expect("first");
        store
            .save_object(&first, &object("plant", "Monstera"), None)
            .expect("save first");
        let second = store.new_object_path("plant", "Monstera").expect("second");
        assert_eq!(first, PathBuf::from("objects/plant/monstera.md"));
        assert_eq!(second, PathBuf::from("objects/plant/monstera-2.md"));
    }

    fn room_property(key: &str) -> PropertyDef {
        PropertyDef {
            key: key.to_owned(),
            name: "Room".to_owned(),
            format: PropertyFormat::Text,
            options: Vec::new(),
            target_type: None,
            multi: false,
        }
    }

    #[test]
    fn removing_an_object_leaves_its_history_behind() {
        let (dir, store) = store();
        let path = store.new_object_path("plant", "Old title").expect("path");
        let saved = store
            .save_object(&path, &object("plant", "Old title"), None)
            .expect("save");
        store.append_revision(id(9), &revision(1)).expect("history");

        let stale = FileFingerprint {
            modified: std::time::SystemTime::UNIX_EPOCH,
            len: 0,
        };
        assert!(matches!(
            store.remove_object(&path, Some(stale)),
            Err(CoreError::Conflict { .. })
        ));

        store.remove_object(&path, Some(saved)).expect("remove");
        assert!(!dir.path().join(&path).exists());
        assert!(
            dir.path()
                .join(format!("history/{}.ndjson", id(9)))
                .exists(),
            "a retitle keeps the object's history"
        );
    }

    fn plant_type() -> TypeDef {
        TypeDef {
            key: "plant".to_owned(),
            name: "Plant".to_owned(),
            name_plural: "Plants".to_owned(),
            icon: None,
            description: String::new(),
            properties: vec![
                TypeProperty {
                    key: "room".to_owned(),
                    required: false,
                    featured: true,
                },
                TypeProperty {
                    key: "notes".to_owned(),
                    required: false,
                    featured: false,
                },
            ],
            view: ViewDef {
                sorts: vec![crate::model::Sort {
                    property: "room".to_owned(),
                    direction: crate::model::Direction::Asc,
                    empty: crate::model::EmptyPlacement::End,
                }],
                filter: Filter {
                    op: FilterOp::And,
                    conditions: vec![crate::model::Condition {
                        property: "room".to_owned(),
                        condition: crate::model::CondOp::NotEqual,
                        value: Some(Value::Text("attic".to_owned())),
                    }],
                },
                columns: vec!["title".to_owned(), "room".to_owned()],
            },
        }
    }

    #[test]
    fn renaming_a_property_key_rewrites_its_consumers() {
        let (dir, store) = store();
        store
            .save_property(&room_property("room"), None)
            .expect("property");
        store.save_type(&plant_type(), None).expect("type");
        let path = store.new_object_path("plant", "Monstera").expect("path");
        store
            .save_object(&path, &object("plant", "Monstera"), None)
            .expect("object");
        store
            .append_revision(id(9), &revision(1))
            .expect("history file");

        // A second object, trashed, so the rewrite has to reach trash/ too.
        let mut gone = object("plant", "Ficus");
        gone.id = id(10);
        let gone_path = store
            .new_object_path("plant", "Ficus")
            .expect("second path");
        store
            .save_object(&gone_path, &gone, None)
            .expect("second object");
        store
            .move_to_trash(&gone_path, at(1_760_100_000), None)
            .expect("trash");

        let renamed_at = at(1_760_200_000);
        store
            .rename_property_key("room", "space", renamed_at, id(2))
            .expect("rename");

        assert!(!dir.path().join("properties/room.yml").exists());
        let (def, _) = store.load_property("space").expect("renamed property");
        assert_eq!(def.key, "space");

        let (plant, _) = store.load_type("plant").expect("type");
        assert_eq!(
            plant
                .properties
                .iter()
                .map(|member| member.key.as_str())
                .collect::<Vec<_>>(),
            vec!["space", "notes"]
        );
        assert_eq!(plant.view.columns, vec!["title", "space"]);
        assert_eq!(plant.view.sorts[0].property, "space");
        assert_eq!(plant.view.filter.conditions[0].property, "space");

        for (path, expected) in [
            (path.clone(), "objects/plant/monstera.md"),
            (PathBuf::from(format!("trash/{}.md", id(10))), "trash"),
        ] {
            let (doc, _) = store.load_object(&path).expect("object after rename");
            assert_eq!(
                doc.properties.get("space"),
                Some(&Value::Text("kitchen".to_owned())),
                "{expected}"
            );
            assert_eq!(doc.properties.get("room"), None, "{expected}");
        }

        // History keeps the keys it recorded at the time, and the rewrite itself
        // counts as a write: the object's rev moved and a line was appended.
        let (plant_doc, _) = store.load_object(&path).expect("object after rename");
        assert_eq!(plant_doc.rev, 2);
        assert_eq!(plant_doc.updated_at, renamed_at);
        let update = markdown::serialize_revision(&Revision {
            rev: 2,
            at: renamed_at,
            by: id(2),
            action: RevisionAction::Update,
            snapshot: Snapshot {
                title: "Monstera".to_owned(),
                properties: BTreeMap::from([(
                    "space".to_owned(),
                    Value::Text("kitchen".to_owned()),
                )]),
            },
            body: None,
        });
        let history = fs::read_to_string(dir.path().join(format!("history/{}.ndjson", id(9))))
            .expect("history");
        assert_eq!(
            history,
            format!("{}\n{update}\n", markdown::serialize_revision(&revision(1)))
        );
    }

    #[test]
    fn removing_a_property_key_strips_its_consumers_and_deletes_the_definition() {
        let (dir, store) = store();
        store
            .save_property(&room_property("room"), None)
            .expect("property");
        store.save_type(&plant_type(), None).expect("type");
        let path = store.new_object_path("plant", "Monstera").expect("path");
        store
            .save_object(&path, &object("plant", "Monstera"), None)
            .expect("object");

        let removed_at = at(1_760_300_000);
        store
            .remove_property_key("room", removed_at, id(2))
            .expect("remove");

        assert!(!dir.path().join("properties/room.yml").exists());
        let (plant, _) = store.load_type("plant").expect("type");
        assert_eq!(
            plant
                .properties
                .iter()
                .map(|member| member.key.as_str())
                .collect::<Vec<_>>(),
            vec!["notes"]
        );
        assert_eq!(plant.view.columns, vec!["title"]);
        assert!(plant.view.sorts.is_empty());
        assert!(plant.view.filter.conditions.is_empty());

        let (doc, _) = store.load_object(&path).expect("object");
        assert_eq!(doc.properties.get("room"), None);
        assert_eq!(doc.rev, 2);
        assert_eq!(doc.updated_at, removed_at);

        // The value it dropped stays readable: the revision records it.
        let history = fs::read_to_string(dir.path().join(format!("history/{}.ndjson", id(9))))
            .expect("history");
        let recorded = crate::markdown::parse_revision(history.trim()).expect("revision");
        assert_eq!(recorded.rev, 2);
        assert_eq!(recorded.action, RevisionAction::Update);
        assert_eq!(recorded.snapshot.title, "Monstera");
        assert!(recorded.snapshot.properties.is_empty());

        assert_eq!(
            store
                .remove_property_key("room", removed_at, id(2))
                .expect_err("a second removal")
                .to_string(),
            "properties/room.yml not found"
        );
    }

    #[test]
    fn removing_a_type_deletes_its_definition_and_leaves_its_objects_alone() {
        let (dir, store) = store();
        store.save_type(&plant_type(), None).expect("type");
        let path = store.new_object_path("plant", "Monstera").expect("path");
        store
            .save_object(&path, &object("plant", "Monstera"), None)
            .expect("object");

        store.remove_type("plant").expect("remove");
        assert!(!dir.path().join("types/plant.yml").exists());
        assert!(
            dir.path().join(&path).exists(),
            "moving the objects is the caller's decision"
        );
        assert_eq!(
            store.remove_type("plant").expect_err("twice").to_string(),
            "types/plant.yml not found"
        );
    }

    #[test]
    fn renaming_a_property_key_refuses_a_missing_or_taken_name() {
        let (_dir, store) = store();
        store
            .save_property(&room_property("room"), None)
            .expect("property");
        store
            .save_property(&room_property("attic"), None)
            .expect("second");

        for (old, new, expected) in [
            ("ghost", "space", "properties/ghost.yml not found"),
            ("room", "attic", "properties/attic.yml already exists"),
            (
                "room",
                "room",
                "invalid key: room is already the property key",
            ),
            (
                "room",
                "../escape",
                "invalid key: \"../escape\" is not a plain name",
            ),
        ] {
            assert_eq!(
                store
                    .rename_property_key(old, new, at(1_760_200_000), id(2))
                    .expect_err("{old} to {new}")
                    .to_string(),
                expected
            );
        }
    }

    #[test]
    fn a_stale_fingerprint_conflicts_instead_of_overwriting() {
        let (dir, store) = store();
        let path = store.new_object_path("plant", "Monstera").expect("path");
        let doc = object("plant", "Monstera");
        let stale = store.save_object(&path, &doc, None).expect("first save");

        let err = store
            .save_object(&path, &doc, None)
            .expect_err("create over an existing file");
        assert_eq!(err.to_string(), "conflict: file changed on disk");

        let mut edited = doc.clone();
        edited.title = "Someone else's edit".to_owned();
        store
            .save_object(&path, &edited, Some(stale))
            .expect("matching fingerprint");
        assert!(dir.path().join(&path).exists());

        let err = store
            .save_object(&path, &doc, Some(stale))
            .expect_err("stale fingerprint");
        assert_eq!(err.to_string(), "conflict: file changed on disk");
    }

    #[test]
    fn trash_restore_and_purge_keep_the_object_recoverable() {
        let (dir, store) = store();
        let path = store.new_object_path("plant", "Monstera").expect("path");
        let doc = object("plant", "Monstera");
        store.save_object(&path, &doc, None).expect("save");

        let trash_name = format!("trash/{}.md", id(9));
        let trashed = store
            .move_to_trash(&path, at(1_760_100_000), None)
            .expect("trash");
        assert_eq!(
            trashed.len,
            fs::metadata(dir.path().join(&trash_name))
                .expect("trash file")
                .len()
        );
        assert!(!dir.path().join(&path).exists(), "the object file is gone");

        let (in_trash, _) = store
            .load_object(Path::new(&trash_name))
            .expect("load trash");
        assert_eq!(
            in_trash.trashed_from.as_deref(),
            Some("objects/plant/monstera.md")
        );
        assert_eq!(in_trash.trashed_at, Some(at(1_760_100_000)));
        assert_eq!(in_trash.rev, doc.rev, "trashing does not bump rev");

        let restored = store.restore(id(9)).expect("restore");
        assert_eq!(restored, path);
        let (back, _) = store.load_object(&restored).expect("load restored");
        assert_eq!(back.trashed_at, None);
        assert_eq!(back.trashed_from, None);
        assert_eq!(back.rev, doc.rev);
        assert!(back.body.contains("Watered"));
        assert!(!dir.path().join(&trash_name).exists(), "trash file removed");

        store
            .move_to_trash(&restored, at(1_760_200_000), None)
            .expect("trash again");
        store.append_revision(id(9), &revision(1)).expect("history");
        store.purge(id(9)).expect("purge");
        assert!(!dir.path().join(&trash_name).exists());
        assert!(
            !dir.path()
                .join(format!("history/{}.ndjson", id(9)))
                .exists()
        );
        assert_eq!(
            store.purge(id(9)).expect_err("purging twice").to_string(),
            format!("{trash_name} not found")
        );
    }

    #[test]
    fn restore_re_slugs_when_the_old_path_is_taken() {
        let (_dir, store) = store();
        let path = store.new_object_path("plant", "Monstera").expect("path");
        store
            .save_object(&path, &object("plant", "Monstera"), None)
            .expect("save");
        store
            .move_to_trash(&path, at(1_760_100_000), None)
            .expect("trash");

        let mut squatter = object("plant", "Monstera");
        squatter.id = id(10);
        store
            .save_object(&path, &squatter, None)
            .expect("another object takes the path");

        let restored = store.restore(id(9)).expect("restore");
        assert_eq!(restored, PathBuf::from("objects/plant/monstera-2.md"));
        assert_eq!(
            store.load_object(&path).expect("the other object").0.id,
            id(10),
            "the squatter keeps the original path"
        );
    }

    #[test]
    fn revisions_append_and_read_back_in_order() {
        let (dir, store) = store();
        assert_eq!(
            store.read_revisions(id(9)).expect("no history yet"),
            Vec::new()
        );

        store.append_revision(id(9), &revision(1)).expect("first");
        store.append_revision(id(9), &revision(2)).expect("second");

        let bytes = fs::read_to_string(dir.path().join(format!("history/{}.ndjson", id(9))))
            .expect("history");
        let expected: String = [revision(1), revision(2)]
            .iter()
            .map(|rev| format!("{}\n", markdown::serialize_revision(rev)))
            .collect();
        assert_eq!(bytes, expected, "append-only, one JSON object per line");

        assert_eq!(
            store.read_revisions(id(9)).expect("read"),
            vec![revision(1), revision(2)]
        );
    }

    #[test]
    fn types_and_properties_round_trip_through_the_store() {
        let (dir, store) = store();
        let def = TypeDef {
            key: "plant".to_owned(),
            name: "Plant".to_owned(),
            name_plural: "Plants".to_owned(),
            icon: None,
            description: String::new(),
            properties: vec![TypeProperty {
                key: "room".to_owned(),
                required: false,
                featured: true,
            }],
            view: ViewDef {
                sorts: Vec::new(),
                filter: Filter {
                    op: FilterOp::And,
                    conditions: Vec::new(),
                },
                columns: vec!["title".to_owned()],
            },
        };
        store.save_type(&def, None).expect("save type");
        assert_eq!(
            fs::read_to_string(dir.path().join("types/plant.yml")).expect("type file"),
            markdown::serialize_type(&def)
        );
        assert_eq!(store.load_type("plant").expect("load type").0, def);

        let property = PropertyDef {
            key: "status".to_owned(),
            name: "Status".to_owned(),
            format: PropertyFormat::Select,
            options: Vec::new(),
            target_type: None,
            multi: false,
        };
        store.save_property(&property, None).expect("save property");
        assert_eq!(
            store.load_property("status").expect("load property").0,
            property
        );
        assert!(matches!(
            store.load_type("missing").expect_err("missing type"),
            CoreError::NotFound(_)
        ));
    }

    #[test]
    fn list_files_reports_every_canonical_file() {
        let (_dir, store) = store();
        let doc = object("plant", "Monstera");
        let trashed_path = store.new_object_path("plant", &doc.title).expect("path");
        store.save_object(&trashed_path, &doc, None).expect("save");

        let mut live = object("plant", "Fern");
        live.id = id(10);
        let live_path = store
            .new_object_path("plant", &live.title)
            .expect("path for a second object");
        store.save_object(&live_path, &live, None).expect("save");

        store
            .move_to_trash(&trashed_path, at(1_760_100_000), None)
            .expect("trash");
        store.append_revision(id(9), &revision(1)).expect("history");

        let listed: Vec<(SpaceFileKind, String)> = store
            .list_files()
            .expect("list")
            .iter()
            .map(|file| (file.kind, file.path.display().to_string()))
            .collect();
        assert_eq!(
            listed,
            vec![
                (SpaceFileKind::History, format!("history/{}.ndjson", id(9))),
                (SpaceFileKind::Object, "objects/plant/fern.md".to_owned()),
                (SpaceFileKind::Space, SPACE_FILE.to_owned()),
                (SpaceFileKind::Trash, format!("trash/{}.md", id(9))),
            ],
            "every canonical file once, sorted by path"
        );
    }

    #[test]
    fn paths_outside_the_space_are_refused() {
        let (_dir, store) = store();
        let doc = object("plant", "Monstera");
        for path in [
            Path::new("../escape.md"),
            Path::new("objects/../../escape.md"),
            Path::new("/etc/passwd"),
        ] {
            assert!(
                matches!(
                    store.save_object(path, &doc, None),
                    Err(CoreError::ValidationFailed { .. })
                ),
                "{} was not refused",
                path.display()
            );
        }
        for key in ["../plant", "a/b", "", "."] {
            assert!(
                matches!(
                    store.load_type(key),
                    Err(CoreError::ValidationFailed { .. })
                ),
                "{key:?} was not refused"
            );
        }
    }
}
