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

**Current state: checkpoint 8 committed at `30caa56`, review fixes in the working tree.** `thing-core` exposes `model`, `error`, `slug`
(with the type/property key grammar next to the filename slugs), `value`, `markdown`, `store`
(`SpaceStore` trait + `FsSpaceStore`), `validate`, `filter`, `query` and `index` (`SpaceIndex`),
with fixture round-trip tests, filesystem tests over `tempfile::TempDir`, and table-view tests over
a space built on disk. `thing-server` has its shell (`config`, `error`, `spaces`, `watcher`,
`state`), its auth and membership surface (`accounts`, `auth`, `routes/auth`, `routes/spaces`), and
its schema and object APIs: `routes/types` (types and their saved view), `routes/properties`
(properties and options, key rename, forced removal), `routes/objects` (records, list with
filter/sort/search, raw, history, trash, restore, purge, backlinks) and `routes/values` (the
`{value, label}` rendering every response uses). `scripts/seed.sh` builds the Garden demo space
against a running server. The WebSocket and the SPA are still to come. No frontend, CI or container
yet. Do not assume documented paths exist.

## Where the plan lives

| File | Role |
|---|---|
| `docs/ROADMAP.md` | **Read first.** Locked architecture decisions, the roadmap M1–M10, the delivery protocol, the deployment plan. |
| `docs/plan/m1-engine-core.md` | The M1 execution spec: repo layout, exact dependencies, on-disk format, core and server design, web design, build order, verification, assumptions. |

M1 is in progress: **checkpoints 1–8 (scaffold; core model and format; store; index, validation and
query; server shell; auth and membership; schema and object APIs; events and the WebSocket) are
landed**; the checkpoint-8 review fixes are in the working tree awaiting review. Next is checkpoint 9,
the web scaffold.
Work proceeds one numbered checkpoint at a time — finish it, report what was built and verified, then
stop for review. If the plan is silent on something that matters, ask rather than picking silently.
Later milestones get their own `docs/plan/mN-*.md`.

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

- **`thing-core` is pure.** No network. Only `store` touches the filesystem — even the index asks
  the store whether a path exists; all other modules (model, markdown, validate, filter, query,
  slug, value) are pure functions over data.
- **Reads hand back a fingerprint, writes demand one.** `SpaceStore` reads return
  `(value, FileFingerprint)`; a write takes the fingerprint the caller last saw (`None` means "must
  be absent") and returns `Conflict` with `reason: "file changed on disk"` on a mismatch, after
  which the caller re-reads and retries. The store keeps no state, so the index owns that record.
- **`thing-server` is the I/O shell.** Owns HTTP, WebSocket, cookies, auth, SQLite, argument
  parsing, tracing. Must not reimplement domain rules.
- **Files are the source of truth.** External edits are watched and reflected; never serve or
  overwrite stale state. Writes are atomic.
- **Core modules:** `model`, `markdown`, `store`, `validate`, `filter`, `query`, `index` exist.
  The server shell, auth, the schema and object APIs, and the event bus exist; the SPA is next.

## Key Directories

| Path | Purpose |
|---|---|
| `crates/core/` | `thing-core`: domain, format, validation, query, store |
| `crates/core/src/` | Source: `lib.rs` plus one module per `docs/plan/m1-engine-core.md` §4 entry |
| `crates/core/tests/` | `roundtrip.rs` walking `fixtures/`; store tests are inline in `store/fs.rs` over `tempfile::TempDir` |
| `crates/server/` | `thing-server` binary, axum shell |
| `scripts/` | `seed.sh`: the curl walkthrough that builds the Garden demo space |
| `web/` | Planned Vite + React 19 SPA; **does not exist yet** |
| `data/` | Runtime space store; gitignored, never commit fixtures here |

## Development Commands

```sh
cargo build --workspace          # both crates
cargo test --workspace           # all tests (currently 191)
cargo test -p thing-core         # core crate only
cargo run -p thing-server        # serves ./data on 127.0.0.1:8080
cargo run -p thing-server -- set-password --email you@example.com   # reads the password from stdin
cargo run -p thing-server -- reindex --space <space-uuid>   # prints a space's file problems
THING_DATA_DIR=./data scripts/seed.sh   # builds the Garden demo space against a running server
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
- `argon2`, `rusqlite`, `notify`, `sha2`, `tower` and `http-body-util` are in use by `thing-server`
  (accounts, auth, the watcher, the HTTP tests). `futures-util` splits the WebSocket in `events.rs`.

### Domain invariants (non-negotiable)
- Object identity is **UUIDv7** in frontmatter; renaming, moving or retyping never breaks links.
- Type and property **keys are lowercase slugs**, unique per space; frontmatter stores keys,
  never display names.
- **Unset value = absent key**, never `null`, `""` or `[]`.
- A relation whose target is gone is **kept and surfaced**, never silently dropped, and never
  blocks a later edit: `validate_object` accepts it, `validate::missing_relations` and the index's
  `problems()` report it. A relation to a *trashed* object is not dangling.
- **An unparseable file is reported, not guessed at.** `SpaceIndex` leaves it out, records it in
  `problems().unparseable`, and never rewrites it; the file on disk stays untouched.
- **`title` is a column.** Filters, sorts and view columns may name it like a property key
  (`model::TITLE_KEY`); it is the only column that is not a property.
- **Query order is total**: each sort key in order, then `updated_at` newest first, then the id, so
  a table never reshuffles between identical requests. `empty: start|end` is applied *after* the
  sort direction; an empty filter passes every row whatever its operator.
- Writes are **atomic** (`<file>.tmp` → fsync → rename → fsync dir); conflicts are surfaced, never
  resolved by dropping data.
- Store paths are **relative to the space directory**; an absolute path or one containing `..` is
  refused, as is a key that is not a plain name.
- **A key is minted once.** Type and property keys derive from the display name at creation
  (`slug::key_from_name`), match `^[a-z][a-z0-9_]{0,39}$`, and are never touched by a later rename —
  except `POST /properties/{key}/rename`, which rewrites the key and the values with it. A name that
  derives a reserved frontmatter key is refused.
- **A display name is not an identity.** Option keys, not option names, are stored; changing an
  option's name or colour never moves a value, and removing an option objects still hold is refused.
- **The file follows the title.** Retitling an object writes it at its new slug and removes the old
  file; its id, revisions and body are untouched.
- **Trashing is not a write.** Delete and restore move the file, stamp `trashed_at`, and append a
  revision that repeats the object's current `rev`; only a content write increments it.
- **A PATCH merges, and `null` removes.** `properties: {"room": "study"}` sets one value without
  touching the others; `properties: {"room": null}` drops the key. Every `PATCH` carries the `rev`
  the caller read, and a different one is a `409` with `details.current_rev`.
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
| `crates/core/src/model.rs` | Domain model: every type the crate is typed against, plus the `ObjectSummary` projection, `TITLE_KEY`, `UPDATED_AT_KEY` and `RESERVED_KEYS` |
| `crates/core/src/validate.rs` | `Schema` (borrowed from the index), `validate_object`, `validate_filter`, `validate_sorts`, `missing_relations` |
| `crates/core/src/filter.rs` | `matches` / `row_matches`: one condition against one row, over every `CondOp` |
| `crates/core/src/query.rs` | `apply`: the view's filter, then its total sort order |
| `crates/core/src/index.rs` | `SpaceIndex`: a whole space in memory, `rebuild_from_disk`, `reload_file`, `problems`, `detail` |
| `crates/core/src/error.rs` | `CoreError`; the server maps it to HTTP status codes in one place |
| `crates/core/src/slug.rs` | `slugify` / `unique_slug` for filenames under `objects/<type>/`, and the key grammar: `is_valid_key`, `key_from_name`, `MAX_KEY_LEN` |
| `crates/core/src/value.rs` | Per-format YAML/JSON conversion with the property key in the error, plus ordering for sorting |
| `crates/core/src/markdown.rs` | The on-disk format: object frontmatter, space/type/property YAML, history lines |
| `crates/core/src/store/mod.rs` | The `SpaceStore` trait, `FileFingerprint`, `SpaceFile`, the layout consts plus `classify`, the path helpers (`type_path`, `property_path`, `trash_path`, `history_path`) and the property rename/removal rewrites |
| `crates/core/src/store/fs.rs` | `FsSpaceStore`: the only filesystem code, atomic writes, the write guard, `rename_property_key`/`remove_property_key` and their per-object revisions |
| `crates/core/tests/fixtures/` | Hand-written files in canonical emitted form; `invalid/` holds refused ones |
| `crates/server/src/` | `thing-server`: `main` (clap, tracing, boot), `config`, `state`, `error`, `accounts`, `auth`, `spaces`, `events`, `watcher`, `routes/{mod,auth,spaces,types,properties,objects,values}` |
| `crates/server/src/events.rs` | The per-space broadcast channel, `SpaceEvent`, and the `/events` WebSocket: origin check, `hello`, then every event; data frames close it, a lagged listener is disconnected, and a removed member or deleted space closes its sockets. API broadcast plus the watcher's echo duplicate an invalidation; that is harmless by design |
| `crates/server/src/watcher.rs` | Debounced reload of changed paths. Forwards only Create/Modify/Remove (Access events would feed a read loop), sorts the batch so `objects/` precedes `trash/`, and announces created/updated/deleted/restored/purged plus membership diffs from `space.yml` |
| `crates/server/src/routes/objects.rs` | The single object write path (mutex → validate → guarded write → revision → reload → broadcast), the list endpoint and the trash, restore and history routes |
| `crates/server/src/routes/values.rs` | The `{value, label}` rendering: option names, relation titles, missing targets, row and object JSON |
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
- **No CI or container.** PRODUCT.md lists CI and a container as milestone-1 deliverables; neither
  is implemented. `scripts/seed.sh` exists: the curl walkthrough that builds the Garden demo space
  against a running server.
- Keep `tokio`, `axum`, `rusqlite` and `notify` out of `thing-core`; they belong in the shell or
  the store boundary.

## Testing & QA

- **Framework:** built-in `cargo test`; no nextest or coverage tool configured.
- **Unit tests:** inline `#[cfg(test)] mod tests`, as in `crates/core/src/lib.rs`.
- **Integration tests:** `crates/core/tests/*.rs`. Use `tempfile` for filesystem/store fixtures;
  never write repo-root `data/`.
- **HTTP tests:** `thing-server` is a binary crate, so its tests are inline and drive the real
  router over a `tempfile::TempDir` with `tower::ServiceExt::oneshot` and
  `http_body_util::BodyExt::collect` (see `routes::tests`); that is how the auth and role rules are
  pinned.
- **Current coverage:** 200 tests (137 `thing-core`, 7 `tests/roundtrip.rs`, 56 `thing-server`) —
  one `#[cfg(test)]` module per source file. New behavior needs a test exercising the changed path.
- **Fixtures:** `crates/core/tests/fixtures/` holds one hand-written file per format concern;
  `roundtrip.rs` asserts `serialize ∘ parse` reproduces each byte for byte. Add a fixture when the
  format changes, and check it still reads like `docs/plan/m1-engine-core.md` §3.
- **QA:** run `cargo test --workspace` and smoke-run the changed binary. No formatter or linter
  available unless installed (see caveat).
- **Regression tests:** keep when they pin behavior, not wording or incidental details.
