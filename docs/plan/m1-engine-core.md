# Milestone 1 — engine core

Everything below is the M1 execution spec. Implement top-to-bottom.

## 1. Repository layout

```
thing/
├── Cargo.toml                  # [workspace] members = ["crates/core", "crates/server"]
├── rust-toolchain.toml         # channel = "1.98"
├── .gitignore                  # /target, node_modules, web/dist, data/, .env, .DS_Store
├── README.md
├── PRODUCT.md                  # written by `impeccable init` (step 1)
├── DESIGN.md                   # authored by `impeccable document` once the UI exists (step 9)
├── AGENTS.md                   # ops/handoff doc (step 14); points at docs/ROADMAP.md
├── docs/
│   ├── ROADMAP.md              # durable home of this plan: Context, Locked decisions, M1–M10,
│   │                           #   delivery protocol, deployment
│   └── plan/m1-engine-core.md  # the M1 execution spec (§1–§10 of this plan)
├── Dockerfile                  # 3 stages: web build, rust build, runtime
├── docker-compose.yml          # dev convenience only; prod compose lives in the homelab repo
├── scripts/seed.sh             # curl walkthrough that builds the "Garden" demo space
├── .github/workflows/ci.yml
├── crates/
│   ├── core/                   # thing-core: no I/O beyond the store; unit-tested
│   └── server/                 # thing-server: axum binary
└── web/                        # Vite + React 19 SPA
```

`data/` at the repo root is the dev server's `THING_DATA_DIR`; it is gitignored.

`docs/ROADMAP.md` holds the decisions, the milestone list, the delivery protocol and the deployment
plan; this file holds the M1 spec. Together they are the source of truth for anyone — human or agent —
starting a new session: read `docs/ROADMAP.md` first, then the plan file for the milestone in
progress. Each later milestone adds its own `docs/plan/mN-*.md`. These files are updated when a
milestone lands; they are never reconstructed from a conversation.

## 2. Dependencies (exact; resolved 2026-10-17)

`Cargo.toml` `[workspace.dependencies]`:

```toml
anyhow = "1.0"
argon2 = "0.6"                                     # default features already include getrandom + password-hash
axum = { version = "0.8", features = ["ws", "macros"] }
clap = { version = "4.6", features = ["derive"] }
futures-util = "0.3"
http-body-util = "0.1"
notify = "8.2"
rusqlite = { version = "0.40", features = ["bundled"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
serde_yaml_ng = "0.10"
sha2 = "0.11"
tempfile = "3"
thiserror = "2"
time = { version = "0.3", features = ["std", "serde", "formatting", "parsing", "macros"] }
tokio = { version = "1", features = ["full"] }
tower = { version = "0.5", features = ["util"] }
tower-http = { version = "0.7", features = ["fs", "trace", "compression-gzip"] }
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }
uuid = { version = "1", features = ["v4", "v7", "rng-getrandom", "serde"] }
```

`web/package.json` — runtime: `react@19.3.1`, `react-dom@19.3.1`, `react-router@8.4.0`,
`@tanstack/react-query@5.104.3`, `@base-ui/react@1.9.0`, `react-markdown@10.1.0`, `remark-gfm@4.0.1`,
`lucide-react@^1.58.0`, `clsx@^2.1.1`, `tailwind-merge@^3.7.0`.
Dev: `vite@^8.3.4`, `@vitejs/plugin-react@^6.1.2`, `@tailwindcss/vite@^4.3.3`, `tailwindcss@^4.3.3`,
`typescript@5.9.3`, `vitest@^5.0.5`, `jsdom@^30.1.3`, `@testing-library/react@^16.3.3`,
`@testing-library/jest-dom@^7.0.1`, `@types/react@^19.3.0`, `@types/react-dom@^19.3.0`,
`eslint@^10.13.0`, `typescript-eslint@^8.71.2`.

TypeScript is pinned to 5.9.3 on purpose: `typescript-eslint@8.71.2` declares
`typescript >=4.8.4 <6.1.0`, so the current `latest` (7.0.2) would fail lint.

## 3. On-disk format

Format version constant `FORMAT_VERSION = 1`, written as `schema: 1` in every file. A reader that sees
`schema` greater than 1 refuses the file rather than guessing.

```
$THING_DATA_DIR/
├── accounts.sqlite
└── spaces/
    └── <space-uuid>/
        ├── space.yml
        ├── types/<type-key>.yml
        ├── properties/<property-key>.yml
        ├── objects/<type-key>/<slug>.md
        ├── history/<object-uuid>.ndjson
        └── trash/<object-uuid>.md
```

The space directory is named by UUID, not by name, so renaming a space never moves data. A space
directory is self-describing and portable: copy it anywhere and it still knows its schema, members and
records.

**`space.yml`**

```yaml
schema: 1
id: 0199f2c1-8f3a-7c2e-9b1d-2a4f6e8c0a1b
name: Garden
icon: "🪴"
timezone: Europe/Berlin          # IANA; M2 uses it for due/overdue, M1 only stores it
created_at: 2026-10-17T12:00:00Z
members:
  - user: 0199f2c1-1111-7c2e-9b1d-2a4f6e8c0a1b
    role: owner
  - user: 0199f2c1-2222-7c2e-9b1d-2a4f6e8c0a1b
    role: editor
```

Unknown `user` UUIDs (a space copied to another install) render as `Unknown member <uuid>` rather than
being dropped.

**`types/<key>.yml`**

```yaml
schema: 1
key: plant
name: Plant
name_plural: Plants
icon: "🪴"
description: ""
properties:
  - key: room
    required: false
    featured: true
  - key: watering_interval_days
    featured: true
view:
  sorts:
    - property: updated_at
      direction: desc
  filter:
    op: and
    conditions: []
  columns: [title, room, watering_interval_days]
```

`view` is the type's single saved table view in M1 (M4 turns it into `views`). `columns` may name
`title` plus any property key on the type, in display order.

**`properties/<key>.yml`**

```yaml
schema: 1
key: status
name: Status
format: select
options:
  - key: todo
    name: To do
    color: amber
  - key: done
    name: Done
    color: green
```

`options` is present only for `select` and `multi_select`; `target_type` is present only for
`relation` (null means any type). Frontmatter stores **option keys**, never option names, so renaming
an option's display name cannot break a single record.

**`objects/<type-key>/<slug>.md`**

```markdown
---
schema: 1
id: 0199f2c1-8f3a-7c2e-9b1d-2a4f6e8c0a1b
type: plant
title: Monstera in the study
rev: 3
created_at: 2026-10-17T12:00:00Z
updated_at: 2026-10-17T12:30:00Z
created_by: 0199f2c1-1111-7c2e-9b1d-2a4f6e8c0a1b
updated_by: 0199f2c1-1111-7c2e-9b1d-2a4f6e8c0a1b
properties:
  room: kitchen
  watering_interval_days: 7
  tags: [easy, indoors]
  last_watered: 2026-10-15
  related_plant: 0199f2c1-3333-7c2e-9b1d-2a4f6e8c0a1b
---

Watered today, new leaf unfurling at the top.
```

Rules, all enforced by `thing-core`:

- The file must begin with exactly `---\n`, then YAML, then a line `---\n`, then the body. A file with
  no frontmatter, or with `schema` missing/unsupported, is an error the reader reports — never a
  silently empty object.
- An unset value is an **absent key**. Never `null`, never `""`, never `[]`.
- `title` is required, non-empty, ≤ 200 characters. It is not a property and cannot be removed from a
  type; every type has it, it always sorts, and it is always the first column.
- Reserved frontmatter keys, which a property key may never be: `schema`, `id`, `type`, `title`,
  `rev`, `created_at`, `updated_at`, `created_by`, `updated_by`, `properties`, `trashed_at`,
  `trashed_from`.
- `rev` is a per-object counter starting at 1. Every write increments it.
- Property key and type key grammar: `^[a-z][a-z0-9_]{0,39}$`, unique within the space.
- Slug: title lowercased, runs of non-`[a-z0-9]` collapsed to `-`, trimmed, truncated at 60 chars; a
  collision inside the same type appends `-2`, `-3`. An empty result becomes `untitled`.
- Values by format: `text`/`url`/`email` → string; `number` → JSON number (float64); `checkbox` →
  bool; `date` → `YYYY-MM-DD`; `datetime` → RFC 3339 UTC string; `select` → option key string;
  `multi_select` → array of option keys, order preserved; `relation` → object UUID, or an array of
  UUIDs when the property sets `multi: true`.
- A relation value whose target no longer exists is **kept and surfaced** as `missing` in API
  responses. Never dropped, never silently zeroed.
- Writing atomicity: write `<file>.tmp` in the same directory, `rename` over the target, then fsync
  the directory. No partial file is ever visible.

**`history/<object-uuid>.ndjson`** — one JSON object per line, append-only, never rewritten:

```json
{"rev":1,"at":"2026-10-17T12:00:00Z","by":"<user-uuid>","action":"create","snapshot":{"title":"Monstera in the study","properties":{"room":"kitchen"}},"body":"Watered today."}
{"rev":2,"at":"2026-10-17T12:20:00Z","by":"<user-uuid>","action":"update","snapshot":{"title":"Monstera in the study","properties":{"room":"kitchen","watering_interval_days":7}}}
{"rev":3,"at":"2026-10-17T12:30:00Z","by":"<user-uuid>","action":"update","snapshot":{"title":"Monstera in the study","properties":{"room":"study","watering_interval_days":7}}}
```

`body` is present only on `create` or when the body changed. `action` is one of `create`, `update`,
`delete`, `restore`. `snapshot` always carries the full title and property map after the write, so a
diff of any two revisions is computed in the UI and never has to be recomputed from a diff log.

**Trash.** Deleting moves `objects/<type>/<slug>.md` to `trash/<object-uuid>.md` and adds
`trashed_at` and `trashed_from: objects/<type>/<slug>.md` to the frontmatter. Restore moves it back to
`trashed_from`, or re-slugs if that path is taken. Purge deletes the trash file and its history file.
No delete is creator-scoped: any `editor` may delete, and nothing is destroyed until purge.

## 4. `thing-core`

Modules, in dependency order. Nothing here touches the network, and only `store` touches the
filesystem.

- `model.rs` — the whole schema as Rust types. `PropertyFormat` (`Text`, `Number`, `Checkbox`, `Date`,
  `Datetime`, `Select`, `MultiSelect`, `Url`, `Email`, `Relation`), `PropertyDef { key, name, format,
  options, target_type, multi }`, `OptionDef { key, name, color }`, `TypeDef { key, name, name_plural,
  icon, description, properties: Vec<TypeProperty>, view: ViewDef }`, `TypeProperty { key, required,
  featured }`, `ViewDef { sorts: Vec<Sort>, filter: Filter, columns: Vec<String> }`, `Filter { op:
  FilterOp, conditions: Vec<Condition> }`, `Condition { property: String, condition: CondOp, value:
  Option<Value> }`, `Value` (serde-untagged: `Text(String) | Number(f64) | Bool(bool) | List(Vec<String>)`),
  `ObjectDoc { id, type_key, title, rev, created_at, updated_at, created_by, updated_by, properties:
  BTreeMap<String, Value>, body: String }`, `SpaceMeta`, `Member { user, role }`, `Role { Owner,
  Editor, Viewer }`, `Revision`, `ObjectSummary`, `ObjectDetail`.
- `error.rs` — `CoreError` via `thiserror`: `NotFound`, `AlreadyExists`, `ValidationFailed { field,
  message }`, `Conflict { reason }`, `UnsupportedFormat`, `Io`. The server maps these to HTTP status
  codes in exactly one place.
- `slug.rs` — `slugify(title) -> String`, `unique_slug(base, taken: impl Iterator<Item=&str>)`.
- `value.rs` — per-format parse from `serde_yaml_ng::Value`, serialize to YAML, JSON round-trip,
  `is_empty`, and comparison for sorting (numbers numeric, dates/datetimes chronological, everything
  else case-insensitive string order).
- `validate.rs` — `validate_object(space_schema, doc) -> Result<(), Vec<CoreError>>`: type exists,
  property keys exist on the type, values match the property's format, `required` properties are
  present and non-empty, `select`/`multi_select` keys exist in the property's options, `relation`
  targets exist (in the loaded index) and match `target_type` when set.
- `filter.rs` — `CondOp` (`Equal`, `NotEqual`, `Greater`, `Less`, `GreaterOrEqual`, `LessOrEqual`,
  `Contains`, `NotContains`, `In`, `NotIn`, `AllIn`, `IsEmpty`, `IsNotEmpty`) and `matches(condition,
  summary, index) -> bool`. `Contains` is case-insensitive substring over text/url/email. For
  `multi_select`, `In` means "shares at least one value" and `AllIn` means "contains every value".
  `IsEmpty` means the key is absent.
- `query.rs` — `apply(view, summaries) -> Vec<ObjectSummary>`: filter, then sort with `empty:
  start|end` (default `end`) and a stable tiebreak on `updated_at` desc then `id`.
- `markdown.rs` — `parse_object(text) -> Result<(ObjectDoc, ...)>` and `serialize_object(&ObjectDoc)
  -> String`, plus the type and property YAML readers/writers. Round-trip is a property test: parse ∘
  serialize is the identity for every fixture.
- `store/mod.rs` — the `SpaceStore` trait: `load_space`, `save_object`, `save_type`, `save_property`,
  `move_to_trash`, `restore`, `purge`, `append_revision`, `read_revisions`, `rename_property_key`,
  `list_files`. `store/fs.rs` — `FsSpaceStore` implementing it over a space directory, including
  atomic writes and the "file changed on disk" guard: before overwriting, compare the file's current
  mtime and length against the values recorded when it was loaded; on mismatch return
  `CoreError::Conflict` with `reason: "file changed on disk"` and re-read the file so the caller's
  retry sees fresh data.
- `index.rs` — `SpaceIndex`: everything in a space loaded into memory (`SpaceMeta`, `HashMap<String,
  TypeDef>`, `HashMap<String, PropertyDef>`, `HashMap<Uuid, ObjectDoc>`, plus per-type lists of
  summaries). `rebuild_from_disk(store)` and `reload_file(path)`. Also `problems()` returning
  unparseable files, dangling relation targets and duplicate slugs, which the API exposes.

## 5. `thing-server`

### Config

Read from the environment, no config file, no `DATABASE_URL` (matching the user's homelab
convention of discrete variables):

| var | default | meaning |
|---|---|---|
| `THING_DATA_DIR` | `./data` | root holding `accounts.sqlite` and `spaces/` |
| `THING_BIND` | `127.0.0.1:8080` | listen address |
| `THING_PUBLIC_URL` | `http://localhost:5173` | used to render invite links |
| `THING_STATIC_DIR` | `web/dist` | SPA assets; missing directory is a warning, not a failure |
| `THING_COOKIE_SECURE` | `false` | set `true` in production (behind the tunnel) |
| `THING_LOG` | `info` | `tracing-subscriber` `EnvFilter` |

### CLI

`clap` subcommands, `serve` the default:

- `thing-server` / `thing-server serve` — run the HTTP server.
- `thing-server set-password --email <email>` — read a new password from stdin, rehash with argon2,
  write the row. This is the only account-recovery path in M1 (no SMTP), so it must exist.
- `thing-server reindex --space <space-uuid>` — rebuild the index from disk, print `problems()`.

### Accounts (SQLite, `accounts.sqlite`)

Created on first start; schema versioned by `PRAGMA user_version` with an ordered ladder of `CREATE
TABLE IF NOT EXISTS` statements.

```sql
user(id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
     password_hash TEXT NOT NULL, created_at TEXT NOT NULL)
session(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL)
invite(code TEXT PRIMARY KEY, space_id TEXT NOT NULL, role TEXT NOT NULL,
       created_by TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT,
       used_by TEXT, used_at TEXT)
```

Auth rules:

- `POST /api/auth/register` `{email, password, name, invite?}`. If `user` is empty this is the
  install's first user and succeeds unconditionally. Otherwise `invite` is required and must resolve
  to a live, unused invite; the new user is added to that invite's space with the invite's role and
  the invite is marked used.
- Password: minimum 10 characters, hashed with `Argon2::default().hash_password(password)` (default
  parameters, random salt) and verified with `verify_password`.
- Session token: 64 hex characters from two UUIDv4s. Only `sha256(token)` is stored. Cookie
  `thing_session`, `HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`, plus `Secure` when
  `THING_COOKIE_SECURE=true`. Expired sessions are rejected and deleted on use.
- The WebSocket route accepts the cookie **or** `?session=<token>`, which is also the bearer path for
  non-browser clients in M8.

### Authorization

Every space route resolves the caller's membership from `space.yml` and requires a minimum role.
`owner`: rename/delete the space, create/revoke invites, change or remove members. `editor`: create,
update, delete and restore types, properties and objects. `viewer`: read-only. Non-members get `404`
for the space (not `403`) so space existence is not disclosed.

### Routes

All JSON. Errors are always `{"error":{"code":"<code>","message":"<text>","details":{...}}}` with
`code` one of `unauthenticated` (401), `forbidden` (403), `not_found` (404), `conflict` (409),
`validation_failed` (422), `internal` (500). Path parameters use axum 0.8 brace syntax.

```
POST   /api/auth/register                  {email,password,name,invite?} -> {user, spaces}
POST   /api/auth/login                     {email,password} -> {user, spaces}
POST   /api/auth/logout                    -> 204
GET    /api/auth/me                        -> {id,email,name} | 401

GET    /api/spaces                         -> [{id,name,icon,role,member_count,type_count}]
POST   /api/spaces                         {name,icon?,timezone?} -> space
GET    /api/spaces/{space}                 -> {id,name,icon,timezone,created_at,role,
                                               members:[{user,name,email,role}], type_count}
PATCH  /api/spaces/{space}                 {name?,icon?,timezone?}            [owner]
DELETE /api/spaces/{space}                 {confirm:"<space name>"}            [owner]

POST   /api/spaces/{space}/invites         {role} -> {code,url,expires_at}     [owner]
GET    /api/spaces/{space}/invites         -> [{code,role,created_at,expires_at,used_at}]  [owner]
DELETE /api/spaces/{space}/invites/{code}  -> 204                              [owner]
POST   /api/spaces/{space}/members/{user}  {role}                              [owner]
DELETE /api/spaces/{space}/members/{user}  -> 204                              [owner]

GET    /api/spaces/{space}/types           -> [{key,name,name_plural,icon,description,
                                               property_count,object_count}]
POST   /api/spaces/{space}/types           {name,name_plural?,icon?,description?}  [editor]
GET    /api/spaces/{space}/types/{key}     -> full TypeDef incl. ordered properties + view
PATCH  /api/spaces/{space}/types/{key}     {name?,name_plural?,icon?,description?,properties?,
                                            view?}                             [editor]
DELETE /api/spaces/{space}/types/{key}     ?delete_objects=true                [editor]

GET    /api/spaces/{space}/properties      -> [PropertyDef]
POST   /api/spaces/{space}/properties      {name,format,options?,target_type?,multi?}  [editor]
GET    /api/spaces/{space}/properties/{key} -> PropertyDef
PATCH  /api/spaces/{space}/properties/{key} {name?,options?}                   [editor]
POST   /api/spaces/{space}/properties/{key}/rename  {key:"new_key"}            [editor]
DELETE /api/spaces/{space}/properties/{key} ?force=true                        [editor]

GET    /api/spaces/{space}/objects?type=<key>&filter=<json>&sorts=<json>&q=<text>
                                   &limit=&offset=                             [viewer]
POST   /api/spaces/{space}/objects         {type,title,properties?,body?}      [editor]
GET    /api/spaces/{space}/objects/{id}    ?with=history,backlinks              [viewer]
PATCH  /api/spaces/{space}/objects/{id}    {title?,properties?,body?,rev}      [editor]
DELETE /api/spaces/{space}/objects/{id}    -> trashed object                   [editor]
POST   /api/spaces/{space}/objects/{id}/restore                                [editor]
GET    /api/spaces/{space}/objects/{id}/raw -> text/markdown, the file bytes   [viewer]
GET    /api/spaces/{space}/objects/{id}/history -> [{rev,at,by,action,changed}]
GET    /api/spaces/{space}/objects/{id}/history/{rev} -> {rev,at,by,action,snapshot,body?}
GET    /api/spaces/{space}/trash           -> [ObjectSummary + trashed_at]      [viewer]
DELETE /api/spaces/{space}/trash/{id}      -> purge                            [editor]
GET    /api/spaces/{space}/health          -> {problems:{unparseable,dangling_relations,
                                               duplicate_slugs}}               [viewer]
GET    /api/spaces/{space}/events          WebSocket upgrade (cookie or ?session=)  [viewer]
GET    /api/health                         -> {status:"ok",version}
```

Object list response:

```json
{"total": 12, "offset": 0, "limit": 50, "has_more": false,
 "objects": [{"id":"<uuid>","type":"plant","title":"Monstera","rev":3,
              "updated_at":"2026-10-17T12:30:00Z",
              "values":{"room":{"value":"kitchen","label":"Kitchen"},
                        "related_plant":{"value":"<uuid>","label":"Fern","missing":false}},
              "missing_relations":[]}]}
```

Each value is returned as `{value, label}` where `label` is what a table cell shows (option display
name, relation target title, formatted date) so the client never re-derives labels. `?q=` is a
case-insensitive substring match over title and body. `filter` and `sorts` are URL-encoded JSON
matching `Filter` and `Vec<Sort>`; an unknown property key or an invalid condition is
`422 validation_failed` naming the offending field.

PATCH responses are the full updated object. `PATCH` requires `rev`; a stale `rev` is `409 conflict`
with `details.current_rev`. A `409` from the on-disk mtime/length guard carries
`details.reason: "file changed on disk"`.

### Write path

One function, used by every object mutation, in this order:

1. Take the space's write mutex (per-space `Mutex<()>`), so writes serialize.
2. Validate against the index (`validate.rs`).
3. Serialize the object; compare mtime and length against the loaded snapshot; conflict aborts here.
4. `store.save_object` (atomic write), then `store.append_revision`.
5. Apply the change to the in-memory index.
6. Broadcast the event.
7. Drop the mutex.

Type, property, view and member changes follow the same order. `POST /properties/{key}/rename`
rewrites the key in the property file, in every type file that references it, and in every object file
of those types, one atomic file write at a time, appending a revision per object.

### File watcher

`notify::recommended_watcher(|_| tx.send(()) , notify::Config::default())` over the whole data
directory, recursive, debounced 300 ms. Each batch re-reads the changed paths (a path that vanished is
a removal), updates the index and broadcasts the matching event. This exists for correctness as much
as feature: the user will edit these files in their own editor, and the index must not serve or
overwrite stale state. Files that fail to parse are logged, left out of the index and reported by
`/health`, never silently dropped.

### WebSocket

`/api/spaces/{space}/events`, one broadcast channel per space behind a `tokio::sync::broadcast`. On
connect the client receives `{"event":"hello","space":"<uuid>"}` and then every event:

```json
{"event":"object.updated","space":"<uuid>","at":"2026-10-17T12:30:00Z",
 "payload":{"id":"<uuid>","type":"plant","rev":4}}
```

Events: `object.created`, `object.updated`, `object.deleted`, `object.restored`, `object.purged`,
`type.created`, `type.updated`, `type.deleted`, `property.created`, `property.updated`,
`property.deleted`, `member.added`, `member.updated`, `member.removed`, `space.updated`,
`space.deleted`. Payloads carry identity and revision only — the client invalidates and refetches
rather than merging. A client that reconnects invalidates everything for that space, so a dropped
socket cannot leave a stale screen.

## 6. `web/`

### Setup

`vite.config.ts`: `@vitejs/plugin-react`, `@tailwindcss/vite`, `server.port = 5173`, and a proxy for
`/api` to `http://127.0.0.1:8080` with `ws: true` — same origin in dev, so cookies and the WebSocket
need no CORS configuration. `build.outDir = "dist"`, `test.environment = "jsdom"`,
`test.setupFiles = ["src/test/setup.ts"]`. `tsconfig.json`: `strict`, `noUncheckedIndexedAccess`,
`jsx: react-jsx`, path alias `@/* -> src/*`. `eslint.config.js`: `typescript-eslint` recommended over
flat config, no React plugins. Scripts: `dev`, `build` (`tsc -b && vite build`), `preview`, `test`
(`vitest`), `test:run` (`vitest run`), `lint`, `typecheck` (`tsc --noEmit`).

### Structure

```
web/src/
├── main.tsx            App.tsx            router.tsx
├── styles/globals.css        @import "tailwindcss"; @theme { tokens from DESIGN.md }
├── api/client.ts             request<T>(path, init): credentials same-origin, ApiError from the
│                             error envelope, JSON in/out
├── api/queries.ts            every TanStack Query hook + mutations, with optimistic cell edits
├── api/types.ts              TS mirrors of the Rust DTOs
├── lib/use-space-events.ts   WS connect + invalidate ["space", id] on every event and on reconnect
├── lib/filter.ts             Filter ⇄ UI rows ⇄ URL param (pure)
├── lib/format.ts             value render/parse per PropertyFormat (pure)
├── components/ui/*           Base UI wrappers: button, input, textarea, select, combobox, dialog,
│                             popover, badge, toast, table primitives
├── components/space-nav.tsx  space switcher + per-space type list
├── components/type-table.tsx the live table: columns from the type's view, one row per object
├── components/filter-bar.tsx  add/remove/edit conditions, property + condition + value per format
├── components/sort-bar.tsx
├── components/property-cell.tsx   read display; click opens the matching editable input inline
├── components/property-input.tsx  one component per format, incl. select with create-on-type
├── components/object-panel.tsx    title, property list, markdown body, save state
├── components/markdown-view.tsx   react-markdown + remark-gfm, read mode
├── components/history-panel.tsx   revision list + snapshot/diff of the selected revision
├── components/schema/*.tsx        type list, type editor, property editor, option editor (drag to
│                                  reorder options and columns)
└── pages/*.tsx
```

Routes: `/login`, `/register`, `/join/:code`, `/` (space list), `/s/:spaceId` (first type or an empty
state offering "Create your first type"), `/s/:spaceId/t/:typeKey`, `/s/:spaceId/o/:objectId`,
`/s/:spaceId/schema`, `/s/:spaceId/members`, `/s/:spaceId/trash`.

Interaction rules:

- The table is the default surface. Clicking a cell opens the format's input in place; Enter commits,
  Escape cancels. Committing a cell sends `PATCH` with the `rev` currently held; a `409` shows a
  toast naming the reason and refetches the row.
- Typing a value that matches no `select` option offers "Create option" inline, which creates it and
  applies it in one action. This is deliberate: a query or a form must never refuse a value the user
  typed because the schema did not have it yet.
- The markdown body is a `<textarea>` with a read/preview toggle rendered by `markdown-view.tsx`.
  Body saves are explicit (a Save button plus Cmd/Ctrl+S), debounced-autosave is not in M1.
- `view` edits (filters, sorts, columns) are saved to the type and are therefore shared by everyone in
  the space; the table reapplies them from the server response, so two people cannot see different
  "saved" views.
- Any mutation the client does not itself trigger arrives through the WebSocket as an invalidation.

### Visual direction

Mode is **Operate**. The world must read as a file-backed, structured-data tool, in the same family as
the user's existing products (`chore`, `personal-portfolio`): dark-first with a working light mode,
near-neutral surfaces, hairline 1px borders instead of shadows, one accent used only to signal state
(overdue, unsaved, selected), tabular numerals for numbers and dates, monospace for keys, IDs, type
keys and file paths, sans for prose. Density follows the input method, not the viewport
(`pointer-coarse:` gets ≥44px targets and 16px inputs so iOS never zooms a focused field). Empty
states name the next action ("No plants yet — Create type Plant" / "This type has no records"). Tokens
live in `web/src/styles/globals.css` under `@theme` and in `DESIGN.md`; the two must agree.

## 7. Build order

**Delivery protocol:** one numbered step per turn, then stop and report. The full protocol —
what to report, the ban on running two steps in one turn, and the ask-instead-of-guessing rule —
lives in [`docs/ROADMAP.md`](../ROADMAP.md).

1. **Verify the plan files, then scaffold.** *Landed* — commits `daadd27`, `6bf9c6a`, `955dc53`,
   `04bf595`, `cb20602` on `main`, pushed to `origin` (`git@github.com:talonlikeaclaw/thing.git`). It
   produced `.gitignore`, `README.md`, `PRODUCT.md`, `AGENTS.md`, the workspace `Cargo.toml` with every
   dependency pinned as in §2, `Cargo.lock`, `rust-toolchain.toml` and the `crates/{core,server}`
   stubs: `thing-core` exposes `FORMAT_VERSION = 1` and `VERSION`, `thing-server` prints its version,
   with one unit test. `docs/ROADMAP.md` and `docs/plan/m1-engine-core.md` exist alongside it. Do not
   redo this step; re-verify with `cargo build --workspace && cargo test --workspace` and start at
   checkpoint 2. The **Code Conventions**, **Domain invariants** and **Testing** sections of
   `AGENTS.md` are normative for every later step — read them before writing code.
2. **Core model and format.** `model.rs`, `error.rs`, `slug.rs`, `value.rs`, `markdown.rs` with
   round-trip tests over hand-written fixtures covering every format, empty values, missing
   frontmatter, unknown `schema`, and unicode titles. Verify: `cargo test -p thing-core`.
3. **Store.** `store/mod.rs`, `store/fs.rs`: create a space, read it back, atomic writes, trash,
   restore, purge, revision append/read. Verify: tests over `tempfile::TempDir` asserting exact file
   bytes and the `trash/` + `history/` layout.
4. **Index, validation, query.** `index.rs`, `validate.rs`, `filter.rs`, `query.rs`, plus
   `rename_property_key`. Verify: tests for every `CondOp` on every format, sort stability and
   `empty` placement, required-property failures, dangling relations surviving a reload, and a
   key rename rewriting objects.
5. **Server shell.** Config, `main.rs` with `clap`, tracing, `SpaceRegistry` (loads every space under
   `THING_DATA_DIR` at boot, holds `RwLock<SpaceIndex>` + write mutex per space), the error-to-HTTP
   mapping, `/api/health`, SPA static serving with an `index.html` fallback for non-`/api` paths, and
   the file watcher. Verify: boot against an empty `data/`, `curl /api/health`, then a space created
   by hand on disk appears in the registry and `reindex` prints no problems.
6. **Auth and membership.** SQLite ladder, argon2, sessions, invites, membership, the role guard, and
   the first-user rule. Verify: the register/login/logout/me cycle, a second registration without an
   invite rejected, with an invite joined at the right role, and a viewer receiving `403` on a write.
7. **Schema and object APIs.** Types, properties, options, key rename; object CRUD, trash, history,
   `/raw`, list with filter/sort/search, `/health`. Verify: `scripts/seed.sh` end-to-end, then assert
   the resulting bytes of one object file and one history line.
8. **Events.** Per-space broadcast channel, the WebSocket route with cookie and `?session=` auth, the
   `hello` frame, and broadcast calls from the write path and the watcher. Verify: a `node` listener
   (Node 24 has a global `WebSocket`) sees `object.updated` while a `curl` PATCH runs.
9. **Web scaffold and auth screens.** Vite/React/Tailwind/Base UI/TanStack Query/eslint/tsc/Vitest;
   `api/client.ts`, `api/types.ts`; login, register, join, space list, space creation. Then run the
   `impeccable` new-work flow to settle the visual world, and `impeccable document` to write
   `DESIGN.md` from the built UI. Verify: sign in through the browser and land on the space list.
10. **Schema editor.** Type list, type editor (icon, names, ordered properties, view columns),
    property editor (name, format, options with colour and order), inline option creation. Verify: a
    type created in the browser appears as `types/<key>.yml` on disk with the expected YAML.
11. **Live table.** Column headers from `view.columns`, rows from the list endpoint, filter bar, sort
    bar, inline cell editing with optimistic update, `409` recovery, and WebSocket invalidation
    proven with two browser windows. Verify the two-window case explicitly.
12. **Object panel and markdown body.** The object route: full property list with per-format inputs,
    title editing, the markdown body (`<textarea>` plus a read/preview toggle), explicit save with
    Cmd/Ctrl+S, unsaved-state indication, and `409` recovery. Verify: edit an object's body and a
    property in the browser, then `cat` the `.md` file and confirm frontmatter and body both changed
    and `rev` incremented by one.
13. **History and trash.** The revision list, selection of a revision, a diff of the chosen revision
    against the previous one rendered from the stored snapshots, the trash list, restore, and purge.
    Verify: three writes to one object produce three history lines, the panel shows the diff between
    two of them, and a trashed-then-restored object returns to its original path in `objects/` with
    `trashed_at` gone and its `rev` unchanged.
14. **Docs, CI, container.** `AGENTS.md` (stack, layout, invariants, dev workflow, testing, deploy
    commands, the fact that markdown files are the backup, and `docs/ROADMAP.md` named as the first
    read for a new session), `README.md`, `Dockerfile` (three stages:
    `node:24` builds `web/dist`, `rust:1.98` builds the release binary with a dependency-cache layer,
    `debian:13-slim` runtime with the binary, `web/dist` and a `/data` volume),
    `docker-compose.yml`, `.github/workflows/ci.yml` running `cargo fmt --check`,
    `cargo clippy --all-targets -- -D warnings`, `cargo test --workspace`, then `npm ci`,
    `npm run test:run`, `npm run lint`, `npm run typecheck`, `npm run build`. A `v*` tag additionally
    builds and pushes `ghcr.io/talonlikeaclaw/thing:<tag>` and `:latest`. Also mark M1 as landed in
    `docs/ROADMAP.md` so the next session starts from an accurate list. Verify: `docker compose up
    --build`, then the seed script and the browser walkthrough against the container.

## 8. Critical files and anchors

- `crates/core/src/model.rs` — every other module is typed against these definitions; field names here
  become the JSON field names and the frontmatter keys.
- `crates/core/src/store/fs.rs` — the file layout is the product's durability contract; the atomic
  write and the mtime/length guard both live here and nowhere else.
- `crates/server/src/routes/objects.rs` — the single write path (mutex → validate → guard → write →
  revision → index → broadcast); every other mutation route copies its shape.
- `crates/server/src/events.rs` — the broadcast topology and event vocabulary the client depends on.
- `web/src/lib/filter.ts` — the one place a filter can be translated wrongly; pure and unit-tested.

## 9. Verification

Prerequisites: `cargo 1.98`, Node 24 (both verified present on this machine), and a free port 8080.

```
cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test --workspace
cd web && npm ci && npm run test:run && npm run lint && npm run typecheck && npm run build
```

End-to-end smoke, with the server running (`THING_DATA_DIR=./data cargo run -p thing-server`) and
`scripts/seed.sh` executed:

1. `curl -s localhost:8080/api/health` → `{"status":"ok","version":"0.1.0"}`.
2. Register, saving the session cookie jar: `curl -s -c /tmp/t.jar -H 'content-type: application/json'
   -d '{"email":"a@b.c","password":"correct-horse-battery","name":"Talon"}' localhost:8080/api/auth/register`
   → `201` with `{"user":{...},"spaces":[]}`.
3. `scripts/seed.sh` creates the Garden space with types `Plant` and `Chore`, the properties
   `room` (select: kitchen, study, balcony), `watering_interval_days` (number), `last_watered`
   (date), `tags` (multi_select), `related_plant` (relation → Plant) and eight objects.
4. **The file is the assertion.** `cat "data/spaces/<uuid>/objects/plant/monstera-in-the-study.md"`
   must show the frontmatter from §3 with `rev: 1`, and after a PATCH with `rev: 1` the same file must
   read `rev: 2` with the edited value, while `history/<uuid>.ndjson` has exactly two lines.
5. Filter: `curl -s -b /tmp/t.jar 'localhost:8080/api/spaces/<uuid>/objects?type=plant&filter=%7B%22op%22%3A%22and%22%2C%22conditions%22%3A%5B%7B%22property%22%3A%22room%22%2C%22condition%22%3A%22equal%22%2C%22value%22%3A%22kitchen%22%7D%5D%7D'`
   → only the kitchen plants, `total` matching, and each value carrying a `label` (`Kitchen`).
6. Conflict: PATCH the same object twice with the stale `rev` → the second returns `409` with
   `details.current_rev`.
7. External edit: append a paragraph to an object's `.md` with `sed -i`, wait one second, then
   `GET` the object → the new paragraph is present, and `GET /health` reports no problems. Revert the
   file, and confirm the object's `rev` did not change (an external edit is not a revision the app
   wrote; the next app write will record one).
8. Live: `node -e 'const ws=new WebSocket("ws://127.0.0.1:8080/api/spaces/<uuid>/events?session=<token>"); ws.onmessage=e=>console.log(e.data)'`
   prints `hello`, then `object.updated` for a concurrent `curl` PATCH.
9. Permissions: invite a second user at `viewer` via `POST /invites` + `register` with the code; that
   session's `PATCH` returns `403` and its `DELETE` of the space returns `403`.
10. Restart: kill and restart the server, `GET` the object → identical bytes, same `rev`, history
    intact (proves the index is genuinely rebuilt from disk).

UI pass (`npm run dev` in `web/`, server on 8080), as the final gate:

- Register, create a space, create a type with each property format, create records, reorder the
  columns, filter and sort, edit cells inline in two browser windows and watch the second window
  update without a refresh, edit the markdown body and confirm the preview, open the history panel
  and read a diff, delete a record, restore it from trash, invite a second user and confirm they only
  see what their role allows.
- Confirm the empty states at zero types and zero objects, and that a 375px-wide viewport keeps every
  target tappable and never zooms a focused input.

## 10. Assumptions and contingencies

- `cargo 1.98` and Node 24 are present (verified). `rustc`/`cargo` come from Nix
  (`~/.nix-profile/bin/rustc` → `/nix/store/vy0xilifxb02fwal0wihsrwc8s69rlyk-rustc-wrapper-1.98.1`),
  there is no rustup, and `cargo fmt` and `cargo clippy` both report `no such command`. So:
  `rust-toolchain.toml` is inert on this machine (leave it — it is correct for anyone with rustup),
  and the per-step Rust gate is `cargo build --workspace && cargo test --workspace`. If formatting
  and linting are wanted locally, the components have to be installed
  (`nix profile install nixpkgs#rustfmt nixpkgs#clippy`; a nixpkgs clippy must match rustc 1.98.1 or
  it refuses to run, so confirm with `cargo clippy --version` before trusting it). Until then no
  formatting or lint pass may be claimed for local work; both run in CI on a runner that has them.
- The environment has an interactive `nix` (2.34.8) but no `rustup`; do not add rustup to the
  workflow without being asked.
- An empty `spaces/` directory is a valid first run: the SPA shows the create-space form and the
  first registered user needs no invite.
- Format-version policy: bumping `FORMAT_VERSION` beyond 1 without a reader for version 1 is a data
  corruption bug, so the reader refuses unknown versions loudly.
- If `notify` proves unreliable on this host (inotify watch limits, NFS or bind-mounted trees),
  replace the watcher body with a 2-second full-directory scan comparing mtime+length; the handler
  that reindexes and broadcasts is unchanged. The mtime/length write guard already covers correctness
  if the watcher is dead.
- `POST /properties/{key}/rename` rewrites every object of every referencing type while holding the
  space write mutex. That is acceptable up to roughly ten thousand objects; beyond that it needs
  chunking and progress reporting, which is M2 work.
- A viewer-role account is expected in M1 and is the reason `404` is returned for non-member spaces:
  the two must not be confused during review.
- `Secure` cookies require HTTPS, so `THING_COOKIE_SECURE=false` in dev and `true` in the container;
  behind the Cloudflare Tunnel the origin itself stays plain HTTP.
