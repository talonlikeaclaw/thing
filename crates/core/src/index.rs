//! The whole of one space, held in memory and kept in step with disk.
//!
//! The index is derived state: after a write the caller hands the touched path
//! back through [`SpaceIndex::reload_file`], so what the API serves is what the
//! files say. A file that will not parse is recorded as a problem and left out
//! of the index, never guessed at; the file itself is untouched.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use uuid::Uuid;

use crate::error::CoreError;
use crate::model::{ObjectDetail, ObjectDoc, ObjectSummary, PropertyDef, SpaceMeta, TypeDef};
use crate::slug::slugify;
use crate::store::{self, FileFingerprint, SPACE_FILE, SpaceFileKind, SpaceStore};
use crate::validate::{self, Schema};

/// A file that could not be put into the index.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnparseableFile {
    pub path: PathBuf,
    pub message: String,
}

/// A relation value whose target is not in the space.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DanglingRelation {
    pub object: Uuid,
    /// The file to fix, relative to the space.
    pub path: PathBuf,
    pub property: String,
    pub target: Uuid,
}

/// Objects of one type whose titles slugify to the same file name, so restoring
/// one would have to re-slug it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DuplicateSlug {
    pub type_key: String,
    pub slug: String,
    pub objects: Vec<Uuid>,
}

/// Every kind of file problem a space can have: unparseable, dangling, colliding.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Problems {
    pub unparseable: Vec<UnparseableFile>,
    pub dangling_relations: Vec<DanglingRelation>,
    pub duplicate_slugs: Vec<DuplicateSlug>,
}

/// One space: its schema, its objects, and what could not be loaded.
#[derive(Debug, Clone)]
pub struct SpaceIndex {
    meta: SpaceMeta,
    types: BTreeMap<String, TypeDef>,
    properties: BTreeMap<String, PropertyDef>,
    objects: BTreeMap<Uuid, ObjectDoc>,
    trash: BTreeMap<Uuid, ObjectDoc>,
    /// Where each object lives, live and trashed, so a write can name its file
    /// and a stale fingerprint can be looked up without scanning.
    paths: BTreeMap<Uuid, PathBuf>,
    trash_paths: BTreeMap<Uuid, PathBuf>,
    paths_to_ids: BTreeMap<PathBuf, Uuid>,
    fingerprints: BTreeMap<PathBuf, FileFingerprint>,
    /// Rows per type, in load order; the query engine imposes the shown order.
    summaries: BTreeMap<String, Vec<ObjectSummary>>,
    unparseable: Vec<UnparseableFile>,
}

impl SpaceIndex {
    /// Loads every file of a space. One broken file does not stop the others:
    /// it becomes a problem and the space still opens.
    pub fn rebuild_from_disk<S: SpaceStore + ?Sized>(store: &S) -> Result<Self, CoreError> {
        let (meta, at) = store.load_space()?;
        let mut index = Self {
            meta,
            types: BTreeMap::new(),
            properties: BTreeMap::new(),
            objects: BTreeMap::new(),
            trash: BTreeMap::new(),
            paths: BTreeMap::new(),
            trash_paths: BTreeMap::new(),
            paths_to_ids: BTreeMap::new(),
            fingerprints: BTreeMap::new(),
            summaries: BTreeMap::new(),
            unparseable: Vec::new(),
        };
        index.fingerprints.insert(PathBuf::from(SPACE_FILE), at);
        for file in store.list_files()? {
            index.reload_file(store, &file.path)?;
        }
        Ok(index)
    }

    /// Re-reads one file and updates what it affects; a deleted file removes its
    /// entries instead.
    pub fn reload_file<S: SpaceStore + ?Sized>(
        &mut self,
        store: &S,
        path: &Path,
    ) -> Result<(), CoreError> {
        match store::classify(path) {
            Some(SpaceFileKind::Space) => self.reload_space(store, path),
            Some(SpaceFileKind::Type) => self.reload_type(store, path),
            Some(SpaceFileKind::Property) => self.reload_property(store, path),
            Some(SpaceFileKind::Object | SpaceFileKind::Trash) => self.reload_object(store, path),
            Some(SpaceFileKind::History) | None => Ok(()),
        }
    }

    /// The schema, ready to validate or query against.
    pub fn schema(&self) -> Schema<'_> {
        Schema {
            types: &self.types,
            properties: &self.properties,
            objects: &self.objects,
            trash: &self.trash,
        }
    }

    /// Everything wrong with the files on disk.
    pub fn problems(&self) -> Problems {
        Problems {
            unparseable: self.unparseable.clone(),
            dangling_relations: self.dangling_relations(),
            duplicate_slugs: self.duplicate_slugs(),
        }
    }

    /// The space's own metadata.
    pub fn meta(&self) -> &SpaceMeta {
        &self.meta
    }

    /// Every type the space defines, in key order.
    pub fn types(&self) -> impl Iterator<Item = &TypeDef> {
        self.types.values()
    }

    /// The type with this key, if the space defines it.
    pub fn type_def(&self, key: &str) -> Option<&TypeDef> {
        self.types.get(key)
    }

    /// Every property the space defines, in key order.
    pub fn properties(&self) -> impl Iterator<Item = &PropertyDef> {
        self.properties.values()
    }

    /// The property with this key, if the space defines it.
    pub fn property_def(&self, key: &str) -> Option<&PropertyDef> {
        self.properties.get(key)
    }

    /// The live object with this id; a trashed one is [`SpaceIndex::trash`].
    pub fn object(&self, id: Uuid) -> Option<&ObjectDoc> {
        self.objects.get(&id)
    }

    /// Every live object, in id order.
    pub fn objects(&self) -> impl Iterator<Item = &ObjectDoc> {
        self.objects.values()
    }

    /// Every trashed object, in id order.
    pub fn trash(&self) -> impl Iterator<Item = &ObjectDoc> {
        self.trash.values()
    }

    /// The trashed object with this id, if one is in the trash.
    pub fn trashed(&self, id: Uuid) -> Option<&ObjectDoc> {
        self.trash.get(&id)
    }

    /// The object's file under `objects/`, for a caller that writes it back.
    pub fn object_path(&self, id: Uuid) -> Option<&Path> {
        self.paths.get(&id).map(PathBuf::as_path)
    }

    /// The object's file under `trash/`, for a caller that restores or purges it.
    pub fn trash_path(&self, id: Uuid) -> Option<&Path> {
        self.trash_paths.get(&id).map(PathBuf::as_path)
    }

    /// The fingerprint a file was last read at, which the store's write guard
    /// compares against.
    pub fn fingerprint(&self, path: &Path) -> Option<FileFingerprint> {
        self.fingerprints.get(path).copied()
    }

    /// The rows of one type, in load order.
    pub fn summaries(&self, type_key: &str) -> &[ObjectSummary] {
        self.summaries.get(type_key).map_or(&[], Vec::as_slice)
    }

    /// One live object with its dangling relation targets.
    pub fn detail(&self, id: Uuid) -> Option<ObjectDetail> {
        let object = self.object(id)?.clone();
        let missing_relations = validate::missing_relations(&self.schema(), &object);
        Some(ObjectDetail {
            object,
            missing_relations,
        })
    }

    fn reload_space<S: SpaceStore + ?Sized>(
        &mut self,
        store: &S,
        path: &Path,
    ) -> Result<(), CoreError> {
        let (meta, at) = store.load_space()?;
        self.meta = meta;
        self.fingerprints.insert(path.to_owned(), at);
        Ok(())
    }

    fn reload_type<S: SpaceStore + ?Sized>(
        &mut self,
        store: &S,
        path: &Path,
    ) -> Result<(), CoreError> {
        let Some(key) = store::key_from_path(path) else {
            return Ok(());
        };
        self.clear_problem(path);
        match store.load_type(key) {
            Ok((def, at)) if def.key == key => {
                self.types.insert(key.to_owned(), def);
                self.fingerprints.insert(path.to_owned(), at);
            }
            Ok((def, _)) => {
                // The file name is the key: a mismatch would put one type under
                // two names, so the file is reported rather than indexed.
                self.types.remove(key);
                self.record_problem(path, format!("holds key {}, but is named {key}", def.key));
            }
            Err(CoreError::NotFound(_)) => {
                self.types.remove(key);
                self.forget_fingerprint(path);
            }
            Err(err) => {
                self.types.remove(key);
                self.record_problem(path, err.to_string());
            }
        }
        Ok(())
    }

    fn reload_property<S: SpaceStore + ?Sized>(
        &mut self,
        store: &S,
        path: &Path,
    ) -> Result<(), CoreError> {
        let Some(key) = store::key_from_path(path) else {
            return Ok(());
        };
        self.clear_problem(path);
        match store.load_property(key) {
            Ok((def, at)) if def.key == key => {
                self.properties.insert(key.to_owned(), def);
                self.fingerprints.insert(path.to_owned(), at);
            }
            Ok((def, _)) => {
                self.properties.remove(key);
                self.record_problem(path, format!("holds key {}, but is named {key}", def.key));
            }
            Err(CoreError::NotFound(_)) => {
                self.properties.remove(key);
                self.forget_fingerprint(path);
            }
            Err(err) => {
                self.properties.remove(key);
                self.record_problem(path, err.to_string());
            }
        }
        Ok(())
    }

    fn reload_object<S: SpaceStore + ?Sized>(
        &mut self,
        store: &S,
        path: &Path,
    ) -> Result<(), CoreError> {
        let in_trash = store::classify(path) == Some(SpaceFileKind::Trash);
        // Whatever used this path before is stale, whether the file moved, was
        // retitled into a new file, or is gone.
        self.forget_path(path);
        self.clear_problem(path);

        let (doc, at) = match store.load_object(path) {
            Ok(loaded) => loaded,
            Err(CoreError::NotFound(_)) => return Ok(()),
            Err(err) => {
                self.record_problem(path, err.to_string());
                return Ok(());
            }
        };
        if doc.trashed_at.is_some() != in_trash {
            let message = if in_trash {
                "is in trash/ but has no trashed_at"
            } else {
                "has trashed_at but is not in trash/"
            };
            self.record_problem(path, message);
            return Ok(());
        }
        if let Some(owner) = self
            .paths
            .get(&doc.id)
            .or_else(|| self.trash_paths.get(&doc.id))
            .cloned()
        {
            if store.exists(&owner)? {
                // Two files claiming one identity: keep the first, report the second.
                self.record_problem(path, format!("repeats the id of {}", owner.display()));
                return Ok(());
            }
            // The file moved or was retitled: the old path is gone, so this is
            // the same object under a new name.
            self.forget_path(&owner);
        }

        self.paths_to_ids.insert(path.to_owned(), doc.id);
        self.fingerprints.insert(path.to_owned(), at);
        let summary = ObjectSummary::from(&doc);
        let type_key = doc.type_key.clone();
        if in_trash {
            self.trash_paths.insert(doc.id, path.to_owned());
            self.trash.insert(doc.id, doc);
        } else {
            self.paths.insert(doc.id, path.to_owned());
            self.objects.insert(doc.id, doc);
            self.summaries.entry(type_key).or_default().push(summary);
        }
        Ok(())
    }

    /// Drops every entry that used this path, including the type's row.
    fn forget_path(&mut self, path: &Path) {
        self.forget_fingerprint(path);
        let Some(id) = self.paths_to_ids.remove(path) else {
            return;
        };
        self.paths.remove(&id);
        self.trash_paths.remove(&id);
        let removed = self.objects.remove(&id).or_else(|| self.trash.remove(&id));
        if let Some(doc) = removed
            && let Some(rows) = self.summaries.get_mut(&doc.type_key)
        {
            rows.retain(|row| row.id != id);
            if rows.is_empty() {
                self.summaries.remove(&doc.type_key);
            }
        }
    }

    fn forget_fingerprint(&mut self, path: &Path) {
        self.fingerprints.remove(path);
    }

    fn dangling_relations(&self) -> Vec<DanglingRelation> {
        let schema = self.schema();
        let mut found = Vec::new();
        for (id, doc) in self.objects.iter().chain(self.trash.iter()) {
            let Some(path) = self.paths.get(id).or_else(|| self.trash_paths.get(id)) else {
                continue;
            };
            for (property, target) in validate::dangling_relations(&schema, doc) {
                found.push(DanglingRelation {
                    object: *id,
                    path: path.clone(),
                    property: property.to_owned(),
                    target,
                });
            }
        }
        found.sort_by(|left, right| {
            left.path
                .cmp(&right.path)
                .then_with(|| left.property.cmp(&right.property))
                .then_with(|| left.target.cmp(&right.target))
        });
        found
    }

    fn duplicate_slugs(&self) -> Vec<DuplicateSlug> {
        let mut groups: BTreeMap<(&str, String), Vec<Uuid>> = BTreeMap::new();
        for (id, doc) in &self.objects {
            groups
                .entry((doc.type_key.as_str(), slugify(&doc.title)))
                .or_default()
                .push(*id);
        }
        groups
            .into_iter()
            .filter(|(_, objects)| objects.len() > 1)
            .map(|((type_key, slug), objects)| DuplicateSlug {
                type_key: type_key.to_owned(),
                slug,
                objects,
            })
            .collect()
    }

    /// Records a file that could not be indexed, replacing any earlier note for
    /// the same path; the list stays sorted by path.
    fn record_problem(&mut self, path: &Path, message: impl Into<String>) {
        let entry = UnparseableFile {
            path: path.to_owned(),
            message: message.into(),
        };
        match self
            .unparseable
            .binary_search_by(|other| other.path.cmp(&entry.path))
        {
            Ok(at) => self.unparseable[at] = entry,
            Err(at) => self.unparseable.insert(at, entry),
        }
    }

    fn clear_problem(&mut self, path: &Path) {
        if let Ok(at) = self
            .unparseable
            .binary_search_by(|other| other.path.as_path().cmp(path))
        {
            self.unparseable.remove(at);
        }
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::TempDir;
    use time::OffsetDateTime;

    use super::*;
    use crate::markdown;
    use crate::model::{
        CondOp, Condition, Direction, EmptyPlacement, Filter, FilterOp, Member, PropertyFormat,
        Role, Sort, TypeProperty, Value, ViewDef,
    };
    use crate::query;
    use crate::store::fs::FsSpaceStore;

    fn at(offset: i64) -> OffsetDateTime {
        OffsetDateTime::from_unix_timestamp(1_760_000_000 + offset).expect("valid timestamp")
    }

    fn me() -> Uuid {
        Uuid::from_u128(1)
    }

    fn space_meta() -> SpaceMeta {
        SpaceMeta {
            id: Uuid::from_u128(100),
            name: "Garden".to_owned(),
            icon: None,
            timezone: "Europe/Berlin".to_owned(),
            created_at: at(0),
            members: vec![Member {
                user: me(),
                role: Role::Owner,
            }],
        }
    }

    fn room_property() -> PropertyDef {
        PropertyDef {
            key: "room".to_owned(),
            name: "Room".to_owned(),
            format: PropertyFormat::Text,
            options: Vec::new(),
            target_type: None,
            multi: false,
        }
    }

    fn plant_type() -> TypeDef {
        TypeDef {
            key: "plant".to_owned(),
            name: "Plant".to_owned(),
            name_plural: "Plants".to_owned(),
            icon: None,
            description: String::new(),
            schedule: false,
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
                columns: vec!["title".to_owned(), "room".to_owned()],
            },
        }
    }

    fn object(id: u128, title: &str, room: &str, updated: i64) -> ObjectDoc {
        ObjectDoc {
            id: Uuid::from_u128(id),
            type_key: "plant".to_owned(),
            title: title.to_owned(),
            rev: 1,
            created_at: at(0),
            updated_at: at(updated),
            created_by: me(),
            updated_by: me(),
            trashed_at: None,
            trashed_from: None,
            properties: [("room".to_owned(), Value::Text(room.to_owned()))]
                .into_iter()
                .collect(),
            body: String::new(),
        }
    }

    struct Space {
        dir: TempDir,
        store: FsSpaceStore,
    }

    impl Space {
        fn new() -> Self {
            let dir = TempDir::new().expect("temp dir");
            let store = FsSpaceStore::create(dir.path(), &space_meta()).expect("create space");
            Self { dir, store }
        }

        /// Writes a file verbatim, for hand-authored bytes and broken input.
        fn write(&self, relative: &str, contents: &str) {
            let path = self.dir.path().join(relative);
            fs::create_dir_all(path.parent().expect("parent")).expect("dir");
            fs::write(path, contents).expect("write");
        }

        fn path(&self, relative: &str) -> PathBuf {
            self.dir.path().join(relative)
        }

        /// Writes the type and the property every test starts from.
        fn seed(self) -> Self {
            self.store
                .save_type(&plant_type(), None)
                .expect("save type");
            self.store
                .save_property(&room_property(), None)
                .expect("save property");
            self
        }

        /// Replaces the seeded type the way a caller must: with the fingerprint
        /// it just read.
        fn rewrite_type(&self, def: &TypeDef) {
            let (_, at) = self.store.load_type(&def.key).expect("seeded type");
            self.store.save_type(def, Some(at)).expect("rewrite type");
        }

        fn index(&self) -> SpaceIndex {
            SpaceIndex::rebuild_from_disk(&self.store).expect("rebuild")
        }
    }

    fn object_path(title: &str) -> PathBuf {
        Path::new("objects/plant").join(format!("{}.md", crate::slug::slugify(title)))
    }

    #[test]
    fn rebuild_loads_the_schema_objects_and_processes_every_file() {
        let space = Space::new().seed();
        let doc = object(2, "Monstera", "Kitchen", 5);
        let path = object_path("Monstera");
        space
            .store
            .save_object(&path, &doc, None)
            .expect("save object");
        let mut gone = object(3, "Ficus", "Attic", 6);
        gone.trashed_at = Some(at(9));
        gone.trashed_from = Some(path.display().to_string());
        space
            .store
            .save_object(Path::new("trash/3.md"), &gone, None)
            .expect("save trash");

        let index = space.index();
        assert_eq!(index.meta().name, "Garden");
        assert_eq!(
            index.type_def("plant").map(|def| def.key.as_str()),
            Some("plant")
        );
        assert_eq!(
            index.property_def("room").map(|def| def.key.as_str()),
            Some("room")
        );
        assert_eq!(
            index
                .object(Uuid::from_u128(2))
                .map(|doc| doc.title.as_str()),
            Some("Monstera")
        );
        assert_eq!(index.object_path(Uuid::from_u128(2)), Some(path.as_path()));
        assert_eq!(index.object(Uuid::from_u128(3)), None);
        assert_eq!(
            index.trash_path(Uuid::from_u128(3)),
            Some(Path::new("trash/3.md"))
        );
        assert!(index.fingerprint(&path).is_some());
        assert_eq!(index.summaries("plant").len(), 1);
        assert_eq!(index.summaries("plant")[0].title, "Monstera");
        assert_eq!(
            index.summaries("plant")[0].properties.get("room"),
            Some(&Value::Text("Kitchen".to_owned()))
        );
        assert_eq!(
            index
                .detail(Uuid::from_u128(2))
                .map(|detail| detail.missing_relations),
            Some(Vec::new())
        );
        assert_eq!(index.problems(), Problems::default());
    }

    #[test]
    fn an_unparseable_file_is_reported_and_the_rest_still_loads() {
        let space = Space::new().seed();
        let mut good = object(2, "Monstera", "Kitchen", 5);
        good.body = "Watered.\n".to_owned();
        space
            .store
            .save_object(&object_path("Monstera"), &good, None)
            .expect("save object");
        space.write("objects/plant/broken.md", "no frontmatter at all\n");
        space.write(
            "objects/plant/stray.md",
            "---\nschema: 1\nid: 00000000-0000-0000-0000-000000000009\n\
             type: plant\ntitle: Stray\nrev: 1\ncreated_at: 2026-10-17T12:00:00Z\n\
             updated_at: 2026-10-17T12:00:00Z\ncreated_by: 00000000-0000-0000-0000-000000000001\n\
             updated_by: 00000000-0000-0000-0000-000000000001\nsneaky: yes\n---\n",
        );

        let index = space.index();
        let problems = index.problems();
        assert_eq!(
            problems
                .unparseable
                .iter()
                .map(|file| file.path.display().to_string())
                .collect::<Vec<_>>(),
            vec!["objects/plant/broken.md", "objects/plant/stray.md"]
        );
        assert!(
            problems.unparseable[1].message.contains("sneaky"),
            "the refused key is named: {}",
            problems.unparseable[1].message
        );
        assert_eq!(
            index.object(Uuid::from_u128(2)).map(|doc| doc.body.clone()),
            Some("Watered.\n".to_owned())
        );
        assert_eq!(index.summaries("plant").len(), 1);
    }

    #[test]
    fn a_type_file_must_be_named_after_its_key() {
        let space = Space::new();
        let mut def = plant_type();
        def.key = "tree".to_owned();
        space.write("types/plant.yml", &markdown::serialize_type(&def));

        let index = space.index();
        assert_eq!(index.type_def("plant"), None);
        assert_eq!(index.type_def("tree"), None);
        assert_eq!(index.problems().unparseable.len(), 1);
        assert!(index.problems().unparseable[0].message.contains("tree"));
    }

    #[test]
    fn two_files_with_one_identity_are_reported() {
        let space = Space::new().seed();
        let doc = object(2, "Monstera", "Kitchen", 5);
        space
            .store
            .save_object(&object_path("Monstera"), &doc, None)
            .expect("first");
        space
            .store
            .save_object(Path::new("objects/plant/copy.md"), &doc, None)
            .expect("second");

        let index = space.index();
        let problems = index.problems();
        assert_eq!(problems.unparseable.len(), 1);
        // Files load in path order, so the first name keeps the object.
        assert_eq!(
            problems.unparseable[0].path,
            PathBuf::from("objects/plant/monstera.md")
        );
        assert!(
            problems.unparseable[0]
                .message
                .contains("repeats the id of objects/plant/copy.md")
        );
        assert_eq!(index.summaries("plant").len(), 1);
    }

    #[test]
    fn a_trashed_flag_must_agree_with_the_directory() {
        let space = Space::new().seed();
        let mut live = object(2, "Monstera", "Kitchen", 5);
        live.trashed_at = Some(at(9));
        space
            .store
            .save_object(&object_path("Monstera"), &live, None)
            .expect("save live");
        space
            .store
            .save_object(
                Path::new("trash/4.md"),
                &object(4, "Ficus", "Attic", 6),
                None,
            )
            .expect("save trash");

        let index = space.index();
        assert_eq!(
            index
                .problems()
                .unparseable
                .iter()
                .map(|file| file.path.display().to_string())
                .collect::<Vec<_>>(),
            vec!["objects/plant/monstera.md", "trash/4.md"]
        );
        assert_eq!(index.object(Uuid::from_u128(2)), None);
        assert_eq!(index.object(Uuid::from_u128(4)), None);
    }

    #[test]
    fn a_dangling_relation_is_reported_and_survives_a_reload() {
        let space = Space::new().seed();
        let mut doc = object(2, "Monstera", "Kitchen", 5);
        let target = Uuid::from_u128(99);
        doc.properties
            .insert("related".to_owned(), Value::Text(target.to_string()));
        space
            .store
            .save_property(
                &PropertyDef {
                    key: "related".to_owned(),
                    name: "Related".to_owned(),
                    format: PropertyFormat::Relation,
                    options: Vec::new(),
                    target_type: None,
                    multi: false,
                },
                None,
            )
            .expect("property");
        let mut def = plant_type();
        def.properties.push(TypeProperty {
            key: "related".to_owned(),
            required: false,
            featured: false,
        });
        space.rewrite_type(&def);
        let path = object_path("Monstera");
        space.store.save_object(&path, &doc, None).expect("object");

        let mut index = space.index();
        assert_eq!(
            index.problems().dangling_relations,
            vec![DanglingRelation {
                object: Uuid::from_u128(2),
                path: path.clone(),
                property: "related".to_owned(),
                target,
            }]
        );
        index
            .reload_file(&space.store, &path)
            .expect("reload the referencing object");
        assert_eq!(index.problems().dangling_relations.len(), 1);
        assert_eq!(
            index
                .detail(Uuid::from_u128(2))
                .map(|detail| detail.missing_relations),
            Some(vec![target])
        );
    }

    #[test]
    fn duplicate_slugs_are_grouped_per_type() {
        let space = Space::new().seed();
        // Distinct files, colliding titles: what a retitle looks like on disk.
        for (id, title, at) in [
            (2, "Monstera", "monstera.md"),
            (3, "monstera!", "monstera-2.md"),
            (4, "Ficus", "ficus.md"),
        ] {
            let doc = object(id, title, "Kitchen", id as i64);
            space
                .store
                .save_object(Path::new("objects/plant").join(at).as_path(), &doc, None)
                .expect("object");
        }

        let index = space.index();
        assert_eq!(
            index.problems().duplicate_slugs,
            vec![DuplicateSlug {
                type_key: "plant".to_owned(),
                slug: "monstera".to_owned(),
                objects: vec![Uuid::from_u128(2), Uuid::from_u128(3)],
            }]
        );
    }

    #[test]
    fn reload_file_follows_an_object_to_its_new_path() {
        let space = Space::new().seed();
        let doc = object(2, "Monstera", "Kitchen", 5);
        let old = object_path("Monstera");
        let new = object_path("Monstera deliciosa");
        space.store.save_object(&old, &doc, None).expect("object");

        let mut index = space.index();
        fs::rename(
            space.path(old.to_str().expect("path")),
            space.path(new.to_str().expect("path")),
        )
        .expect("rename");
        index.reload_file(&space.store, &new).expect("reload new");
        index.reload_file(&space.store, &old).expect("reload old");

        assert_eq!(index.object_path(Uuid::from_u128(2)), Some(new.as_path()));
        assert_eq!(index.summaries("plant").len(), 1);
        assert_eq!(
            index
                .object(Uuid::from_u128(2))
                .map(|doc| doc.title.as_str()),
            Some("Monstera")
        );
    }

    #[test]
    fn reload_file_forgets_a_deleted_file() {
        let space = Space::new().seed();
        let path = object_path("Monstera");
        space
            .store
            .save_object(&path, &object(2, "Monstera", "Kitchen", 5), None)
            .expect("object");

        let mut index = space.index();
        fs::remove_file(space.path(path.to_str().expect("path"))).expect("remove");
        index.reload_file(&space.store, &path).expect("reload");

        assert_eq!(index.object(Uuid::from_u128(2)), None);
        assert_eq!(index.object_path(Uuid::from_u128(2)), None);
        assert_eq!(index.summaries("plant"), &[]);
        assert_eq!(index.fingerprint(&path), None);
    }

    #[test]
    fn repairing_a_file_clears_its_problem_and_trashing_moves_it() {
        let space = Space::new().seed();
        let path = object_path("Monstera");
        space.write("objects/plant/monstera.md", "---\nschema: 1\n---\n");
        let mut index = space.index();
        assert_eq!(index.problems().unparseable.len(), 1);

        let doc = object(2, "Monstera", "Kitchen", 5);
        space.write(
            "objects/plant/monstera.md",
            &markdown::serialize_object(&doc),
        );
        index.reload_file(&space.store, &path).expect("reload");
        assert_eq!(index.problems(), Problems::default());
        assert_eq!(index.summaries("plant").len(), 1);

        space
            .store
            .move_to_trash(&path, at(9), None)
            .expect("trash");
        let trashed = PathBuf::from(format!("trash/{}.md", Uuid::from_u128(2)));
        index.reload_file(&space.store, &path).expect("reload gone");
        index
            .reload_file(&space.store, &trashed)
            .expect("reload trash");
        assert_eq!(index.object(Uuid::from_u128(2)), None);
        assert_eq!(index.problems(), Problems::default());
        assert_eq!(index.trash().count(), 1);
        assert_eq!(index.summaries("plant"), &[]);
    }

    #[test]
    fn a_table_view_runs_over_the_loaded_space() {
        let space = Space::new().seed();
        for (id, title, room, updated) in [
            (2, "Monstera", "Kitchen", 5),
            (3, "Ficus", "Attic", 7),
            (4, "Fern", "Kitchen", 6),
        ] {
            let doc = object(id, title, room, updated);
            space
                .store
                .save_object(&object_path(title), &doc, None)
                .expect("object");
        }

        let index = space.index();
        let mut view = plant_type().view;
        view.filter.conditions.push(Condition {
            property: "room".to_owned(),
            condition: CondOp::Equal,
            value: Some(Value::Text("Kitchen".to_owned())),
        });
        view.sorts.push(Sort {
            property: "title".to_owned(),
            direction: Direction::Asc,
            empty: EmptyPlacement::End,
        });

        let rows = query::apply(&view, index.summaries("plant"), &index.schema());
        assert_eq!(
            rows.iter().map(|row| row.title.clone()).collect::<Vec<_>>(),
            vec!["Fern".to_owned(), "Monstera".to_owned()]
        );
    }
}
