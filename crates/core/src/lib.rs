//! `thing-core` — the domain model, validation, query engine and on-disk format.
//!
//! Nothing in this crate touches the network, and only the store touches the
//! filesystem. The server, and every later binary (CLI, Tauri desktop, MCP
//! server), link this crate and reuse the same implementation.

pub mod error;
pub mod model;
pub mod slug;
pub mod value;

/// On-disk format version written as `schema: 1` in every file.
pub const FORMAT_VERSION: u32 = 1;

/// The crate version, re-exported so binaries can print it uniformly.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_version_is_one() {
        assert_eq!(FORMAT_VERSION, 1);
    }
}
