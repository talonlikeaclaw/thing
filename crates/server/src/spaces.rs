//! Every space under the data directory, held in memory and kept in step with disk.
//!
//! The index is derived state: it is built from the files at boot and rebuilt
//! file by file as the watcher reports changes, so what a handler serves is what
//! the files say.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, PoisonError, RwLock};

use thing_core::error::CoreError;
use thing_core::index::SpaceIndex;
use thing_core::model::SpaceMeta;
use thing_core::store::fs::FsSpaceStore;
use thing_core::store::{SPACE_FILE, SpaceStore};
use uuid::Uuid;

/// Directory under the data directory holding one directory per space.
pub const SPACES_DIR: &str = "spaces";

/// One space: its store, its index, the lock that serializes writes to it, and
/// the channel every live client listens on.
pub struct SpaceHandle {
    pub store: FsSpaceStore,
    index: RwLock<SpaceIndex>,
    /// Taken by every writer — the API and the watcher — so those serialize.
    pub write: tokio::sync::Mutex<()>,
    /// One broadcast channel per space, shared by the write path and the watcher.
    pub events: tokio::sync::broadcast::Sender<crate::events::SpaceEvent>,
}

impl SpaceHandle {
    /// The id its `space.yml` holds.
    pub fn id(&self) -> Uuid {
        self.with_index(|index| index.meta().id)
    }

    /// The space's own metadata, as the index last read it.
    pub fn meta(&self) -> SpaceMeta {
        self.with_index(|index| index.meta().clone())
    }

    /// How many types the space defines.
    pub fn type_count(&self) -> usize {
        self.with_index(|index| index.types().count())
    }

    /// Runs `f` over the index under the read lock.
    pub fn with_index<T>(&self, f: impl FnOnce(&SpaceIndex) -> T) -> T {
        let index = self.index.read().unwrap_or_else(PoisonError::into_inner);
        f(&index)
    }

    /// Runs `f` over the index under the write lock.
    ///
    /// A poisoned lock is recovered rather than propagated: the index is
    /// derived from disk, so the worst case is a stale row, not lost data.
    pub fn with_index_mut<T>(&self, f: impl FnOnce(&mut SpaceIndex) -> T) -> T {
        let mut index = self.index.write().unwrap_or_else(PoisonError::into_inner);
        f(&mut index)
    }

    /// Applies `change` to `space.yml` and re-reads it, so the rename a caller
    /// asked for is what the index serves next.
    ///
    /// The caller holds [`SpaceHandle::write`], so it can broadcast the change
    /// before another writer gets a turn.
    pub fn update_meta_locked(&self, change: impl FnOnce(&mut SpaceMeta)) -> Result<(), CoreError> {
        let (mut meta, expected) = self.with_index(|index| {
            (
                index.meta().clone(),
                index.fingerprint(Path::new(SPACE_FILE)),
            )
        });
        change(&mut meta);
        self.store.save_space(&meta, expected)?;
        self.with_index_mut(|index| index.reload_file(&self.store, Path::new(SPACE_FILE)))
    }
}

/// Every space the server knows about, keyed by the id its `space.yml` holds.
pub struct SpaceRegistry {
    data_dir: PathBuf,
    spaces: RwLock<BTreeMap<Uuid, Arc<SpaceHandle>>>,
}

impl SpaceRegistry {
    pub fn new(data_dir: impl Into<PathBuf>) -> Self {
        Self {
            data_dir: data_dir.into(),
            spaces: RwLock::new(BTreeMap::new()),
        }
    }

    pub fn data_dir(&self) -> &Path {
        &self.data_dir
    }

    pub fn spaces_dir(&self) -> PathBuf {
        self.data_dir.join(SPACES_DIR)
    }

    /// Creates the data directory and its `spaces/` subdirectory, both
    /// owner-only.
    pub fn prepare(&self) -> Result<(), CoreError> {
        thing_core::store::fs::create_private_dir_all(&self.spaces_dir())?;
        Ok(())
    }

    /// Loads every space directory, skipping — not failing on — one that will not read.
    pub fn load_all(&self) -> Result<usize, CoreError> {
        let mut loaded = 0;
        for entry in fs::read_dir(self.spaces_dir())? {
            let path = entry?.path();
            if !path.is_dir() {
                continue;
            }
            match self.load(&path) {
                Ok(_) => loaded += 1,
                Err(err) => tracing::warn!(space_dir = %path.display(), %err, "space skipped"),
            }
        }
        Ok(loaded)
    }

    /// Loads one space directory and records it under its own id.
    pub fn load(&self, dir: &Path) -> Result<Arc<SpaceHandle>, CoreError> {
        let store = FsSpaceStore::open(dir)?;
        let index = SpaceIndex::rebuild_from_disk(&store)?;
        let id = index.meta().id;
        let problems = index.problems();
        let clean = problems.unparseable.is_empty()
            && problems.dangling_relations.is_empty()
            && problems.duplicate_slugs.is_empty();
        // A reload keeps the channel, so a client that connected before it
        // still hears about the space afterwards.
        let events = self
            .get(id)
            .map_or_else(crate::events::channel, |existing| existing.events.clone());
        let handle = Arc::new(SpaceHandle {
            store,
            index: RwLock::new(index),
            write: tokio::sync::Mutex::new(()),
            events,
        });
        if !clean {
            tracing::warn!(
                space = %id,
                unparseable = problems.unparseable.len(),
                dangling_relations = problems.dangling_relations.len(),
                duplicate_slugs = problems.duplicate_slugs.len(),
                "space has file problems"
            );
        }
        let previous = self
            .spaces
            .write()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(id, Arc::clone(&handle));
        tracing::info!(
            space = %id,
            dir = %dir.display(),
            reloaded = previous.is_some(),
            "space loaded"
        );
        Ok(handle)
    }

    /// The space with this id, if it is loaded.
    pub fn get(&self, id: Uuid) -> Option<Arc<SpaceHandle>> {
        self.spaces
            .read()
            .unwrap_or_else(PoisonError::into_inner)
            .get(&id)
            .map(Arc::clone)
    }

    /// Every loaded space, in id order.
    pub fn spaces(&self) -> Vec<Arc<SpaceHandle>> {
        self.spaces
            .read()
            .unwrap_or_else(PoisonError::into_inner)
            .values()
            .map(Arc::clone)
            .collect()
    }

    /// Forgets a space whose directory is gone, so nothing serves stale state for it.
    pub fn remove(&self, id: Uuid) {
        let removed = self
            .spaces
            .write()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(&id)
            .is_some();
        if removed {
            tracing::info!(space = %id, "space unloaded");
        }
    }

    /// The space `path` belongs to, with its path relative to that space.
    pub fn resolve(&self, path: &Path) -> Option<(Arc<SpaceHandle>, PathBuf)> {
        let spaces = self.spaces.read().unwrap_or_else(PoisonError::into_inner);
        for handle in spaces.values() {
            if let Ok(relative) = path.strip_prefix(handle.store.space_dir()) {
                return Some((Arc::clone(handle), relative.to_owned()));
            }
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use thing_core::model::{Member, Role, SpaceMeta};
    use time::macros::datetime;

    fn meta(name: &str) -> SpaceMeta {
        SpaceMeta {
            id: Uuid::now_v7(),
            name: name.to_owned(),
            icon: None,
            timezone: "UTC".to_owned(),
            created_at: datetime!(2026-10-17 12:00:00 UTC),
            members: vec![Member {
                user: Uuid::now_v7(),
                role: Role::Owner,
            }],
        }
    }

    /// Writes a space directory the way a user would: `space.yml`, nothing else.
    fn space_on_disk(spaces_dir: &Path, name: &str) -> SpaceMeta {
        let meta = meta(name);
        let store = FsSpaceStore::create(spaces_dir.join(meta.id.to_string()), &meta)
            .expect("a fresh space directory");
        assert_eq!(store.load_space().expect("reads back").0.name, name);
        meta
    }

    #[test]
    fn loads_every_space_and_skips_a_directory_that_is_not_one() {
        let root = tempfile::tempdir().expect("a temporary data directory");
        let registry = SpaceRegistry::new(root.path());
        registry.prepare().expect("creates spaces/");
        let garden = space_on_disk(&registry.spaces_dir(), "Garden");
        fs::create_dir_all(registry.spaces_dir().join("not-a-space")).expect("a stray directory");

        assert_eq!(registry.load_all().expect("loads"), 1);

        let (handle, relative) = registry
            .resolve(
                &root
                    .path()
                    .join(SPACES_DIR)
                    .join(garden.id.to_string())
                    .join("space.yml"),
            )
            .expect("the loaded space owns its directory");
        assert_eq!(handle.id(), garden.id);
        assert_eq!(relative, Path::new("space.yml"));
        assert!(
            registry
                .resolve(Path::new("/elsewhere/space.yml"))
                .is_none()
        );
    }

    #[test]
    fn remove_forgets_a_space_so_nothing_serves_it() {
        let root = tempfile::tempdir().expect("a temporary data directory");
        let registry = SpaceRegistry::new(root.path());
        registry.prepare().expect("creates spaces/");
        let garden = space_on_disk(&registry.spaces_dir(), "Garden");
        registry.load_all().expect("loads");

        registry.remove(garden.id);

        assert!(
            registry
                .resolve(&registry.spaces_dir().join(garden.id.to_string()))
                .is_none()
        );
    }
}
