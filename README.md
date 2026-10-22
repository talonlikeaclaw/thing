# thing

An Anytype-inspired knowledge and tracking app: you define your own **types** and
**properties**, create **records**, track them over time, and share a **space** with other
people who see changes live.

The model is deliberately Excel-shaped, because that is the model most people already understand:
a Type is a table, a Property is a column, an Object is a row, a Value is a cell. The point of
`thing` is to make that model powerful instead of restrictive.

- **Scheduled types.** A type can track a due date and repeat every N days, weeks or months.
  Complete records the completion, advances the cadence and appends a revision. Due, overdue and
  today are calendar days in the space's own IANA timezone, never elapsed hours.
- **In-app reminders.** An overdue badge in the space rail and a Schedule page with Overdue, Today
  and upcoming sections. No email, push notification or background job.
- **Named views.** Each type carries its own saved views: a table with per-view columns and
  widths, a board grouped by a select property, a gallery with a property as its cover, and a
  calendar on a date property such as a schedule's due date. Column layout saves as you edit
  it; filters and sorts save when you press **Save view**, and the selected view is in the URL.
- **Editable spaces.** Rename a space, change its timezone, or delete it by typing its name. Icons
  are picked from a searchable emoji grid rather than pasted in; the same picker serves types.

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

With the server running, `scripts/seed.sh` builds the Garden demo space through the HTTP API. It
signs in as `THING_SEED_EMAIL` (default `a@b.c`), registers that account if the install has no such
user, and names it with `THING_SEED_NAME` (default `Talon`). On an empty install that first account
becomes the owner. There is no default password: set `THING_SEED_PASSWORD` and use the same value on
later runs. The demo space is `America/Toronto`, both types are scheduled, and the records place
work in the past, today and the coming weeks so the due surfaces have content immediately.

```sh
THING_DATA_DIR=./data THING_SEED_PASSWORD=choose-a-real-one scripts/seed.sh

# Optional: choose the demo account instead of a@b.c / Talon.
THING_SEED_EMAIL=you@example.com THING_SEED_NAME=Talon \
  THING_SEED_PASSWORD=choose-a-real-one scripts/seed.sh
```

### Security scan

CI runs Semgrep over the Rust, Docker, compose, YAML and web sources with the registry's `rust`,
`dockerfile`, `docker-compose`, `secrets` and `owasp-top-ten` packs. The same pinned scan runs
locally:

```sh
scripts/semgrep.sh
```

### Dev container

The repository ships a Dev Containers definition. Open the folder in VS Code and choose **Reopen
in Container**, or run the same compose file by hand:

```sh
docker compose -f docker-compose.dev.yml up --build
```

The container runs both sides of the app: `cargo watch` rebuilds and restarts the API on Rust
changes, and Vite serves the SPA with hot module replacement. Open `http://localhost:5173`; Vite
proxies `/api` (including WebSockets) to the container's `:8080`, so cookies stay same-origin.
`./data` is bind-mounted, so accounts and spaces survive container restarts. The dev ports bind to
`127.0.0.1` only; VS Code forwards them.

The image runs as UID/GID `1000` by default. Set `THING_UID`/`THING_GID` as build args when the host
user differs.

### Production container

`docker compose up --build` builds the SPA and the release binary into one image and serves it on
`http://127.0.0.1:8080`, with the space store bind-mounted at `./data`. The image is a three-stage
build (`node:24` → `rust:1.98` → `debian:13-slim`); the build output is also what a tagged CI run
pushes to `ghcr.io/talonlikeaclaw/thing:<tag>` and `:latest`.

```sh
docker compose up --build
docker compose down
```

The runtime is hardened: a non-root `thing` user (UID/GID `1000`, overridable with
`THING_UID`/`THING_GID` build args), a read-only root filesystem with a writable `/tmp` tmpfs, all
capabilities dropped, `no-new-privileges`, and a healthcheck against `/api/health`. Base images are
pinned by digest and the build runs `cargo build --locked`. The published port defaults to
`127.0.0.1`; set `THING_LISTEN_IP=0.0.0.0` (or the host's LAN address) when a reverse proxy on
another host must reach it.

`THING_COOKIE_SECURE` defaults to `true`; set it to `false` (or use the dev compose file) when
testing over plain HTTP on localhost. Set `THING_PUBLIC_URL` in the environment (or a `.env` file
beside `docker-compose.yml`) to the URL people actually open. `./data` is the entire application
state: the markdown files, revision history and the accounts database. Back it up; there is no other
copy. Its files must be writable by the container's UID/GID, and the server creates them
owner-only.

### SPA

Start the server first; Vite proxies `/api` (including WebSockets) to `127.0.0.1:8080`, so cookies
and same-origin requests work unchanged.

```sh
cd web
npm install                      # or `npm ci` for the committed lockfile
npm run dev                      # http://localhost:5173

# The whole web gate
npm run test:run                 # Vitest, one run
npm run lint
npm run typecheck
npm run build                    # tsc -b && vite build
```

`npm run test` starts Vitest in watch mode. `npm run preview` serves the built bundle.
