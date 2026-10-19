//! `thing-server`: the HTTP shell around `thing-core`.

mod config;
mod error;
mod routes;
mod spaces;
mod watcher;

use std::sync::Arc;

use anyhow::Context;
use clap::{Parser, Subcommand};
use thing_core::index::SpaceIndex;
use thing_core::store::fs::FsSpaceStore;
use uuid::Uuid;

use crate::config::Config;
use crate::spaces::SpaceRegistry;

/// The HTTP server and the maintenance commands that go with it.
#[derive(Debug, Parser)]
#[command(name = "thing-server", version = thing_core::VERSION)]
struct Cli {
    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Serve the API and the SPA. This is the default.
    Serve,
    /// Rebuild a space's index from disk and print what is wrong with its files.
    Reindex {
        /// The space's directory name under `spaces/`.
        #[arg(long)]
        space: Uuid,
    },
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    init_tracing();
    let config = Config::from_env()?;
    match Cli::parse().command.unwrap_or(Command::Serve) {
        Command::Serve => serve(config).await,
        Command::Reindex { space } => reindex(&config, space),
    }
}

async fn serve(config: Config) -> anyhow::Result<()> {
    let registry = Arc::new(SpaceRegistry::new(&config.data_dir));
    registry.prepare()?;
    let loaded = registry.load_all()?;
    watcher::spawn(Arc::clone(&registry))?;

    let listener = tokio::net::TcpListener::bind(config.bind).await?;
    tracing::info!(
        bind = %config.bind,
        data_dir = %config.data_dir.display(),
        spaces = loaded,
        "thing-server listening"
    );
    axum::serve(listener, routes::router(&config)).await?;
    Ok(())
}

fn reindex(config: &Config, space: Uuid) -> anyhow::Result<()> {
    let dir = config
        .data_dir
        .join(spaces::SPACES_DIR)
        .join(space.to_string());
    let store =
        FsSpaceStore::open(&dir).with_context(|| format!("opening space {}", dir.display()))?;
    let index = SpaceIndex::rebuild_from_disk(&store)
        .with_context(|| format!("indexing space {}", dir.display()))?;
    let problems = routes::problems_json(&index.problems());
    println!("{}", serde_json::to_string_pretty(&problems)?);
    Ok(())
}

/// Logs to stderr, filtered by `THING_LOG` (`info` by default).
fn init_tracing() {
    let filter = match std::env::var("THING_LOG") {
        Ok(value) if !value.is_empty() => value,
        _ => config::DEFAULT_LOG.to_owned(),
    };
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::new(filter))
        .init();
}
