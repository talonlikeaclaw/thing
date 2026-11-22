# Development

How to build, test, seed and run `thing`. For an overview, see the [README](../README.md); for the
complete feature list, see [`docs/FEATURES.md`](FEATURES.md).

## Prerequisites

- Rust `1.98.1` (pinned by [`rust-toolchain.toml`](../rust-toolchain.toml)); `rustfmt` and `clippy`.
- Node 24 and npm for the SPA (the production image builds on `node:24`).
- Docker only if you use a container path below.

## Repository layout

```
crates/core/     thing-core — domain model, format, validation, query, store, formulas
crates/server/   thing-server — axum HTTP shell, auth, file routes, SPA fallback
web/             Vite + React 19 SPA
docs/            plans, roadmap, feature reference
scripts/         seed, semgrep, dev-serve
```

A space on disk:

```
space.yml
types/            one <key>.yml per type
properties/       one <key>.yml per property
objects/<type>/   one <slug>.md per live record
trash/            one <uuid>.md per trashed record
history/          one <uuid>.ndjson per record
files/<sha256>/   attachment bytes, named by their content
files/.thumbs/    derived thumbnails; safe to exclude from a backup
```

## API and core

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

# Print a space's file problems: unparseable files, dangling relations and
# attachments whose bytes are missing
cargo run -p thing-server -- reindex --space <space-uuid>
```

The first registered account needs no invite and becomes the owner. Every later account joins
through a space invite link.

## Seed the demo space

With the server running, `scripts/seed.sh` builds the Garden demo space through the HTTP API. It
signs in as `THING_SEED_EMAIL` (default `a@b.c`), registers that account if the install has no such
user, and names it with `THING_SEED_NAME` (default `Talon`). On an empty install that first account
becomes the owner. There is no default password: set `THING_SEED_PASSWORD` and use the same value on
later runs. The demo space is `America/Toronto`, both types are scheduled, and the records place
work in the past, today and the coming weeks so the due surfaces have content immediately. Plant's
`Nursery` text column (two values, three links, one empty) and the `Nurseries` view exercise column
promotion; `Room` is shared by both types, which the same action reports as blocking.

```sh
THING_DATA_DIR=./data THING_SEED_PASSWORD=choose-a-real-one scripts/seed.sh

# Optional: choose the demo account instead of a@b.c / Talon.
THING_SEED_EMAIL=you@example.com THING_SEED_NAME=Talon \
  THING_SEED_PASSWORD=choose-a-real-one scripts/seed.sh
```

`THING_BASE` (default `http://127.0.0.1:8080`) points the script at a server on another port.

## SPA

Start the server first; Vite proxies `/api` (including WebSockets) to `127.0.0.1:8080`, so cookies
and same-origin requests work unchanged.

```sh
cd web
npm ci                           # or `npm install`
npm run dev                      # http://localhost:5173

# The whole web gate
npm run test:run                 # Vitest, one run
npm run lint
npm run typecheck
npm run build                    # tsc -b && vite build
```

`npm run test` starts Vitest in watch mode. `npm run preview` serves the built bundle.

## CSV

Export a type, fetch its template, then dry-run and commit an import. `-b` carries the session
cookie from a signed-in `curl`; `?dry_run=true` writes nothing.

```sh
SPACE=<space-uuid>
TYPE=plant
curl -b cookies.txt "http://localhost:8080/api/spaces/$SPACE/types/$TYPE/export" -o "$TYPE.csv"
curl -b cookies.txt "http://localhost:8080/api/spaces/$SPACE/types/$TYPE/export?template=true" -o template.csv
curl -b cookies.txt -H 'content-type: text/csv' --data-binary @"$TYPE.csv" \
  "http://localhost:8080/api/spaces/$SPACE/types/$TYPE/import?dry_run=true"
curl -b cookies.txt -H 'content-type: text/csv' --data-binary @"$TYPE.csv" \
  "http://localhost:8080/api/spaces/$SPACE/types/$TYPE/import?dry_run=false"
```

The header is `title`, the type's property keys in order, and `_body`; lists, relations,
recurrences and booleans are JSON, and an empty cell means the property is absent. Import is
create-only and all-or-nothing at validation.

## Security scan

CI runs Semgrep over the Rust, Docker, compose, YAML and web sources with the registry's `rust`,
`dockerfile`, `docker-compose`, `secrets` and `owasp-top-ten` packs. The same pinned scan runs
locally:

```sh
scripts/semgrep.sh
```

## Dev container

The repository ships a Dev Containers definition. Open the folder in VS Code and choose **Reopen
in Container**, or run the same compose file by hand:

```sh
docker compose -f docker-compose.dev.yml up --build
```

The container runs both sides of the app: `cargo watch` rebuilds and restarts the API on Rust
changes, and Vite serves the SPA with hot module replacement. Open `http://localhost:5173`; Vite
proxies `/api` (including WebSockets) to the container's `:8080`, so cookies stay same-origin.
`./data` is bind-mounted, so accounts and spaces survive container restarts. The dev ports bind to
`127.0.0.1` only; VS Code forwards them. To reach the dev server from another machine instead,
publish it on the LAN:

```sh
THING_DEV_LISTEN_IP=0.0.0.0 \
THING_DEV_PUBLIC_URL=http://192.168.1.50:5173 \
docker compose -f docker-compose.dev.yml up --build
```

Open `http://192.168.1.50:5173` with the host's own LAN address. HMR, the `/api` proxy and the SSE
`Origin` check all follow the `Host` the browser used, so nothing else needs changing;
`THING_DEV_PUBLIC_URL` only decides what invite links point at. Vite always accepts bare IP hosts,
while a name such as `devbox.local` also needs `THING_DEV_ALLOWED_HOSTS=devbox.local` (comma
separated for several). Allow `5173/tcp` from the subnet in the host firewall.

Off-subnet, Tailscale Serve reaches the same server with no published ports:
`tailscale serve --bg 5173`, then open `https://<host>.<tailnet>.ts.net`. Vite's `allowedHosts`
already lists `devbox.tail56f1e1.ts.net` for that; other tailnet names go in
`THING_DEV_ALLOWED_HOSTS`.

The image runs as UID/GID `1000` by default. Set `THING_UID`/`THING_GID` as build args when the host
user differs.

## Production container

`docker compose up --build` builds the SPA and the release binary into one image and serves it on
`http://127.0.0.1:8080`, with the space store bind-mounted at `./data`. The image is a three-stage
build (`node:24` → `rust:1.98` → `debian:13-slim`); the build output is also what a tagged CI run
pushes to `ghcr.io/talonlikeaclaw/thing:<tag>` and `:latest`.

```sh
docker compose up --build
docker compose down
```

To run the published image without a checkout, create a writable data directory and use the same
security settings as the compose file:

```sh
mkdir -p ./data
docker run -d --name thing --restart unless-stopped \
  --read-only --tmpfs /tmp \
  --cap-drop ALL --security-opt no-new-privileges:true \
  -p 127.0.0.1:8080:8080 \
  -e THING_BIND=0.0.0.0:8080 \
  -e THING_DATA_DIR=/data \
  -e THING_PUBLIC_URL=http://127.0.0.1:8080 \
  -e THING_COOKIE_SECURE=false \
  -v "$PWD/data:/data" \
  ghcr.io/talonlikeaclaw/thing:latest
```

The mount must be writable by the image's UID/GID (default `1000`).

The runtime uses a non-root `thing` user (UID/GID `1000`, overridable with
`THING_UID`/`THING_GID` build args), a read-only root filesystem with a writable `/tmp` tmpfs, all
capabilities dropped, `no-new-privileges`, and a healthcheck against `/api/health`. Base images are
pinned by digest and the build runs `cargo build --locked`. The published port defaults to
`127.0.0.1`; set `THING_LISTEN_IP=0.0.0.0` (or the host's LAN address) when a reverse proxy on
another host must reach it.

`THING_COOKIE_SECURE` defaults to `true`; set it to `false` (or use the dev compose file) when
testing over plain HTTP on localhost. Set `THING_PUBLIC_URL` in the environment (or a `.env` file
beside `docker-compose.yml`) to the URL people actually open. `./data` is the entire application
state: the markdown files, the attachment bytes under each space's `files/` tree, revision history
and the accounts database. Back it up; there is no other copy. A space's `files/.thumbs/` directory
holds derived thumbnails: exclude it to keep the backup smaller, and the next view of each image
rebuilds it. Its files must be writable by the container's UID/GID, and the server creates them
owner-only.

## Documentation

| Document | What it covers |
|---|---|
| [`docs/FEATURES.md`](FEATURES.md) | The complete feature list |
| [`docs/ROADMAP.md`](ROADMAP.md) | Milestones and what is landed |
| [`docs/plan/`](plan/) | The plan each milestone shipped against |
| [`PRODUCT.md`](../PRODUCT.md) | Users, positioning, principles and durable constraints |
| [`DESIGN.md`](../DESIGN.md) | The Night Glass visual direction |
| [`AGENTS.md`](../AGENTS.md) | Repository rules for agents working in the tree |
