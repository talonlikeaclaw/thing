//! The data-directory watcher: an edit made in another program is reflected.
//!
//! The user edits these markdown files in their own editor, so the index must
//! not serve or overwrite stale state. The watcher reports changed paths; every
//! event is debounced into one batch, and each path in the batch is re-read.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use notify::{RecursiveMode, Watcher};
use serde_json::json;
use thing_core::index::SpaceIndex;
use thing_core::model::{Member, ObjectDoc};
use thing_core::store::{SPACE_FILE, SpaceFileKind, SpaceStore, classify, key_from_path};
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::spaces::{SpaceHandle, SpaceRegistry};

/// How long changes must stop before a batch is applied.
pub const DEBOUNCE: Duration = Duration::from_millis(300);

/// Starts watching the data directory; the watcher lives until the process exits.
pub fn spawn(registry: Arc<SpaceRegistry>) -> notify::Result<()> {
    let (tx, rx) = mpsc::unbounded_channel();
    let mut watcher =
        notify::recommended_watcher(move |event: notify::Result<notify::Event>| match event {
            Ok(event) => {
                // Reads and opens are not changes, and re-reading a file to
                // reload it produces them: forwarding them would make the
                // watcher feed itself a new batch forever.
                if is_change(&event.kind) {
                    let _ = tx.send(event.paths);
                }
            }
            Err(err) => tracing::warn!(%err, "watch error"),
        })?;
    watcher.watch(registry.data_dir(), RecursiveMode::Recursive)?;

    tokio::spawn(run(registry, watcher, rx));
    Ok(())
}

/// Whether a notify event means the file's content or presence changed.
fn is_change(kind: &notify::EventKind) -> bool {
    matches!(
        kind,
        notify::EventKind::Create(_) | notify::EventKind::Modify(_) | notify::EventKind::Remove(_)
    )
}

async fn run(
    registry: Arc<SpaceRegistry>,
    _watcher: notify::RecommendedWatcher,
    mut events: mpsc::UnboundedReceiver<Vec<PathBuf>>,
) {
    while let Some(first) = events.recv().await {
        let mut batch: HashSet<PathBuf> = first.into_iter().collect();
        while let Ok(Some(more)) = tokio::time::timeout(DEBOUNCE, events.recv()).await {
            batch.extend(more);
        }
        apply(&registry, batch).await;
    }
}

/// Re-reads every changed path, loading a space whose `space.yml` just appeared
/// and dropping one whose `space.yml` is gone.
async fn apply(registry: &SpaceRegistry, paths: HashSet<PathBuf>) {
    // Sorted, so a moved file is handled at its new place before its old one:
    // `objects/` sorts before `trash/`, which is what makes a manual restore
    // recognisable as a restore instead of a purge.
    let mut ordered: Vec<PathBuf> = paths.into_iter().collect();
    ordered.sort();

    for path in ordered {
        let Some((handle, relative)) = registry.resolve(&path) else {
            // A space's own delete removes its directory, so only load when the
            // file that makes it a space is actually there.
            if let Some(dir) = new_space_dir(registry, &path)
                && dir.join(SPACE_FILE).is_file()
                && let Err(err) = registry.load(&dir)
            {
                tracing::warn!(space_dir = %dir.display(), %err, "space skipped");
            }
            continue;
        };
        let _guard = handle.write.lock().await;
        if space_is_gone(&handle, &relative) {
            handle.broadcast("space.deleted", json!({}));
            registry.remove(handle.id());
            continue;
        }
        let before = handle.with_index(|index| Before::of(index, &relative));
        let trashed_before: HashSet<Uuid> =
            handle.with_index(|index| index.trash().map(|doc| doc.id).collect());
        let outcome = handle.with_index_mut(|index| index.reload_file(&handle.store, &relative));
        if let Err(err) = outcome {
            tracing::warn!(path = %path.display(), %err, "reload failed");
            continue;
        }
        let present = handle.store.exists(&relative).unwrap_or(false);
        announce(&handle, &relative, &before, &trashed_before, present);
    }
}

/// What the index held at a changed path before the file was re-read.
struct Before {
    existed: bool,
    members: Vec<Member>,
    object: Option<ObjectDoc>,
    trashed: Option<ObjectDoc>,
}

impl Before {
    fn of(index: &SpaceIndex, path: &Path) -> Self {
        Self {
            existed: index.fingerprint(path).is_some(),
            members: index.meta().members.clone(),
            object: index
                .objects()
                .find(|doc| index.object_path(doc.id) == Some(path))
                .cloned(),
            trashed: index
                .trash()
                .find(|doc| index.trash_path(doc.id) == Some(path))
                .cloned(),
        }
    }
}

/// Broadcasts the event a changed path now represents.
///
/// The same edit also arrives through the API's own write path when the server
/// made it; a duplicate invalidation is harmless, a missing one is stale data.
fn announce(
    handle: &Arc<SpaceHandle>,
    path: &Path,
    before: &Before,
    trashed_before: &HashSet<Uuid>,
    present: bool,
) {
    let Some(kind) = classify(path) else {
        return;
    };
    match kind {
        SpaceFileKind::Space => {
            if present {
                announce_members(handle, &before.members);
                handle.broadcast("space.updated", json!({}));
            }
        }
        SpaceFileKind::Type | SpaceFileKind::Property => {
            let Some(key) = key_from_path(path) else {
                return;
            };
            let (created, updated, deleted) = match kind {
                SpaceFileKind::Type => ("type.created", "type.updated", "type.deleted"),
                _ => ("property.created", "property.updated", "property.deleted"),
            };
            let event = match (present, before.existed) {
                (true, true) => updated,
                (true, false) => created,
                (false, _) => deleted,
            };
            handle.broadcast(event, json!({ "key": key }));
        }
        SpaceFileKind::Object => {
            if present {
                let found = handle.with_index(|index| {
                    index
                        .objects()
                        .find(|doc| index.object_path(doc.id) == Some(path))
                        .map(|doc| (doc.id, doc.type_key.clone(), doc.rev))
                });
                if let Some((id, type_key, rev)) = found {
                    let event = if before.object.is_some() {
                        "object.updated"
                    } else if trashed_before.contains(&id) {
                        "object.restored"
                    } else {
                        "object.created"
                    };
                    handle.broadcast(event, json!({ "id": id, "type": type_key, "rev": rev }));
                } else if let Some(doc) = &before.object {
                    // Present on disk but no longer servable — an unparseable
                    // file was dropped from the index. Clients must hear it.
                    handle.broadcast(
                        "object.deleted",
                        json!({ "id": doc.id, "type": doc.type_key, "rev": doc.rev }),
                    );
                }
            } else if let Some(doc) = &before.object {
                handle.broadcast(
                    "object.deleted",
                    json!({ "id": doc.id, "type": doc.type_key, "rev": doc.rev }),
                );
            }
        }
        SpaceFileKind::Trash => {
            if present {
                let found = handle.with_index(|index| {
                    index
                        .trash()
                        .find(|doc| index.trash_path(doc.id) == Some(path))
                        .map(|doc| (doc.id, doc.type_key.clone(), doc.rev))
                });
                if let Some((id, type_key, rev)) = found {
                    handle.broadcast(
                        "object.deleted",
                        json!({ "id": id, "type": type_key, "rev": rev }),
                    );
                } else if let Some(doc) = &before.trashed {
                    handle.broadcast(
                        "object.purged",
                        json!({ "id": doc.id, "type": doc.type_key, "rev": doc.rev }),
                    );
                }
            } else if let Some(doc) = &before.trashed {
                // The object path sorts first. If it reappeared, the object
                // arm already announced the restore; otherwise the trash file
                // alone is gone, which is a purge.
                if handle.with_index(|index| index.object(doc.id).is_none()) {
                    handle.broadcast(
                        "object.purged",
                        json!({ "id": doc.id, "type": doc.type_key, "rev": doc.rev }),
                    );
                }
            }
        }
        SpaceFileKind::History => {}
    }
}

/// Announces each membership `space.yml` gained, lost or changed.
fn announce_members(handle: &Arc<SpaceHandle>, before: &[Member]) {
    let after = handle.with_index(|index| index.meta().members.clone());
    for old in before {
        if !after.iter().any(|member| member.user == old.user) {
            handle.broadcast("member.removed", json!({ "user": old.user }));
        }
    }
    for member in &after {
        match before.iter().find(|old| old.user == member.user) {
            None => handle.broadcast(
                "member.added",
                json!({ "user": member.user, "role": member.role }),
            ),
            Some(old) if old.role != member.role => handle.broadcast(
                "member.updated",
                json!({ "user": member.user, "role": member.role }),
            ),
            Some(_) => {}
        }
    }
}

/// Whether the write removed the file that makes a directory a space.
fn space_is_gone(handle: &SpaceHandle, relative: &Path) -> bool {
    relative == Path::new(SPACE_FILE) && matches!(handle.store.exists(relative), Ok(false))
}

/// The space directory a `spaces/<uuid>/space.yml` path names, when it is one.
fn new_space_dir(registry: &SpaceRegistry, path: &Path) -> Option<PathBuf> {
    if path.file_name()? != SPACE_FILE {
        return None;
    }
    let dir = path.parent()?;
    (dir.parent()? == registry.spaces_dir()).then(|| dir.to_owned())
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;
    use std::fs;

    use thing_core::model::{
        Filter, FilterOp, ObjectDoc, SpaceMeta, TITLE_KEY, TypeDef, ViewDef, ViewKind,
    };
    use thing_core::store::fs::FsSpaceStore;
    use thing_core::store::{SpaceStore, type_path};
    use time::macros::datetime;
    use uuid::Uuid;

    use super::*;

    fn meta() -> SpaceMeta {
        SpaceMeta {
            id: Uuid::now_v7(),
            name: "Garden".to_owned(),
            icon: None,
            timezone: "UTC".to_owned(),
            created_at: datetime!(2026-10-17 12:00:00 UTC),
            members: Vec::new(),
        }
    }

    fn plant() -> TypeDef {
        TypeDef {
            key: "plant".to_owned(),
            name: "Plant".to_owned(),
            name_plural: "Plants".to_owned(),
            icon: None,
            description: String::new(),
            schedule: false,
            schedule_labels: Default::default(),
            properties: Vec::new(),
            views: vec![ViewDef {
                key: "all".to_owned(),
                name: "All".to_owned(),
                kind: ViewKind::Table,
                sorts: Vec::new(),
                filter: Filter {
                    op: FilterOp::And,
                    conditions: Vec::new(),
                },
                columns: vec![TITLE_KEY.to_owned()],
                widths: std::collections::BTreeMap::new(),
                group_by: None,
                cover: None,
                date_property: None,
            }],
            default_view: "all".to_owned(),
        }
    }

    fn object(id: Uuid) -> ObjectDoc {
        ObjectDoc {
            id,
            type_key: "plant".to_owned(),
            title: "Fern".to_owned(),
            rev: 1,
            created_at: datetime!(2026-10-17 12:00:00 UTC),
            updated_at: datetime!(2026-10-17 12:00:00 UTC),
            created_by: Uuid::now_v7(),
            updated_by: Uuid::now_v7(),
            trashed_at: None,
            trashed_from: None,
            properties: Default::default(),
            body: String::new(),
        }
    }

    async fn next_event(
        events: &mut tokio::sync::broadcast::Receiver<crate::events::SpaceEvent>,
    ) -> crate::events::SpaceEvent {
        tokio::time::timeout(std::time::Duration::from_secs(2), events.recv())
            .await
            .expect("an event within two seconds")
            .expect("a live channel")
    }

    #[test]
    fn an_external_edit_broadcasts_the_matching_event() {
        let root = tempfile::tempdir().expect("a temporary data directory");
        let registry = SpaceRegistry::new(root.path());
        registry.prepare().expect("creates spaces/");
        let meta = meta();
        let dir = registry.spaces_dir().join(meta.id.to_string());
        let store = FsSpaceStore::create(&dir, &meta).expect("a space directory");
        let handle = registry.load(&dir).expect("a loaded space");
        let mut events = handle.events.subscribe();

        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let types = dir.join(type_path("plant"));
            store.save_type(&plant(), None).expect("writes the type");
            apply(&registry, HashSet::from([types.clone()])).await;
            let event = next_event(&mut events).await;
            assert_eq!(event.event, "type.created");
            assert_eq!(event.payload["key"], "plant");

            let mut edited = plant();
            edited.name = "Plants".to_owned();
            let expected =
                handle.with_index(|index| index.fingerprint(Path::new("types/plant.yml")));
            store.save_type(&edited, expected).expect("edits the type");
            apply(&registry, HashSet::from([types.clone()])).await;
            assert_eq!(next_event(&mut events).await.event, "type.updated");

            let id = Uuid::now_v7();
            let doc = object(id);
            let objects = Path::new("objects").join("plant").join("fern.md");
            store
                .save_object(&objects, &doc, None)
                .expect("writes an object");
            apply(&registry, HashSet::from([dir.join(objects)])).await;
            let event = next_event(&mut events).await;
            assert_eq!(event.event, "object.created");
            assert_eq!(event.payload["id"], id.to_string());

            fs::remove_file(&types).expect("an external delete");
            apply(&registry, HashSet::from([types])).await;
            assert_eq!(next_event(&mut events).await.event, "type.deleted");
        });
    }
    #[test]
    fn only_writes_are_changes() {
        use notify::event::{AccessKind, AccessMode, CreateKind, ModifyKind, RemoveKind};

        assert!(!is_change(&notify::EventKind::Access(AccessKind::Read)));
        assert!(!is_change(&notify::EventKind::Access(AccessKind::Open(
            AccessMode::Any
        ))));
        assert!(is_change(&notify::EventKind::Create(CreateKind::File)));
        assert!(is_change(&notify::EventKind::Modify(ModifyKind::Any)));
        assert!(is_change(&notify::EventKind::Remove(RemoveKind::File)));
    }

    fn loaded_space() -> (
        tempfile::TempDir,
        SpaceRegistry,
        Arc<SpaceHandle>,
        tokio::sync::broadcast::Receiver<crate::events::SpaceEvent>,
    ) {
        let root = tempfile::tempdir().expect("a temporary data directory");
        let registry = SpaceRegistry::new(root.path());
        registry.prepare().expect("creates spaces/");
        let meta = meta();
        let dir = registry.spaces_dir().join(meta.id.to_string());
        FsSpaceStore::create(&dir, &meta).expect("a space directory");
        let handle = registry.load(&dir).expect("a loaded space");
        let events = handle.events.subscribe();
        (root, registry, handle, events)
    }

    #[test]
    fn an_unparseable_object_is_announced_as_gone() {
        let (_root, registry, handle, mut events) = loaded_space();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let id = Uuid::now_v7();
            let doc = object(id);
            let relative = Path::new("objects").join("plant").join("fern.md");
            handle
                .store
                .save_object(&relative, &doc, None)
                .expect("writes an object");
            let absolute = handle.store.space_dir().join(&relative);
            apply(&registry, HashSet::from([absolute.clone()])).await;
            assert_eq!(next_event(&mut events).await.event, "object.created");

            fs::write(&absolute, "this is not frontmatter at all\n").expect("corrupts the file");
            apply(&registry, HashSet::from([absolute])).await;
            let event = next_event(&mut events).await;
            assert_eq!(event.event, "object.deleted");
            assert_eq!(event.payload["id"], id.to_string());
        });
    }

    #[test]
    fn a_manual_restore_is_announced_as_a_restore() {
        let (_root, registry, handle, mut events) = loaded_space();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let id = Uuid::now_v7();
            let doc = object(id);
            let live = Path::new("objects").join("plant").join("fern.md");
            handle
                .store
                .save_object(&live, &doc, None)
                .expect("writes an object");
            let live_absolute = handle.store.space_dir().join(&live);
            apply(&registry, HashSet::from([live_absolute.clone()])).await;
            assert_eq!(next_event(&mut events).await.event, "object.created");

            let fingerprint = handle.with_index(|index| index.fingerprint(&live));
            handle
                .store
                .move_to_trash(&live, datetime!(2026-10-17 12:30:00 UTC), fingerprint)
                .expect("trashes the object");
            let trash_relative = thing_core::store::trash_path(id);
            let trash_absolute = handle.store.space_dir().join(&trash_relative);
            apply(
                &registry,
                HashSet::from([live_absolute.clone(), trash_absolute.clone()]),
            )
            .await;
            for _ in 0..2 {
                assert_eq!(next_event(&mut events).await.event, "object.deleted");
            }

            // The user moves the file back and removes the trash copy.
            let mut restored = doc.clone();
            restored.trashed_at = None;
            restored.trashed_from = None;
            handle
                .store
                .save_object(&live, &restored, None)
                .expect("writes the object back");
            fs::remove_file(&trash_absolute).expect("removes the trash copy");
            apply(&registry, HashSet::from([live_absolute, trash_absolute])).await;
            let event = next_event(&mut events).await;
            assert_eq!(event.event, "object.restored");
            assert_eq!(event.payload["id"], id.to_string());
        });
    }

    #[test]
    fn an_external_member_change_is_announced() {
        let (_root, registry, handle, mut events) = loaded_space();
        let runtime = tokio::runtime::Runtime::new().expect("a runtime");
        runtime.block_on(async {
            let mut next = meta();
            let member = Uuid::now_v7();
            next.members = vec![Member {
                user: member,
                role: thing_core::model::Role::Viewer,
            }];
            let expected = handle.with_index(|index| index.fingerprint(Path::new("space.yml")));
            handle
                .store
                .save_space(&next, expected)
                .expect("edits space.yml");
            apply(
                &registry,
                HashSet::from([handle.store.space_dir().join("space.yml")]),
            )
            .await;

            let event = next_event(&mut events).await;
            assert_eq!(event.event, "member.added");
            assert_eq!(event.payload["user"], member.to_string());
            assert_eq!(event.payload["role"], "viewer");
            assert_eq!(next_event(&mut events).await.event, "space.updated");
        });
    }
}
