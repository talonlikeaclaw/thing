//! `thing-server`: the HTTP shell around `thing-core`.

mod accounts;
mod auth;
mod config;
mod error;
mod events;
mod routes;
mod spaces;
mod state;
mod watcher;

use std::io::Write;
use std::sync::Arc;

use anyhow::Context;
use clap::{Parser, Subcommand};
use thing_core::index::SpaceIndex;
use thing_core::store::fs::FsSpaceStore;
use uuid::Uuid;

use crate::accounts::Accounts;
use crate::config::Config;
use crate::spaces::SpaceRegistry;
use crate::state::{ACCOUNTS_FILE, AppState};

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
    /// Read a new password from stdin and store its hash. The only account
    /// recovery in M1, because there is no mail.
    SetPassword {
        #[arg(long)]
        email: String,
    },
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
        Command::SetPassword { email } => set_password(&config, &email),
        Command::Reindex { space } => reindex(&config, space),
    }
}

async fn serve(config: Config) -> anyhow::Result<()> {
    let registry = Arc::new(SpaceRegistry::new(&config.data_dir));
    registry.prepare()?;
    let loaded = registry.load_all()?;
    watcher::spawn(Arc::clone(&registry))?;

    let accounts = Accounts::open(&config.data_dir.join(ACCOUNTS_FILE))
        .context("opening the accounts database")?;
    let state = AppState::new(config.clone(), Arc::clone(&registry), accounts);
    if config.public_url.starts_with("https://") && !config.cookie_secure {
        tracing::warn!(
            public_url = %config.public_url,
            "THING_PUBLIC_URL is https but THING_COOKIE_SECURE is off; session cookies lack Secure"
        );
    }

    let listener = tokio::net::TcpListener::bind(config.bind).await?;
    tracing::info!(
        bind = %config.bind,
        data_dir = %config.data_dir.display(),
        spaces = loaded,
        accounts = state.accounts.user_count()?,
        "thing-server listening"
    );
    axum::serve(listener, routes::router(&config, state)).await?;
    Ok(())
}

/// Reads one line from stdin, hashes it, and replaces the account's hash.
fn set_password(config: &Config, email: &str) -> anyhow::Result<()> {
    let accounts = Accounts::open(&config.data_dir.join(ACCOUNTS_FILE))
        .context("opening the accounts database")?;
    let email = email.trim().to_lowercase();
    if accounts.credentials(&email)?.is_none() {
        anyhow::bail!("no account with the email {email}");
    }

    eprint!("new password for {email}: ");
    std::io::stderr().flush()?;
    let mut password = String::new();
    std::io::stdin().read_line(&mut password)?;
    let password = password.trim_end_matches(['\n', '\r']);
    if password.chars().count() < auth::MIN_PASSWORD_LEN {
        anyhow::bail!("use at least {} characters", auth::MIN_PASSWORD_LEN);
    }

    let hash = auth::hash_password(password)
        .map_err(|err| anyhow::anyhow!("hashing the password failed: {err}"))?;
    accounts.set_password(&email, &hash)?;
    eprintln!("password updated for {email}");
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
