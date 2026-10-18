//! The filesystem space store: one directory of markdown and YAML files.
//!
//! Every write goes to `<file>.tmp` next to its target, is fsynced, renamed over
//! it, and the directory is fsynced, so no partial file is ever visible.

use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};

use time::OffsetDateTime;
use uuid::Uuid;

use super::{FileFingerprint, SpaceFile, SpaceFileKind, SpaceStore};
use crate::error::CoreError;
use crate::markdown;
use crate::model::{ObjectDoc, PropertyDef, Revision, SpaceMeta, TypeDef};
use crate::slug::{slugify, unique_slug};

const SPACE_FILE: &str = "space.yml";
const TYPES_DIR: &str = "types";
const PROPERTIES_DIR: &str = "properties";
const OBJECTS_DIR: &str = "objects";
const TRASH_DIR: &str = "trash";
const HISTORY_DIR: &str = "history";
const TMP_SUFFIX: &str = ".tmp";

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
            fs::create_dir_all(store.full(Path::new(dir)))?;
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

    /// Writes `contents`, then returns the fingerprint of the renamed file.
    fn write_atomic(&self, relative: &Path, contents: &str) -> Result<FileFingerprint, CoreError> {
        let full = self.full(relative);
        let dir = full.parent().ok_or_else(|| malformed(relative))?;
        fs::create_dir_all(dir)?;
        let temp = dir.join(format!("{}{TMP_SUFFIX}", file_name(relative)?));

        let mut file = fs::File::create(&temp)?;
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

    fn history_path(id: Uuid) -> PathBuf {
        Path::new(HISTORY_DIR).join(format!("{id}.ndjson"))
    }

    fn trash_path(id: Uuid) -> PathBuf {
        Path::new(TRASH_DIR).join(format!("{id}.md"))
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
        let path = key_path(TYPES_DIR, key, "yml")?;
        let (text, at) = self.read(&path)?;
        Ok((markdown::parse_type(&text)?, at))
    }

    fn save_type(
        &self,
        def: &TypeDef,
        expected: Option<FileFingerprint>,
    ) -> Result<FileFingerprint, CoreError> {
        let path = key_path(TYPES_DIR, &def.key, "yml")?;
        self.guard(&path, expected)?;
        self.write_atomic(&path, &markdown::serialize_type(def))
    }

    fn load_property(&self, key: &str) -> Result<(PropertyDef, FileFingerprint), CoreError> {
        let path = key_path(PROPERTIES_DIR, key, "yml")?;
        let (text, at) = self.read(&path)?;
        Ok((markdown::parse_property(&text)?, at))
    }

    fn save_property(
        &self,
        def: &PropertyDef,
        expected: Option<FileFingerprint>,
    ) -> Result<FileFingerprint, CoreError> {
        let path = key_path(PROPERTIES_DIR, &def.key, "yml")?;
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
        let trash = Self::trash_path(doc.id);
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
        let trash = Self::trash_path(id);
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
        let trash = Self::trash_path(id);
        if !self.full(&trash).exists() {
            return Err(CoreError::NotFound(trash.display().to_string()));
        }
        fs::remove_file(self.full(&trash))?;
        fsync_dir(self.full(&trash).parent())?;

        let history = Self::history_path(id);
        if self.full(&history).exists() {
            fs::remove_file(self.full(&history))?;
            fsync_dir(self.full(&history).parent())?;
        }
        Ok(())
    }

    fn append_revision(&self, id: Uuid, revision: &Revision) -> Result<(), CoreError> {
        let path = Self::history_path(id);
        let full = self.full(&path);
        fs::create_dir_all(full.parent().ok_or_else(|| malformed(&path))?)?;

        let mut line = markdown::serialize_revision(revision);
        line.push('\n');
        let mut file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&full)?;
        file.write_all(line.as_bytes())?;
        file.sync_all()?;
        Ok(())
    }

    fn read_revisions(&self, id: Uuid) -> Result<Vec<Revision>, CoreError> {
        let path = Self::history_path(id);
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

/// Builds `<dir>/<key>.<extension>`, rejecting a key that is not a plain name.
fn key_path(dir: &str, key: &str, extension: &str) -> Result<PathBuf, CoreError> {
    Ok(Path::new(dir)
        .join(check_key(key)?)
        .with_extension(extension))
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
