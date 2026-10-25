//! `thing-core` — the domain model, validation, query engine and on-disk format.
//!
//! Nothing in this crate touches the network, and only the store touches the
//! filesystem. The server, and every later binary (CLI, Tauri desktop, MCP
//! server), link this crate and reuse the same implementation.

pub mod csv;
pub mod error;
pub mod filter;
pub mod index;
pub mod markdown;
pub mod model;
pub mod query;
pub mod schedule;
pub mod slug;
pub mod store;
pub mod validate;
pub mod value;

/// Oldest on-disk format this crate still reads.
pub const MIN_FORMAT_VERSION: u32 = 1;

/// On-disk format version written as `schema: 4` in every file.
pub const FORMAT_VERSION: u32 = 4;

/// The crate version, re-exported so binaries can print it uniformly.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_version_is_four_and_still_reads_one() {
        assert_eq!(FORMAT_VERSION, 4);
        assert_eq!(MIN_FORMAT_VERSION, 1);
    }
}
