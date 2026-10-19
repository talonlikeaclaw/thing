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
use thing_core::model::ObjectDoc;
use thing_core::store::{SPACE_FILE, SpaceFileKind, SpaceStore, classify, key_from_path};
use tokio::sync::mpsc;

use crate::spaces::{SpaceHandle, SpaceRegistry};

/// How long changes must stop before a batch is applied.
pub const DEBOUNCE: Duration = Duration::from_millis(300);

/// Starts watching the data directory; the watcher lives until the process exits.
pub fn spawn(registry: Arc<SpaceRegistry>) -> notify::Result<()> {
    let (tx, rx) = mpsc::unbounded_channel();
    let mut watcher =
        notify::recommended_watcher(move |event: notify::Result<notify::Event>| match event {
            Ok(event) => {
                let _ = tx.send(event.paths);
            }
            Err(err) => tracing::warn!(%err, "watch error"),
        })?;
    watcher.watch(registry.data_dir(), RecursiveMode::Recursive)?;

    tokio::spawn(run(registry, watcher, rx));
    Ok(())
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
    for path in paths {
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
        let outcome = handle.with_index_mut(|index| index.reload_file(&handle.store, &relative));
        if let Err(err) = outcome {
            tracing::warn!(path = %path.display(), %err, "reload failed");
            continue;
        }
        let present = handle.store.exists(&relative).unwrap_or(false);
        announce(&handle, &relative, &before, present);
    }
}

/// What the index held at a changed path before the file was re-read.
struct Before {
    existed: bool,
    object: Option<ObjectDoc>,
    trashed: Option<ObjectDoc>,
}

impl Before {
    fn of(index: &SpaceIndex, path: &Path) -> Self {
        Self {
            existed: index.fingerprint(path).is_some(),
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
fn announce(handle: &Arc<SpaceHandle>, path: &Path, before: &Before, present: bool) {
    let Some(kind) = classify(path) else {
        return;
    };
    match kind {
        SpaceFileKind::Space => {
            if present {
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
                    } else {
                        "object.created"
                    };
                    handle.broadcast(event, json!({ "id": id, "type": type_key, "rev": rev }));
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
                }
            } else if let Some(doc) = &before.trashed {
                handle.broadcast(
                    "object.purged",
                    json!({ "id": doc.id, "type": doc.type_key, "rev": doc.rev }),
                );
            }
        }
        SpaceFileKind::History => {}
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

    use thing_core::model::{Filter, FilterOp, ObjectDoc, SpaceMeta, TITLE_KEY, TypeDef, ViewDef};
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
            properties: Vec::new(),
            view: ViewDef {
                sorts: Vec::new(),
                filter: Filter {
                    op: FilterOp::And,
                    conditions: Vec::new(),
                },
                columns: vec![TITLE_KEY.to_owned()],
            },
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
}
