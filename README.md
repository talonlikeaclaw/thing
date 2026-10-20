# thing

An Anytype-inspired knowledge and tracking app: you define your own **types** and
**properties**, create **records**, track them over time, and share a **space** with other
people who see changes live.

The model is deliberately Excel-shaped, because that is the model most people already understand:
a Type is a table, a Property is a column, an Object is a row, a Value is a cell. The point of
`thing` is to make that model powerful instead of restrictive.

- **Markdown files on disk are the canonical store.** One object is one `.md` file with YAML
  frontmatter; the server keeps a rebuildable in-memory index. No database holds your content.
- **One Rust core, reused.** `thing-core` holds the domain model, validation, query engine and
  file format. `thing-server` is the I/O shell, and later binaries (CLI, Tauri desktop, MCP
  server) link the same core.
- **Web first.** An Axum server serves a React 19 single-page app; a Tauri desktop shell wraps
  the same bundle in a later milestone.

## Layout

```
crates/core/     thing-core — domain model, format, validation, query, store
crates/server/   thing-server — axum HTTP shell
web/             Vite + React 19 SPA
```

## Development

### API and core

```sh
cargo build --workspace
cargo test --workspace
cargo test -p thing-core

# Run the API on 127.0.0.1:8080, storing spaces under ./data
THING_DATA_DIR=./data cargo run -p thing-server

# The whole Rust gate: format, lints, tests
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace

# Set a password for an existing account (reads the password from stdin)
cargo run -p thing-server -- set-password --email you@example.com

# Print the files a space could not parse or whose relations are dangling
cargo run -p thing-server -- reindex --space <space-uuid>
```

The first registered account needs no invite and becomes the owner. Every later account joins
through a space invite link.

With the server running, `scripts/seed.sh` builds the Garden demo space through the HTTP API:

```sh
THING_DATA_DIR=./data scripts/seed.sh
```

### SPA

Start the server first; Vite proxies `/api` (including WebSockets) to `127.0.0.1:8080`, so cookies
and same-origin requests work unchanged.

```sh
cd web
npm install                      # or `npm ci` for the committed lockfile
npm run dev                      # http://127.0.0.1:5173

# The whole web gate
npm run test:run                 # Vitest, one run
npm run lint
npm run typecheck
npm run build                    # tsc -b && vite build
```

`npm run test` starts Vitest in watch mode. `npm run preview` serves the built bundle.

M1 is in progress: the engine core, HTTP API and event stream are landed; the web app currently
covers accounts, invites, the space list, space creation, the schema editor and the live type table
with filters, sorts and inline edits. See `PRODUCT.md`
for what the product is and why, `DESIGN.md` for the visual system, and `AGENTS.md` for the
current checkpoint and conventions.
