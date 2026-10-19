//! Server configuration, read from the environment.
//!
//! No config file and no `DATABASE_URL`: every knob is one discrete variable,
//! as in the rest of the fleet.

use std::net::SocketAddr;
use std::path::PathBuf;

use anyhow::Context;

pub const DEFAULT_DATA_DIR: &str = "./data";
pub const DEFAULT_BIND: &str = "127.0.0.1:8080";
pub const DEFAULT_PUBLIC_URL: &str = "http://localhost:5173";
pub const DEFAULT_STATIC_DIR: &str = "web/dist";
pub const DEFAULT_LOG: &str = "info";

/// The variables this binary reads: data directory, listen address, the SPA
/// build, the public URL invite links are rendered against, and whether cookies
/// are marked `Secure`.
#[derive(Debug, Clone)]
pub struct Config {
    pub data_dir: PathBuf,
    pub bind: SocketAddr,
    pub public_url: String,
    pub static_dir: PathBuf,
    pub cookie_secure: bool,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        Ok(Self {
            data_dir: env_or("THING_DATA_DIR", DEFAULT_DATA_DIR).into(),
            bind: env_or("THING_BIND", DEFAULT_BIND)
                .parse()
                .context("THING_BIND is not a socket address")?,
            public_url: env_or("THING_PUBLIC_URL", DEFAULT_PUBLIC_URL),
            static_dir: env_or("THING_STATIC_DIR", DEFAULT_STATIC_DIR).into(),
            cookie_secure: matches!(env_or("THING_COOKIE_SECURE", "false").as_str(), "true"),
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
