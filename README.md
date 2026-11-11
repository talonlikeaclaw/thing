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
- **Editable spaces.** Rename a space, change its timezone, choose a shared highlight accent, or
  delete it by typing its name. Icons are picked from a searchable emoji grid rather than pasted in;
  the same picker serves types and records, leads with the emoji you used recently, and opens as a
  sheet on a phone. The timezone field filters as you type and offers this
  device's zone; timestamps render in the space's zone.
- **Capture from anywhere.** `C` opens a minimal capture sheet for the current page's type's
  required properties, with Create and Create-and-open; switching type keeps what you already
  typed, and the last type is remembered in the browser.
  `Cmd/Ctrl+K` opens a palette over spaces, types, records and actions, and `?` lists every
  shortcut on a keyboard-capable screen.
- **A table that behaves.** Paging, multi-select and bulk property edits, inline duplicate and
  move-to-trash with Undo, header sorting, a pinned title and dimmed stale rows. **Columns** sits
  beside Filter and Sort with a live count, and **Add property** in the trailing header or that
  panel adds an existing or new property to the type and the current view without leaving the
  table. Select and Multi-select columns sort by their option order. On a phone the row actions
  fold into one menu so property columns stay reachable, and the bottom bar carries the space
  drawer, Capture and Search within thumb reach.
- **A query you can see.** Filter, Sort and Columns open as glass popovers over the ledger on a wide
  screen and as one View sheet on a phone, so the records never move under an open panel. Every
  complete condition is a removable chip under the toolbar, and a scheduled type offers Overdue,
  Due today, Next 7 days and No due date as one tap each.
- **Schema where the data is.** A record's Properties header adds or manages fields and searches
  the list once it grows past eight; a property is chosen by typing its name, not scrolling a
  native select. The schema page is Types and Properties tabs with search and a phone master-detail
  flow, and a column can be turned into a type. Property formats are text, number, checkbox, date,
  date-time, select, multi-select, relation, recurrence, URL, email, file, image and attachments.
- **Calculated columns.** A property can hold a value the app derives instead of one you type:
  a **formula** over the record's own fields and schedule keys
  (`days(last_completed_at, today())`, `price * quantity`,
  `if(stock > 0, "In stock", "Out")`), or a **rollup** that aggregates one of the record's relation
  targets with `count`, `sum`, `min`, `max` or `list`. Both are created and edited in the same
  property forms as stored ones, with the result type chosen beside the kind and a formula reference
  that lists the fields and functions the type can use. A calculated value is read-only, filters,
  sorts and exports like a stored one, and never reaches a file; `list` is a result type that joins
  display labels (`Monstera, Fern`). Renaming a property rewrites every reference to it, and a
  referenced property or rollup target type cannot be deleted while it is named.
- **A column becomes a type.** Turn a text, select or multi-select column into a relation to a new
  type: preview every distinct value, link, view move and dropped filter, download a CSV backup,
  then run the migration as resumable target, link and finish stages. The column keeps its name
  and key, and every old value stays in the record's history.
- **CSV in and out.** Export every live record of a type, download a header-only template, and
  import a reviewed file with a dry run that names a broken row before anything is written.
- **A shared accent.** An owner chooses one of six contrast-tested highlight palettes for the
  space, and every member's open client changes live without a reload. It marks focus, selection
  and the primary action; an editor or viewer sees it but cannot change it.
- **Left- and right-handed mode.** A browser-local preference in Account settings moves the phone
  bottom bar, action rows, save buttons, row menus and toasts to the chosen thumb, in the DOM so
  paint, Tab and screen-reader order agree. It never mirrors text, icons, columns or reading order.
- **Record icons.** Give a record an emoji from its header or at capture; it then appears in the
  table's title cell, home recents, the command palette, board cards, gallery tiles and Trash. A
  record without one keeps its previous layout.
- **Files and images.** Attach a file or an image to a record; the bytes live in the space's own
  `files/` tree, named by their content, so one copy of the directory is still the whole space. A
  record can also hold a set of files and photos in one property, read as a grid of thumbnails and
  edited as one draft: upload, paste or drop, remove, and set any photo as the cover. An image
  property can fill the gallery tiles, a record can carry a 16:9 cover whose focal point is stored
  with it, and any image opens in a lightbox that steps through the whole set and closes with
  Escape. Pasting or dropping an image into a record's body stores it and renders it there. A
  missing file is reported by the space's health read and never blocks the record, and bytes a body
  still renders are never collected as unused.
- **A library of everything stored.** `/s/<space>/library` lists every file and photo in the space
  with the records that use each one, filtered by kind, type and name and sorted by recent, name or
  size. Space settings show the space's attachment weight and let an owner collect the bytes no
  record names.
- **Made for a phone.** Search, capture and every menu rise from the bottom and stay above the
  on-screen keyboard; the page uses the whole screen on a notched phone. A toast clears the keyboard
  and the bottom bar, and the emoji picker opens in front of the form it belongs to. The type
  toolbar is Search, Filter and View, with Sort and Columns inside the View sheet. Column widths
  are literal, so a drag moves the column under the finger, and phones hide the resize handles
  entirely. A phone table pins the record's name while it swipes sideways, and every control is at
  least 44 × 44 with fields at 16 px so focusing one does not zoom the page.

- **Markdown files on disk are the canonical store.** One object is one `.md` file with YAML
  frontmatter; the server keeps a rebuildable in-memory index. No database holds your content.
  Files are written as schema 7; every schema-1…6 file still loads, and a record's icon, cover and
  cover framing are optional frontmatter keys rather than properties. A record's computed blocks —
  a formula's expression, a rollup's relation and aggregate — are stored, but the values they
  produce are not: a backup of the space carries what is stored, and calculated columns are
  recomputed on read. Attachment bytes live beside the markdown in each space's `files/` tree,
  named by their content, so a copy of the space directory is the whole space.
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

# Print a space's file problems: unparseable files, dangling relations and
# attachments whose bytes are missing
cargo run -p thing-server -- reindex --space <space-uuid>
```

The first registered account needs no invite and becomes the owner. Every later account joins
through a space invite link.

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

### CSV

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
state: the markdown files, the attachment bytes under each space's `files/` tree, revision history
and the accounts database. Back it up; there is no other copy. A space's `files/.thumbs/` directory
holds derived thumbnails: exclude it to keep the backup smaller, and the next view of each image
rebuilds it. Its files must be writable by the container's UID/GID, and the server creates them
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
