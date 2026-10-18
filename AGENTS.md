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

**Current state: checkpoint 2 landed.** `thing-core` exposes `model`, `error`, `slug`, `value`,
`markdown`, `FORMAT_VERSION` and `VERSION`, with fixture round-trip tests; `thing-server` only
prints its version. No store, validation, query, frontend, CI or container yet. Do not assume
documented paths exist.

## Where the plan lives

| File | Role |
|---|---|
| `docs/ROADMAP.md` | **Read first.** Locked architecture decisions, the roadmap M1–M10, the delivery protocol, the deployment plan. |
| `docs/plan/m1-engine-core.md` | The M1 execution spec: repo layout, exact dependencies, on-disk format, core and server design, web design, build order, verification, assumptions. |

M1 is in progress: **checkpoint 1 (scaffold) is landed and pushed**; the next work is checkpoint 2,
the core model and on-disk format. Work proceeds one numbered checkpoint at a time — finish it, report
what was built and verified, then stop for review. If the plan is silent on something that matters,
ask rather than picking silently. Later milestones get their own `docs/plan/mN-*.md`.

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
| `crates/core/src/` | Source: `lib.rs` plus one module per `docs/plan/m1-engine-core.md` §4 entry |
| `crates/core/tests/` | `roundtrip.rs` walking `fixtures/`; `tempfile` available for store tests |
| `crates/server/` | `thing-server` binary, axum shell |
| `web/` | Planned Vite + React 19 SPA; **does not exist yet** |
| `data/` | Runtime space store; gitignored, never commit fixtures here |

## Development Commands

```sh
cargo build --workspace          # both crates
cargo test --workspace           # all tests (currently 54)
cargo test -p thing-core         # core crate only
cargo run -p thing-server        # prints "thing-server 0.1.0"
```

Build and test verified in this environment.

**Tooling:** Nix-provided toolchain (`rustc 1.98.1`, `cargo 1.98.0`), not rustup;
`rust-toolchain.toml` is inert here. `rustfmt` (1.9.0) and `clippy` (0.1.98) are declared next to
`rustc` in `home.packages` (`/etc/nixos-config/home/devbox.nix`), so one nixpkgs pin keeps clippy
matched to rustc and `~/.nix-profile/bin` puts all four on `PATH` — `cargo fmt` and `cargo clippy`
work with no setup. Never hardcode a `/nix/store/...` path: a store path with no referrer is deleted
by `nix-collect-garbage`; the profile symlink is what keeps these alive.

If `cargo fmt` says `no such command: \`fmt\`` on another machine, run the gate through nixpkgs
instead of skipping it:

```sh
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
# tools not on PATH:
nix shell nixpkgs#rustfmt nixpkgs#clippy -c sh -c 'cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings'
```

Both gates are part of the checkpoint, not optional: fmt decides whitespace, clippy runs with
`-D warnings`. Never claim either pass without having run it.

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
- **Unknown keys are refused.** `deny_unknown_fields` on every document struct: a key this crate
  does not know is an error naming it, never a silent drop. `schema` is stripped and checked before
  deserializing; a version other than `FORMAT_VERSION` is refused.
- Unknown `schema` version is **refused loudly**, not guessed at.
- Space content never lives in SQLite; only accounts, sessions, invites do.

### Error handling
- `thiserror` for typed domain errors in `thing-core`; `anyhow` at binary/IO boundaries.
- Never swallow a parse or write failure. Surface it; preserve the original file.

### Serialization
- `serde` + `serde_yaml_ng` for frontmatter; `serde_json` for JSON surfaces.
- `time` for dates (features `std`, `serde`, `formatting`, `parsing`, `macros`).

### Style
- `rustfmt` defaults; 4-space indent; kebab-case crate names (`thing-core`, `thing-server`).
- **Names say what they are.** Types/traits/enum variants `PascalCase`; functions, methods,
  locals, params, modules, fields `snake_case`; consts/statics `SCREAMING_SNAKE_CASE`. Nouns for
  data (`PropertyDef`, `missing_relations`), verbs for behavior (`parse_object`, `apply`),
  booleans read as assertions (`required`, `is_empty`). No abbreviations, no type prefixes
  (`prop_string`), no `data`/`tmp`/`x`.
- **Comments are for "why", not "what".** Doc-comment public items with `///` (one line: what it
  is, any invariant not visible from the signature); module boundaries with `//!`. Inline `//`
  only where the code is surprising — an ordering constraint, a format quirk, a workaround. Never
  narrate the next line, never describe a future milestone, never restate a field name.

### Coding practices
- **Guard clauses over nesting.** Validate and `return` early; keep the happy path at one indent
  level. Extract a helper before a function's body goes past two levels of nesting.
- **Names, not magic values.** Every literal with meaning becomes a `const` or a named local
  (`MAX_KEY_LEN`, not `40`).
- **No control flow via errors or panics.** Domain failures are typed `Result` (`CoreError`);
  "absent" is `Option`. Parse with a fallible function returning `Option`/`Result`, never by
  probing with a panicking call and catching it; use `?` rather than manual matches. `unwrap` /
  `expect` only where the invariant is structurally guaranteed, with the reason in the message.
- **One implementation per behavior.** If two call sites do the same check or transform, it is a
  helper function; duplicated logic is a bug waiting to diverge.

## Important Files

| File | Role |
|---|---|
| `Cargo.toml` | Workspace root: members, package metadata, all dependency pins |
| `rust-toolchain.toml` | Pins Rust 1.98; requests rustfmt/clippy |
| `Cargo.lock` | Committed exact resolutions |
| `crates/core/src/lib.rs` | Core crate root: module list, 2 consts, 1 unit test |
| `crates/core/src/model.rs` | Domain model: every type the crate is typed against; no serde yet |
| `crates/core/src/error.rs` | `CoreError`; the server maps it to HTTP status codes in one place |
| `crates/core/src/slug.rs` | `slugify` / `unique_slug`: filenames under `objects/<type>/` |
| `crates/core/src/value.rs` | Per-format YAML/JSON conversion with the property key in the error, plus ordering for sorting |
| `crates/core/src/markdown.rs` | The on-disk format: object frontmatter, type/property YAML, history lines |
| `crates/core/tests/fixtures/` | Hand-written files in canonical emitted form; `invalid/` holds refused ones |
| `crates/server/src/main.rs` | Server entry point; prints version only |
| `README.md` | Product summary, layout, dev commands |
| `PRODUCT.md` | **Normative** product truth: stack, constraints, principles |
| `.gitignore` | Ignores `/target`, `web/dist`, `data/`, `.env` |

**Stale artifacts:** `target/doc/` and old fingerprints in `target/debug/` come from a discarded
earlier attempt. Some module names coincide with today's (`error`, `markdown`, `model`, `slug`,
`value`) but the contents differ. Gitignored build residue; not a reference. Tracked source is the
only truth.

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
- **Current coverage:** 54 tests — one `#[cfg(test)]` module per source file, plus
  `tests/roundtrip.rs`. New behavior needs a test exercising the changed path.
- **Fixtures:** `crates/core/tests/fixtures/` holds one hand-written file per format concern;
  `roundtrip.rs` asserts `serialize ∘ parse` reproduces each byte for byte. Add a fixture when the
  format changes, and check it still reads like `docs/plan/m1-engine-core.md` §3.
- **QA:** run `cargo test --workspace` and smoke-run the changed binary. No formatter or linter
  available unless installed (see caveat).
- **Regression tests:** keep when they pin behavior, not wording or incidental details.
