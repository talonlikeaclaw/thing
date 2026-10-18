# Repository Guidelines

## Project Overview

`thing` is a self-hosted, Anytype-inspired tracking app. Users define types and properties,
create records, track values over time, and share a space with live collaboration. Mental model
is Excel: **Type = table, Property = column, Object = row, Value = cell**, with user-defined
schema.

Two claims drive design:

- **Markdown files are canonical.** One object = one `.md` file with YAML frontmatter. Server
  keeps a rebuildable in-memory index; no database holds space content.
- **One Rust core, reused.** `thing-core` owns domain model, format, validation, query, store.
  `thing-server` is an I/O shell. Later binaries (CLI, Tauri, MCP) link the same core.

**Current state: scaffold.** `thing-core` exposes only `FORMAT_VERSION` and `VERSION`;
`thing-server` only prints its version. No store, model, validation, query, frontend, CI or
container yet. Do not assume documented paths exist.

## Architecture & Data Flow

```
.md files (YAML frontmatter + body)   SQLite (accounts/sessions/invites only)
        |                                      |
        v                                      v
  store (only FS toucher)  -------->  thing-server (axum HTTP + WS)
        |                                      |
        v                                      v
  in-memory index / query engine      React 19 SPA (web/, later)
        ^
        +-- file watcher notices external edits (notify)
```

- **`thing-core` is pure.** No network. Only `store` touches the filesystem; all other modules
  (model, markdown, validation, query, slug, value) are pure functions over data.
- **`thing-server` is the I/O shell.** Owns HTTP, WebSocket, cookies, auth, SQLite, argument
  parsing, tracing. Must not reimplement domain rules.
- **Files are the source of truth.** External edits are watched and reflected; never serve or
  overwrite stale state. Writes are atomic.
- **Planned core modules:** domain model, markdown format, validation, query engine, store. Do
  not create parallel abstractions for these.

## Key Directories

| Path | Purpose |
|---|---|
| `crates/core/` | `thing-core`: domain, format, validation, query, store |
| `crates/core/src/` | Source (currently only `lib.rs`) |
| `crates/core/tests/` | Integration tests; empty, `tempfile` available |
| `crates/server/` | `thing-server` binary, axum shell |
| `web/` | Planned Vite + React 19 SPA; **does not exist yet** |
| `data/` | Runtime space store; gitignored, never commit fixtures here |

## Development Commands

```sh
cargo build --workspace          # both crates
cargo test --workspace           # all tests (currently 1)
cargo test -p thing-core         # core crate only
cargo run -p thing-server        # prints "thing-server 0.1.0"
```

Build and test verified in this environment.

**Tooling caveat:** Nix-provided toolchain (`rustc 1.98.1`, `cargo 1.98.0`), not rustup.
`rust-toolchain.toml` requests `rustfmt` and `clippy`, but neither binary is installed, so
`cargo fmt` and `cargo clippy` fail with `no such command`. Do not claim formatting or lint
passes unless tools are installed. Expected gates once available:

```sh
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
```

## Code Conventions & Common Patterns

### Workspace and dependencies
- Edition **2024**, resolver **3**, `rust-version = "1.98"`. Do not bump casually.
- Dependency versions and features live once in root `Cargo.toml`
  `[workspace.dependencies]`; members inherit via `dep.workspace = true`. Add to the workspace
  table first, then reference from the crate.
- `Cargo.lock` is committed; keep in sync.
- Declared-but-unused deps (`argon2`, `rusqlite`, `notify`, `sha2`, `tower`, `futures-util`,
  `http-body-util`) signal planned modules; do not delete without checking the roadmap.

### Domain invariants (non-negotiable)
- Object identity is **UUIDv7** in frontmatter; renaming, moving or retyping never breaks links.
- Type and property **keys are lowercase slugs**, unique per space; frontmatter stores keys,
  never display names.
- **Unset value = absent key**, never `null`, `""` or `[]`.
- A relation whose target is gone is **kept and surfaced**, never silently dropped.
- Writes are **atomic**; conflicts are surfaced, never resolved by dropping data.
- **One spelling per concept.** No aliases, shims or parallel grammars.
- Unknown `schema` version is **refused loudly**, not guessed at.
- Space content never lives in SQLite; only accounts, sessions, invites do.

### Error handling
- `thiserror` for typed domain errors in `thing-core`; `anyhow` at binary/IO boundaries.
- Never swallow a parse or write failure. Surface it; preserve the original file.

### Serialization
- `serde` + `serde_yaml_ng` for frontmatter; `serde_json` for JSON surfaces.
- `time` for dates (features `std`, `serde`, `formatting`, `parsing`, `macros`).

### Style
- `rustfmt` defaults; 4-space indent; snake_case functions/tests, CamelCase types, kebab-case
  crate names (`thing-core`, `thing-server`).
- Module-level `//!` docs should explain boundaries, as `lib.rs` does.

## Important Files

| File | Role |
|---|---|
| `Cargo.toml` | Workspace root: members, package metadata, all dependency pins |
| `rust-toolchain.toml` | Pins Rust 1.98; requests rustfmt/clippy |
| `Cargo.lock` | Committed exact resolutions |
| `crates/core/src/lib.rs` | Core crate root; 2 consts + 1 unit test |
| `crates/server/src/main.rs` | Server entry point; prints version only |
| `README.md` | Product summary, layout, dev commands |
| `PRODUCT.md` | **Normative** product truth: stack, constraints, principles |
| `.gitignore` | Ignores `/target`, `web/dist`, `data/`, `.env` |

**Stale artifacts:** `target/doc/` and old fingerprints in `target/debug/` describe a discarded,
fuller core API (modules `error`, `markdown`, `model`, `slug`, `value`). Gitignored build residue;
not current source, not a reference. Tracked source is the only truth.

`README.md` points at `DESIGN.md` and `web/`; neither exists. Do not invent them.

## Runtime/Tooling Preferences

- **Runtime:** Rust only. Frontend (later): Vite + React 19 + Tailwind v4 + Base UI.
- **Package manager:** Cargo workspace. No npm/pnpm/bun tooling yet.
- **Compiler:** Nix-provided Rust 1.98.1, x86_64-unknown-linux-gnu. No rustup.
- **No CI, container or scripts.** PRODUCT.md lists CI, a seed script and a container as
  milestone-1 deliverables; none implemented.
- Keep `tokio`, `axum`, `rusqlite` and `notify` out of `thing-core`; they belong in the shell or
  the store boundary.

## Testing & QA

- **Framework:** built-in `cargo test`; no nextest or coverage tool configured.
- **Unit tests:** inline `#[cfg(test)] mod tests`, as in `crates/core/src/lib.rs`.
- **Integration tests:** `crates/core/tests/*.rs`. Use `tempfile` for filesystem/store fixtures;
  never write repo-root `data/`.
- **Current coverage:** one test (`format_version_is_one`). New behavior needs a test exercising
  the changed path.
- **QA:** run `cargo test --workspace` and smoke-run the changed binary. No formatter or linter
  available unless installed (see caveat).
- **Regression tests:** keep when they pin behavior, not wording or incidental details.
