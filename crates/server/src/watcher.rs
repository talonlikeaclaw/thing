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
use thing_core::store::{SPACE_FILE, SpaceStore};
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
            registry.remove(handle.id());
            continue;
        }
        let outcome = handle.with_index_mut(|index| index.reload_file(&handle.store, &relative));
        if let Err(err) = outcome {
            tracing::warn!(path = %path.display(), %err, "reload failed");
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
