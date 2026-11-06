//! The whole of one space, held in memory and kept in step with disk.
//!
//! The index is derived state: after a write the caller hands the touched path
//! back through [`SpaceIndex::reload_file`], so what the API serves is what the
//! files say. A file that will not parse is recorded as a problem and left out
//! of the index, never guessed at; the file itself is untouched.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use uuid::Uuid;

use crate::error::CoreError;
use crate::links::{self, LinkStatus, LinkView, MentionBacklink, RelationBacklink};
use crate::model::{
    ObjectDetail, ObjectDoc, ObjectSummary, PropertyDef, PropertyFormat, SpaceMeta, TypeDef, Value,
};
use crate::schedule;
use crate::search::SearchIndex;
use crate::slug::slugify;
use crate::store::{self, FileFingerprint, SPACE_FILE, SpaceFileKind, SpaceStore};
use crate::validate::{self, Schema};

/// A file that could not be put into the index.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnparseableFile {
    pub path: PathBuf,
    pub message: String,
}

/// One live record as the space graph names it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GraphNode {
    pub id: Uuid,
    pub type_key: String,
    pub title: String,
    pub icon: Option<String>,
}

/// One live target named by a relation property on a record.
///
/// `property` is the source property's key, so two properties pointing at the
/// same record stay two facts.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RelationTarget {
    pub target: Uuid,
    pub property: String,
}

/// One edge of the space graph. A relation and a body link between the same
/// pair are one edge with both flags, because they are one connection.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GraphEdge {
    pub source: Uuid,
    pub target: Uuid,
    pub relation: bool,
    pub mention: bool,
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

/// A file or image reference whose bytes are not in the space.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MissingFile {
    pub object: Uuid,
    /// The object's file, relative to the space.
    pub path: PathBuf,
    /// `cover` or the property key that names the missing bytes.
    pub field: String,
    /// The referenced attachment path, as frontmatter spells it.
    pub file: String,
}

/// One view that names something the space does not offer.
///
/// A semantic view problem never takes the type or its other views offline: it
/// is reported here, and the view that asks for the missing member fails when
/// it is selected.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ViewProblem {
    pub type_key: String,
    /// Empty for a type-level problem (`views`, `default_view`).
    pub view_key: String,
    /// The validator's path, such as `views.by_room.group_by`.
    pub field: String,
    pub message: String,
}

/// Every kind of file problem a space can have: unparseable, dangling, colliding,
/// and a reference whose bytes are gone.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Problems {
    pub unparseable: Vec<UnparseableFile>,
    pub dangling_relations: Vec<DanglingRelation>,
    pub duplicate_slugs: Vec<DuplicateSlug>,
    /// The space timezone when it does not resolve; the space then reads as UTC.
    pub invalid_timezone: Option<String>,
    /// Declared property keys that collide with a generated schedule key.
    pub schedule_key_conflicts: Vec<String>,
    /// References to attachment bytes the space does not hold.
    pub missing_files: Vec<MissingFile>,
    /// Views naming missing members or carrying fields their kind does not own.
    pub view_problems: Vec<ViewProblem>,
}

/// One space: its schema, its objects, and what could not be loaded.
#[derive(Debug, Clone)]
pub struct SpaceIndex {
    meta: SpaceMeta,
    types: BTreeMap<String, TypeDef>,
    properties: BTreeMap<String, PropertyDef>,
    /// `due_date`, `recurrence`, `last_completed_at`: generated, never written
    /// to `properties/`, and resolved after the declared properties.
    schedule_properties: BTreeMap<String, PropertyDef>,
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
    /// `(type key, folded title)` to the live ids that carry it.
    titles: BTreeMap<(String, String), BTreeSet<Uuid>>,
    /// Derived from the live bodies, updated one document at a time.
    search: SearchIndex,
    /// Every attachment path in the space, so a reference's bytes can be
    /// reported missing without re-listing the tree on every read.
    attachments: BTreeSet<PathBuf>,
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
            schedule_properties: schedule::schedule_property_defs(),
            objects: BTreeMap::new(),
            trash: BTreeMap::new(),
            paths: BTreeMap::new(),
            trash_paths: BTreeMap::new(),
            paths_to_ids: BTreeMap::new(),
            fingerprints: BTreeMap::new(),
            summaries: BTreeMap::new(),
            titles: BTreeMap::new(),
            search: SearchIndex::default(),
            attachments: BTreeSet::new(),
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
            Some(SpaceFileKind::Attachment) => self.reload_attachment(store, path),
            Some(SpaceFileKind::History | SpaceFileKind::Thumbnail) | None => Ok(()),
        }
    }

    /// The schema, ready to validate or query against.
    pub fn schema(&self) -> Schema<'_> {
        Schema {
            types: &self.types,
            properties: &self.properties,
            schedule_properties: &self.schedule_properties,
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
            invalid_timezone: schedule::resolve_timezone(&self.meta.timezone)
                .err()
                .map(|_| self.meta.timezone.clone()),
            schedule_key_conflicts: self
                .properties
                .keys()
                .filter(|key| schedule::is_schedule_key(key))
                .cloned()
                .collect(),
            missing_files: self.missing_files(),
            view_problems: self.view_problems(),
        }
    }

    /// Runs [`validate::validate_views`] over every loaded type.
    fn view_problems(&self) -> Vec<ViewProblem> {
        let schema = self.schema();
        let mut found = Vec::new();
        for def in self.types.values() {
            for error in validate::validate_views(&schema, def) {
                let CoreError::ValidationFailed { field, message } = error else {
                    continue;
                };
                let view_key = field
                    .strip_prefix("views.")
                    .and_then(|rest| rest.split_once('.'))
                    .map(|(key, _)| key.to_owned())
                    .unwrap_or_default();
                found.push(ViewProblem {
                    type_key: def.key.clone(),
                    view_key,
                    field,
                    message,
                });
            }
        }
        found
    }

    /// The derived full-text index over this space's live records.
    pub fn search(&self) -> &SearchIndex {
        &self.search
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

    /// The property with this key: a declared property first, then one of the
    /// generated schedule properties. `properties()` stays declared-only.
    pub fn property_def(&self, key: &str) -> Option<&PropertyDef> {
        self.properties
            .get(key)
            .or_else(|| self.schedule_properties.get(key))
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

    /// What a `[[type key/Title]]` link names: one live record, none, or many.
    pub fn resolve_link(&self, type_key: &str, title: &str) -> LinkStatus {
        let key = (type_key.to_owned(), fold_title(title));
        match self.titles.get(&key) {
            None => LinkStatus::Unknown,
            Some(ids) => match ids.len() {
                0 => LinkStatus::Unknown,
                1 => LinkStatus::Found(*ids.first().expect("one id")),
                many => LinkStatus::Ambiguous(many),
            },
        }
    }

    /// Every distinct link in one record's body, in first-occurrence order.
    pub fn outgoing_links(&self, id: Uuid) -> Vec<LinkView> {
        let Some(doc) = self.object(id) else {
            return Vec::new();
        };
        let mut seen: BTreeSet<(String, String)> = BTreeSet::new();
        let mut links = Vec::new();
        for parsed in links::parse(&doc.body) {
            let key = (parsed.type_key.clone(), fold_title(&parsed.title));
            if !seen.insert(key) {
                continue;
            }
            let status = self.resolve_link(&parsed.type_key, &parsed.title);
            links.push(LinkView {
                raw: parsed.inner,
                type_key: parsed.type_key,
                title: parsed.title,
                status,
            });
        }
        links
    }

    /// Every live target named by a relation property on `id`, deduplicated by
    /// target and property, in property-key then target-title order.
    ///
    /// A target that is not in the space is not an edge here; it stays a
    /// `missing_relations` row on the record. The caller reads the target docs
    /// for its own projection, so this returns only ids and property keys.
    pub fn outgoing_relations(&self, id: Uuid) -> Vec<RelationTarget> {
        let Some(doc) = self.object(id) else {
            return Vec::new();
        };
        let mut seen: BTreeSet<(Uuid, String)> = BTreeSet::new();
        let mut rows: Vec<(String, String, Uuid)> = Vec::new();
        for (property, value) in &doc.properties {
            if self.property_def(property).map(|def| def.format) != Some(PropertyFormat::Relation) {
                continue;
            }
            for target in relation_targets(value) {
                let Some(record) = self.object(target) else {
                    continue;
                };
                if seen.insert((target, property.clone())) {
                    rows.push((property.clone(), fold_title(&record.title), target));
                }
            }
        }
        // Property first so the rows follow the schema, then title so one
        // property's targets read alphabetically rather than by file order.
        rows.sort_by(|left, right| {
            left.0
                .cmp(&right.0)
                .then_with(|| left.1.cmp(&right.1))
                .then_with(|| left.2.cmp(&right.2))
        });
        rows.into_iter()
            .map(|(property, _, target)| RelationTarget { target, property })
            .collect()
    }

    /// Records that point at `id`, through a relation property and through a
    /// mention in a body.
    ///
    /// Both scans read every live object. The relation side already did; the
    /// mention side joins it because a title rename changes every resolution,
    /// which a second index would have to invalidate too.
    pub fn backlinks_of(&self, id: Uuid) -> (Vec<RelationBacklink>, Vec<MentionBacklink>) {
        let mut relations = Vec::new();
        let mut mentions = Vec::new();
        for doc in self.objects.values() {
            for (property, value) in &doc.properties {
                if self.property_def(property).map(|def| def.format)
                    != Some(PropertyFormat::Relation)
                {
                    continue;
                }
                if names(value, id) {
                    relations.push(RelationBacklink {
                        source: doc.id,
                        property: property.clone(),
                    });
                }
            }

            let mut count = 0;
            let mut excerpt = None;
            for link in links::parse(&doc.body) {
                if self.resolve_link(&link.type_key, &link.title) != LinkStatus::Found(id) {
                    continue;
                }
                count += 1;
                if excerpt.is_none() {
                    excerpt = Some(links::excerpt(&doc.body, link.start, link.end, 120));
                }
            }
            if count > 0 {
                mentions.push(MentionBacklink {
                    source: doc.id,
                    count,
                    snippet: excerpt.unwrap_or_default(),
                });
            }
        }
        relations.sort_by_key(|backlink| backlink.source);
        mentions.sort_by_key(|backlink| backlink.source);
        (relations, mentions)
    }

    /// Every live record and every resolved connection between two of them.
    ///
    /// A relation property and a body link are the two facts; a pair that has
    /// both stays one edge with both flags. Nodes and edges are sorted, so a
    /// drawing never depends on the order the files were read.
    pub fn graph(&self) -> (Vec<GraphNode>, Vec<GraphEdge>) {
        let nodes: Vec<GraphNode> = self
            .objects
            .values()
            .map(|doc| GraphNode {
                id: doc.id,
                type_key: doc.type_key.clone(),
                title: doc.title.clone(),
                icon: doc.icon.clone(),
            })
            .collect();

        let mut edges: BTreeMap<(Uuid, Uuid), GraphEdge> = BTreeMap::new();
        for doc in self.objects.values() {
            let mut targets: BTreeSet<Uuid> = BTreeSet::new();
            for (property, value) in &doc.properties {
                if self.property_def(property).map(|def| def.format)
                    != Some(PropertyFormat::Relation)
                {
                    continue;
                }
                for target in relation_targets(value) {
                    targets.insert(target);
                }
            }
            for target in targets {
                if self.objects.contains_key(&target) {
                    edges.entry((doc.id, target)).or_insert(GraphEdge {
                        source: doc.id,
                        target,
                        relation: true,
                        mention: false,
                    });
                }
            }

            let mut targets: BTreeSet<Uuid> = BTreeSet::new();
            for link in self.outgoing_links(doc.id) {
                if let LinkStatus::Found(target) = link.status {
                    targets.insert(target);
                }
            }
            for target in targets {
                if target == doc.id || !self.objects.contains_key(&target) {
                    continue;
                }
                edges
                    .entry((doc.id, target))
                    .and_modify(|edge| edge.mention = true)
                    .or_insert(GraphEdge {
                        source: doc.id,
                        target,
                        relation: false,
                        mention: true,
                    });
            }
        }

        (nodes, edges.into_values().collect())
    }

    /// Records this title for link resolution; the caller inserted a live doc.
    fn remember_title(&mut self, doc: &ObjectDoc) {
        self.titles
            .entry((doc.type_key.clone(), fold_title(&doc.title)))
            .or_default()
            .insert(doc.id);
    }

    /// Drops one doc's title entry, if it had one.
    fn forget_title(&mut self, doc: &ObjectDoc) {
        let key = (doc.type_key.clone(), fold_title(&doc.title));
        let now_empty = match self.titles.get_mut(&key) {
            Some(ids) => {
                ids.remove(&doc.id);
                ids.is_empty()
            }
            None => false,
        };
        if now_empty {
            self.titles.remove(&key);
        }
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
            self.search.upsert(&doc);
            self.remember_title(&doc);
            self.objects.insert(doc.id, doc);
            self.summaries.entry(type_key).or_default().push(summary);
        }
        Ok(())
    }

    /// Notes whether an attachment path exists, so a reference to it reads as
    /// present or missing without listing the tree again.
    fn reload_attachment<S: SpaceStore + ?Sized>(
        &mut self,
        store: &S,
        path: &Path,
    ) -> Result<(), CoreError> {
        if store.exists(path)? {
            self.attachments.insert(path.to_owned());
        } else {
            self.attachments.remove(path);
        }
        Ok(())
    }

    /// Every cover or file/image value whose bytes the space does not hold.
    ///
    /// A missing file is a problem, never a parse failure: the object still
    /// loads and keeps the path it names.
    fn missing_files(&self) -> Vec<MissingFile> {
        let mut found = Vec::new();
        for (id, doc) in self.objects.iter().chain(self.trash.iter()) {
            let Some(path) = self.paths.get(id).or_else(|| self.trash_paths.get(id)) else {
                continue;
            };
            if let Some(cover) = &doc.cover {
                self.push_missing(&mut found, *id, path, "cover", cover);
            }
            for (key, value) in &doc.properties {
                let Some(def) = self.property_def(key) else {
                    continue;
                };
                if !matches!(def.format, PropertyFormat::File | PropertyFormat::Image) {
                    continue;
                }
                let Value::Text(file) = value else {
                    continue;
                };
                self.push_missing(&mut found, *id, path, key, file);
            }
        }
        found.sort_by(|left, right| {
            left.path
                .cmp(&right.path)
                .then_with(|| left.field.cmp(&right.field))
                .then_with(|| left.file.cmp(&right.file))
        });
        found
    }

    fn push_missing(
        &self,
        found: &mut Vec<MissingFile>,
        object: Uuid,
        path: &Path,
        field: &str,
        file: &str,
    ) {
        if self.attachments.contains(Path::new(file)) {
            return;
        }
        found.push(MissingFile {
            object,
            path: path.to_owned(),
            field: field.to_owned(),
            file: file.to_owned(),
        });
    }

    /// Drops every entry that used this path, including the type's row.
    fn forget_path(&mut self, path: &Path) {
        self.forget_fingerprint(path);
        let Some(id) = self.paths_to_ids.remove(path) else {
            return;
        };
        self.paths.remove(&id);
        self.trash_paths.remove(&id);
        self.search.remove(id);
        let removed = self.objects.remove(&id).or_else(|| self.trash.remove(&id));
        if let Some(doc) = removed {
            self.forget_title(&doc);
            if let Some(rows) = self.summaries.get_mut(&doc.type_key) {
                rows.retain(|row| row.id != id);
                if rows.is_empty() {
                    self.summaries.remove(&doc.type_key);
                }
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

/// The spelling a title is compared under: trimmed and case-folded.
fn fold_title(title: &str) -> String {
    title.trim().to_lowercase()
}

/// Whether a relation value names `target`.
fn relation_targets(value: &Value) -> Vec<Uuid> {
    match value {
        Value::Text(id) => Uuid::parse_str(id).ok().into_iter().collect(),
        Value::List(ids) => ids
            .iter()
            .filter_map(|id| Uuid::parse_str(id).ok())
            .collect(),
        _ => Vec::new(),
    }
}

fn names(value: &Value, target: Uuid) -> bool {
    let target = target.to_string();
    match value {
        Value::Text(id) => *id == target,
        Value::List(ids) => ids.contains(&target),
        _ => false,
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
        Recurrence, RecurrenceKind, Role, Sort, TypeProperty, Value, ViewDef, ViewKind,
    };
    use crate::query;
    use crate::store::fs::FsSpaceStore;
    use crate::validate;

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
            accent: None,
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

    fn table_view(key: &str, columns: Vec<&str>) -> ViewDef {
        ViewDef {
            key: key.to_owned(),
            name: "All".to_owned(),
            kind: ViewKind::Table,
            sorts: Vec::new(),
            filter: Filter {
                op: FilterOp::And,
                conditions: Vec::new(),
            },
            columns: columns.into_iter().map(str::to_owned).collect(),
            widths: BTreeMap::new(),
            group_by: None,
            cover: None,
            date_property: None,
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
            schedule_labels: Default::default(),
            properties: vec![TypeProperty {
                key: "room".to_owned(),
                required: false,
                featured: true,
            }],
            views: vec![table_view("all", vec!["title", "room"])],
            default_view: "all".to_owned(),
        }
    }

    fn chore_type() -> TypeDef {
        TypeDef {
            key: "chore".to_owned(),
            name: "Chore".to_owned(),
            name_plural: "Chores".to_owned(),
            icon: None,
            description: String::new(),
            schedule: true,
            schedule_labels: Default::default(),
            properties: Vec::new(),
            views: vec![table_view("all", vec!["title", "due_date"])],
            default_view: "all".to_owned(),
        }
    }

    fn chore(id: u128, due: &str) -> ObjectDoc {
        let mut doc = object(id, "Water the monstera", "", 5);
        doc.type_key = "chore".to_owned();
        doc.properties = [
            ("due_date".to_owned(), Value::Text(due.to_owned())),
            (
                "recurrence".to_owned(),
                Value::Recurrence(Recurrence {
                    kind: RecurrenceKind::Days,
                    every: 3,
                    weekday: None,
                    day: None,
                }),
            ),
        ]
        .into_iter()
        .collect();
        doc
    }

    fn object(id: u128, title: &str, room: &str, updated: i64) -> ObjectDoc {
        ObjectDoc {
            id: Uuid::from_u128(id),
            type_key: "plant".to_owned(),
            title: title.to_owned(),
            icon: None,
            cover: None,
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
    fn an_attachment_is_not_part_of_the_index() {
        let space = Space::new().seed();
        let hash = "a".repeat(64);
        let attachment = store::file_path(&hash, "monstera.png");
        space
            .store
            .save_attachment(&attachment, b"\x89PNG\r\n", None)
            .expect("save attachment");
        let thumbnail = store::thumb_path(&hash, 256, "jpg");
        space
            .store
            .save_attachment(&thumbnail, b"thumb", None)
            .expect("save thumbnail");

        let index = space.index();
        assert_eq!(index.problems(), Problems::default());
        assert!(index.summaries("plant").is_empty());

        let mut reloaded = space.index();
        reloaded
            .reload_file(&space.store, &attachment)
            .expect("an attachment reloads as nothing");
        reloaded
            .reload_file(&space.store, &thumbnail)
            .expect("a thumbnail reloads as nothing");
        assert_eq!(reloaded.problems(), Problems::default());
        assert!(reloaded.summaries("plant").is_empty());
    }

    #[test]
    fn a_reference_without_bytes_is_reported_and_never_blocks_the_record() {
        use crate::model::{PropertyFormat, TypeProperty};
        use crate::store::file_path;

        let space = Space::new();
        let mut def = plant_type();
        def.properties.push(TypeProperty {
            key: "photo".to_owned(),
            required: false,
            featured: false,
        });
        space.store.save_type(&def, None).expect("save type");
        space
            .store
            .save_property(
                &PropertyDef {
                    key: "photo".to_owned(),
                    name: "Photo".to_owned(),
                    format: PropertyFormat::Image,
                    options: Vec::new(),
                    target_type: None,
                    multi: false,
                },
                None,
            )
            .expect("save property");

        let hash = "a".repeat(64);
        let file = file_path(&hash, "monstera.png");
        let spelling = file.display().to_string();
        let mut doc = object(2, "Monstera", "Kitchen", 5);
        doc.cover = Some(spelling.clone());
        doc.properties
            .insert("photo".to_owned(), Value::Text(spelling.clone()));
        let path = object_path("Monstera");
        space.store.save_object(&path, &doc, None).expect("object");

        let mut index = space.index();
        assert_eq!(
            index
                .object(Uuid::from_u128(2))
                .map(|doc| doc.cover.clone()),
            Some(Some(spelling.clone())),
            "a missing file never blocks the record"
        );
        assert_eq!(
            index.problems().missing_files,
            vec![
                MissingFile {
                    object: Uuid::from_u128(2),
                    path: path.clone(),
                    field: "cover".to_owned(),
                    file: spelling.clone(),
                },
                MissingFile {
                    object: Uuid::from_u128(2),
                    path,
                    field: "photo".to_owned(),
                    file: spelling,
                },
            ]
        );

        space
            .store
            .save_attachment(&file, b"\x89PNG", None)
            .expect("save bytes");
        index
            .reload_file(&space.store, &file)
            .expect("an attachment reloads as presence");
        assert!(index.problems().missing_files.is_empty());
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
    fn search_follows_a_body_edit_trash_and_restore() {
        let space = Space::new().seed();
        let path = object_path("Monstera");
        let id = Uuid::from_u128(2);
        let mut doc = object(2, "Monstera", "Kitchen", 5);
        doc.body = "The soil stays moist.".to_owned();
        space.store.save_object(&path, &doc, None).expect("object");

        let mut index = space.index();
        assert_eq!(index.search().query("moist", None, 10).total, 1);

        doc.body = "Watered today.".to_owned();
        let stamp = index.fingerprint(&path).expect("fingerprint");
        space
            .store
            .save_object(&path, &doc, Some(stamp))
            .expect("edit");
        index.reload_file(&space.store, &path).expect("reload edit");
        assert_eq!(index.search().query("moist", None, 10).total, 0);
        assert_eq!(index.search().query("watered", None, 10).total, 1);

        space
            .store
            .move_to_trash(&path, at(9), None)
            .expect("trash");
        let trashed = PathBuf::from(format!("trash/{id}.md"));
        index.reload_file(&space.store, &path).expect("reload gone");
        index
            .reload_file(&space.store, &trashed)
            .expect("reload trash");
        assert_eq!(index.search().query("watered", None, 10).total, 0);

        let restored = space.store.restore(id).expect("restore");
        index
            .reload_file(&space.store, &trashed)
            .expect("reload empty trash");
        index
            .reload_file(&space.store, &restored)
            .expect("reload restored");
        assert_eq!(index.search().query("watered", None, 10).total, 1);
    }

    #[test]
    fn links_resolve_titles_and_report_both_kinds_of_backlink() {
        let space = Space::new().seed();
        let related = PropertyDef {
            key: "related".to_owned(),
            name: "Related".to_owned(),
            format: PropertyFormat::Relation,
            options: Vec::new(),
            target_type: Some("plant".to_owned()),
            multi: false,
        };
        space
            .store
            .save_property(&related, None)
            .expect("relation property");

        let monstera = object(2, "Monstera", "Kitchen", 5);
        let monstera_path = object_path("Monstera");
        space
            .store
            .save_object(&monstera_path, &monstera, None)
            .expect("monstera");
        space
            .store
            .save_object(&object_path("Twin"), &object(3, "Twin", "Kitchen", 6), None)
            .expect("first twin");
        space
            .store
            .save_object(
                Path::new("objects/plant/twin-second.md"),
                &object(4, "Twin", "Study", 7),
                None,
            )
            .expect("second twin");

        let mut chore = object(5, "Water the monstera", "Kitchen", 8);
        chore.type_key = "chore".to_owned();
        chore.body = "Linked [[plant/Monstera]]. Unknown [[plant/Ghost]]. \
                     Ambiguous [[plant/Twin]].\n\n```\n[[plant/Monstera]]\n```\n\n\
                     Inline `[[plant/Monstera]]`."
            .to_owned();
        chore
            .properties
            .insert("related".to_owned(), Value::Text(monstera.id.to_string()));
        let chore_path = Path::new("objects/chore/water.md");
        space
            .store
            .save_object(chore_path, &chore, None)
            .expect("chore");

        let mut index = space.index();
        assert_eq!(
            index.resolve_link("plant", "monstera"),
            LinkStatus::Found(Uuid::from_u128(2))
        );
        assert_eq!(index.resolve_link("plant", "Ghost"), LinkStatus::Unknown);
        assert_eq!(
            index.resolve_link("plant", "Twin"),
            LinkStatus::Ambiguous(2)
        );

        assert_eq!(
            index.outgoing_relations(Uuid::from_u128(5)),
            vec![RelationTarget {
                target: Uuid::from_u128(2),
                property: "related".to_owned(),
            }]
        );

        let links = index.outgoing_links(Uuid::from_u128(5));
        assert_eq!(links.len(), 3, "{links:?}");
        assert_eq!(links[0].title, "Monstera");
        assert_eq!(links[0].status, LinkStatus::Found(Uuid::from_u128(2)));
        assert_eq!(links[1].status, LinkStatus::Unknown);
        assert_eq!(links[2].status, LinkStatus::Ambiguous(2));

        let (relations, mentions) = index.backlinks_of(Uuid::from_u128(2));
        assert_eq!(
            relations,
            vec![RelationBacklink {
                source: Uuid::from_u128(5),
                property: "related".to_owned(),
            }]
        );
        assert_eq!(mentions.len(), 1);
        assert_eq!(mentions[0].source, Uuid::from_u128(5));
        assert_eq!(mentions[0].count, 1, "code and inline code do not count");
        assert!(mentions[0].snippet.contains("Monstera"), "{mentions:?}");

        let (nodes, edges) = index.graph();
        assert_eq!(nodes.len(), 4, "{nodes:?}");
        assert_eq!(
            nodes
                .iter()
                .map(|node| node.title.clone())
                .collect::<Vec<_>>(),
            vec!["Monstera", "Twin", "Twin", "Water the monstera"]
        );
        assert_eq!(
            edges,
            vec![GraphEdge {
                source: Uuid::from_u128(5),
                target: Uuid::from_u128(2),
                relation: true,
                mention: true,
            }],
            "one pair, both facts, and no ambiguous edge"
        );

        // A rename changes resolution without touching the linking body.
        let mut renamed = monstera.clone();
        renamed.title = "Monstera deliciosa".to_owned();
        let stamp = index.fingerprint(&monstera_path).expect("fingerprint");
        space
            .store
            .save_object(&monstera_path, &renamed, Some(stamp))
            .expect("rename");
        index
            .reload_file(&space.store, &monstera_path)
            .expect("reload rename");
        assert_eq!(index.resolve_link("plant", "Monstera"), LinkStatus::Unknown);
        assert_eq!(
            index.outgoing_links(Uuid::from_u128(5))[0].status,
            LinkStatus::Unknown
        );
    }

    #[test]
    fn outgoing_relations_skip_dangling_targets_and_sort_by_property_then_title() {
        let space = Space::new().seed();
        for (key, name) in [("companion", "Companion"), ("related", "Related")] {
            let property = PropertyDef {
                key: key.to_owned(),
                name: name.to_owned(),
                format: PropertyFormat::Relation,
                options: Vec::new(),
                target_type: Some("plant".to_owned()),
                multi: true,
            };
            space
                .store
                .save_property(&property, None)
                .expect("relation property");
        }
        for (id, title) in [(10, "Zinnia"), (11, "Apple"), (12, "Basil")] {
            space
                .store
                .save_object(&object_path(title), &object(id, title, "Study", 5), None)
                .expect("target");
        }

        let mut source = object(20, "Source", "Study", 6);
        source.properties.insert(
            "related".to_owned(),
            Value::List(vec![
                Uuid::from_u128(10).to_string(),
                Uuid::from_u128(11).to_string(),
                Uuid::from_u128(10).to_string(),
                Uuid::from_u128(99).to_string(),
            ]),
        );
        source.properties.insert(
            "companion".to_owned(),
            Value::Text(Uuid::from_u128(12).to_string()),
        );
        space
            .store
            .save_object(&object_path("Source"), &source, None)
            .expect("source");

        let index = space.index();
        assert_eq!(
            index.outgoing_relations(Uuid::from_u128(20)),
            vec![
                RelationTarget {
                    target: Uuid::from_u128(12),
                    property: "companion".to_owned(),
                },
                RelationTarget {
                    target: Uuid::from_u128(11),
                    property: "related".to_owned(),
                },
                RelationTarget {
                    target: Uuid::from_u128(10),
                    property: "related".to_owned(),
                },
            ],
            "property order, then title, with the duplicate and the dangling target gone"
        );
        assert!(index.outgoing_relations(Uuid::from_u128(99)).is_empty());
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
        let mut view = plant_type().views.remove(0);
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

        let rows = query::apply(
            &view.filter,
            &view.sorts,
            index.summaries("plant"),
            &index.schema(),
        );
        assert_eq!(
            rows.iter().map(|row| row.title.clone()).collect::<Vec<_>>(),
            vec!["Fern".to_owned(), "Monstera".to_owned()]
        );
    }

    #[test]
    fn a_scheduled_type_validates_the_generated_properties() {
        let space = Space::new().seed();
        space
            .store
            .save_type(&chore_type(), None)
            .expect("save chore type");
        let index = space.index();
        let schema = index.schema();
        assert_eq!(
            schema.property("due_date").map(|def| def.format),
            Some(PropertyFormat::Date)
        );
        assert_eq!(
            schema.property("recurrence").map(|def| def.format),
            Some(PropertyFormat::Recurrence)
        );
        assert_eq!(
            schema.property("last_completed_at").map(|def| def.format),
            Some(PropertyFormat::Datetime)
        );
        // `properties()` stays declared-only.
        assert_eq!(index.properties().count(), 1);

        validate::validate_object(&schema, &chore(9, "2026-10-20"))
            .expect("a scheduled record is valid");

        let mut plant = object(10, "Monstera", "Kitchen", 5);
        plant
            .properties
            .insert("due_date".to_owned(), Value::Text("2026-10-20".to_owned()));
        let errors = validate::validate_object(&schema, &plant).expect_err("unscheduled type");
        assert_eq!(
            errors.iter().map(ToString::to_string).collect::<Vec<_>>(),
            vec!["invalid due_date: is not a property of type plant"]
        );
    }

    #[test]
    fn filters_and_sorts_accept_a_schedule_key_only_while_scheduled() {
        let space = Space::new().seed();
        space
            .store
            .save_type(&chore_type(), None)
            .expect("save chore type");
        let index = space.index();
        let schema = index.schema();
        let chore = index.type_def("chore").expect("chore");
        let plant = index.type_def("plant").expect("plant");

        let filter = Filter {
            op: FilterOp::And,
            conditions: vec![Condition {
                property: "due_date".to_owned(),
                condition: CondOp::Equal,
                value: Some(Value::Text("2026-10-20".to_owned())),
            }],
        };
        validate::validate_filter(&schema, chore, &filter).expect("scheduled filter");
        let errors = validate::validate_filter(&schema, plant, &filter).expect_err("plant");
        assert_eq!(
            errors.iter().map(ToString::to_string).collect::<Vec<_>>(),
            vec!["invalid due_date: is not a property of type plant"]
        );

        let sorts = [Sort {
            property: "due_date".to_owned(),
            direction: Direction::Asc,
            empty: EmptyPlacement::End,
        }];
        validate::validate_sorts(&schema, chore, &sorts).expect("scheduled sort");
        let errors = validate::validate_sorts(&schema, plant, &sorts).expect_err("plant");
        assert_eq!(
            errors.iter().map(ToString::to_string).collect::<Vec<_>>(),
            vec!["invalid due_date: is not a property of type plant"]
        );
    }

    #[test]
    fn a_type_may_not_list_a_generated_schedule_property() {
        let space = Space::new().seed();
        let index = space.index();
        let schema = index.schema();
        let members = [TypeProperty {
            key: "due_date".to_owned(),
            required: false,
            featured: true,
        }];
        let errors = validate::validate_members(&schema, &members).expect_err("listed implicitly");
        assert_eq!(
            errors.iter().map(ToString::to_string).collect::<Vec<_>>(),
            vec!["invalid due_date: is generated by scheduling and is not listed in properties"]
        );
    }

    #[test]
    fn a_declared_schedule_key_and_an_invalid_timezone_are_reported() {
        let space = Space::new().seed();
        space
            .store
            .save_property(
                &PropertyDef {
                    key: "due_date".to_owned(),
                    name: "Due".to_owned(),
                    format: PropertyFormat::Date,
                    options: Vec::new(),
                    target_type: None,
                    multi: false,
                },
                None,
            )
            .expect("hand-edited property");
        let (mut meta, fingerprint) = space.store.load_space().expect("space");
        meta.timezone = "Mars/Olympus_Mons".to_owned();
        space
            .store
            .save_space(&meta, Some(fingerprint))
            .expect("rewrite space");

        let index = space.index();
        let problems = index.problems();
        assert_eq!(problems.schedule_key_conflicts, vec!["due_date"]);
        assert_eq!(
            problems.invalid_timezone.as_deref(),
            Some("Mars/Olympus_Mons")
        );
    }

    #[test]
    fn a_semantically_invalid_view_is_reported_while_the_type_loads() {
        let space = Space::new().seed();
        let mut def = plant_type();
        def.views[0].columns.push("ghost".to_owned());
        space.rewrite_type(&def);

        let index = space.index();
        assert!(index.type_def("plant").is_some());
        assert_eq!(
            index.problems().view_problems,
            vec![ViewProblem {
                type_key: "plant".to_owned(),
                view_key: "all".to_owned(),
                field: "views.all.columns".to_owned(),
                message: "names no member: ghost".to_owned(),
            }]
        );
    }
}
