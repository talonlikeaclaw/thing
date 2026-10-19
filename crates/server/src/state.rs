//! Everything a handler reaches for: the config, the spaces and the accounts.

use std::sync::Arc;

use crate::accounts::Accounts;
use crate::config::Config;
use crate::spaces::SpaceRegistry;

/// The SQLite file inside the data directory.
pub const ACCOUNTS_FILE: &str = "accounts.sqlite";

/// The one value every route closure is given.
///
/// The registry is shared with the file watcher, so both see one map of spaces.
pub struct AppState {
    pub config: Config,
    pub registry: Arc<SpaceRegistry>,
    pub accounts: Accounts,
}

/// The state as the router and its extractors hold it.
pub type SharedState = Arc<AppState>;

impl AppState {
    pub fn new(config: Config, registry: Arc<SpaceRegistry>, accounts: Accounts) -> SharedState {
        Arc::new(Self {
            config,
            registry,
            accounts,
        })
    }
}
