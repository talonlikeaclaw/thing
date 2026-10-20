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

```sh
# API and core
cargo build --workspace
cargo test --workspace
THING_DATA_DIR=./data cargo run -p thing-server   # 127.0.0.1:8080

# SPA (proxies /api to 127.0.0.1:8080)
cd web
npm install
npm run dev
npm run test:run && npm run lint && npm run typecheck && npm run build
```

`scripts/seed.sh` builds the Garden demo space against a running server. M1 is in progress: the
engine core, HTTP API and event stream are landed; the web app currently covers accounts, invites,
the space list and space creation. See `PRODUCT.md` for what the product is and why, `DESIGN.md`
for the visual system, and `AGENTS.md` for the current checkpoint and conventions.
