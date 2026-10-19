//! Server configuration, read from the environment.
//!
//! No config file and no `DATABASE_URL`: every knob is one discrete variable,
//! as in the rest of the fleet.

use std::net::SocketAddr;
use std::path::PathBuf;

use anyhow::Context;

pub const DEFAULT_DATA_DIR: &str = "./data";
pub const DEFAULT_BIND: &str = "127.0.0.1:8080";
pub const DEFAULT_STATIC_DIR: &str = "web/dist";
pub const DEFAULT_LOG: &str = "info";

/// The variables this binary reads: data directory, listen address and the SPA build.
#[derive(Debug, Clone)]
pub struct Config {
    pub data_dir: PathBuf,
    pub bind: SocketAddr,
    pub static_dir: PathBuf,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        Ok(Self {
            data_dir: env_or("THING_DATA_DIR", DEFAULT_DATA_DIR).into(),
            bind: env_or("THING_BIND", DEFAULT_BIND)
                .parse()
                .context("THING_BIND is not a socket address")?,
            static_dir: env_or("THING_STATIC_DIR", DEFAULT_STATIC_DIR).into(),
        })
    }
}

/// The variable's value, or `default` when it is unset or empty.
fn env_or(name: &str, default: &str) -> String {
    match std::env::var(name) {
        Ok(value) if !value.is_empty() => value,
        _ => default.to_owned(),
    }
}
