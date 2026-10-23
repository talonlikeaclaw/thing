# thing-engine

Build an Anytype-inspired knowledge/tracking app: the end user defines their own **types** and
**properties**, creates **records** (objects), tracks them over time, and shares a **space** with other
people who see changes live. It must be legible to someone with Excel/database literacy but no coding
background — Type = table, Property = column, Object = row, Value = cell, with the Excel model made
powerful instead of restrictive. It eventually replaces the user's two existing solo projects
(`plant-tracker`, `chore`); M1 touches neither repo.

Working name is **thing** (lowercase, like the user's `chore`). The directory is
`/home/talon/Code/active/thing`. Renaming later is a find/replace over `thing`/`THING_`/`thing-core`/
`thing-server` and the container name.

## Locked decisions

Binding for every milestone. Do not re-open any of these during implementation.

1. **Rust core, one implementation, reused.** A pure `thing-core` crate holds the domain model,
   validation, query engine and file format. `thing-server` is the I/O shell. Later binaries (Tauri
   desktop, CLI, MCP server) link the same core.
2. **Markdown files on disk are the canonical store.** One object = one `.md` file with YAML
   frontmatter. The server keeps a rebuildable in-memory index. No Postgres, no content database, no
   ORM. Backups, grep, git, diff and export come free from the filesystem.
3. **Accounts live in one SQLite file** (`rusqlite`, `bundled`). Users, sessions and invite codes are
   infrastructure; they never hold space content.
4. **Web first.** Axum server serving a React 19 SPA. A Tauri desktop shell is a later milestone that
   wraps the same SPA bundle and adds a local space directory.
5. **Frontend stack:** Vite 8 + React 19 + Tailwind v4 + Base UI, TanStack Query for server state,
   Vitest + Testing Library.
6. **Many spaces per deployment**, joined by invite link, with three roles (`owner`, `editor`,
   `viewer`).
7. **Read-only history in M1:** every write appends a revision you can read; restore/undo is a later
   milestone.
8. **One markdown body per object.** Properties carry the structure; the body carries the prose.
9. **Identity is a UUID; keys are readable slugs.** Object identity lives in frontmatter as a UUIDv7,
   so renaming, retyping or moving a file never breaks a link. Property and type keys are lowercase
   slugs, unique per space, and are what frontmatter stores — never a display name, never a minted
   hex id. Display names are editable without touching data.
10. **One spelling for everything.** One filter format (JSON), one empty-value representation (key
    absent), one way to address an object (UUID). No parallel grammars, no aliases, no compatibility
    shims.
11. **Sessions are cookies.** No CORS, no token headers in the browser: dev proxies the SPA to the
    server, prod serves the SPA from the server. Same origin, always.

## Roadmap

M1 is specified in full in [`docs/plan/m1-engine-core.md`](plan/m1-engine-core.md), M2 in
[`docs/plan/m2-scheduling-recurrence.md`](plan/m2-scheduling-recurrence.md), M3 in
[`docs/plan/m3-views.md`](plan/m3-views.md) and M4 in
[`docs/plan/m4-everyday-usability.md`](plan/m4-everyday-usability.md). M1–M3 are landed; M1 is
deployed and M2 and M3 are not. M4 is in progress: checkpoints 1–3 are committed and checkpoint 4 is
in the working tree. The next milestone starts its own `docs/plan/mN-*.md`, written the way these
were. M5–M10 are recorded here so the format does not need reshaping later; each carries its
decisions already made.

**Revised 2026-10-21:** scheduling stays first, but email delivery is out; the source-specific
`plant-tracker`/`chore` importers are dropped in favour of generic CSV, and views plus everyday
usability move ahead of search.

- **M1 — Engine core.** **Landed and deployed** as `v0.1.0` — checkpoints 1–14 are implemented:
  spaces, members, invites, roles, auth; user-defined types and properties; object CRUD with a
  markdown body; the live per-type table view with filters and sorts; read-only history; trash;
  external file edits noticed and reflected; a seed script; CI; container. The deployment is
  complete; host-specific steps are kept outside this repository.
- **M2 — Scheduling and recurrence.** **Landed** (workspace `0.2.0`, not yet deployed); spec:
  [`docs/plan/m2-scheduling-recurrence.md`](plan/m2-scheduling-recurrence.md). Checkpoints 1–8 are
  implemented: format schema 2; the calendar-day schedule engine; per-type schedule vocabulary;
  Complete with a `complete` revision and optional undo; the agenda API and Schedule page; an
  in-app overdue badge; and timezone pickers on creation and settings. A type declaring
  `schedule: true` gains implicit `due_date` (date), `recurrence` (recurrence) and
  `last_completed_at` (datetime), without writing property files. Recurrence = `days` | `weekly` |
  `monthly` with the chore-proven clamping rules (weekday `0`=Sun…`6`=Sat, month day `1–31` clamped
  to the month's last day); due/overdue are **calendar days in the space's IANA timezone**, never
  elapsed hours; a late completion re-phases from the day it happened. Reminders are **in-app
  only**: an overdue badge and a due-today/upcoming surface. No email digest, push notification or
  background notifier in this milestone; if those return, they get their own milestone and the
  slot-not-timer design.
- **M3 — Views.** **Landed** (workspace `0.3.0`, not yet deployed); spec:
  [`docs/plan/m3-views.md`](plan/m3-views.md). Checkpoints 1–8 are implemented: format schema 3
  with an ordered `views` list and one `default_view`; four kinds (`table`, `board`, `gallery`,
  `calendar`); per-view filter, sorts, columns and table widths; kind-specific `group_by`, `cover`
  and `date_property`; create, rename, reconfigure, delete and choose-default over the API and in
  the SPA; a view switcher and `?view=` URL selection; immediate layout writes for editors and
  explicit **Save view** for filters and sorts. A view is the type's own saved query, not a
  separate object kind; cross-type and per-user views are not in this milestone. A schema-1 or
  schema-2 type file still loads as one `all` table view and its next write upgrades it.
- **M4 — Everyday usability.** **In progress** (checkpoints 1–3 committed; checkpoint 4 in the
  working tree); spec:
  [`docs/plan/m4-everyday-usability.md`](plan/m4-everyday-usability.md). Quick capture from anywhere
  (type picker, required properties, create-and-open), a command palette (Cmd/Ctrl+K) over spaces,
  types, records and actions, keyboard navigation and shortcuts, duplicate and move-to-trash actions
  with an undo window, multi-select and bulk edits in the table, table paging, recent items, in-place
  onboarding empty states, and responsive/touch polish. CSV import and export for any type lands
  here: it is the migration path that does not depend on a particular source application. The
  milestone also carries the UX floor the rest depends on: one space layout route, draft-safe
  navigation, local retryable write errors, truthful list state, route focus/titles, contrast and
  touch rules; the existing invite/member and type/property-delete routes gain their UI; and a
  browser-local, per-user, per-space highlight accent (lichen, yellow, orange, cyan, green, pink)
  is chosen in Settings.
- **M5 — Search and linking.** Full-text search over titles and bodies within a space, reachable
  from the command palette, with an on-disk inverted index rebuilt on change; in-body
  `[[Type/Title]]` wiki links that create a relation; a backlinks panel on every object; a graph
  view. Relation properties already exist in M1, so this is UI plus an index.
- **M6 — Files and images.** Attachments stored beside the object under `files/`, referenced from
  frontmatter; thumbnails; a `file`/`image` property format; cover images. Bytes stay on disk and in
  the backup chain.
- **M7 — Desktop.** Tauri shell around the built SPA with a local space directory that works offline.
  Sync is per object: `GET /api/spaces/{space}/objects?since=<rev>` returns changed markdown files
  verbatim, `PUT` sends the file back with `If-Match: <rev>`; a conflicting write is not merged but
  both versions are kept (the loser lands in history and in `conflicts/`), because the format cannot
  lose data it was given.
- **M8 — Agent surface.** Long-lived API tokens (a bearer alternative to the session cookie), a
  generated OpenAPI document, and an MCP server exposing list/create/update/search over spaces.
  This is what lets the user's omp agents drive their own app the way they drive the self-hosted
  Anytype today.
- **M9 — Computed properties.** `formula` (per-object expression over its own properties) and
  `rollup` (aggregate a relation's target property: count, sum, min, max, list). Read-only values,
  never stored in frontmatter.
- **M10 — History depth.** Restore a past revision, undo the last write, and a space-wide activity
  feed. M1's format already stores full property snapshots per revision, so this is addition, not
  migration.



## Delivery protocol

**Delivery protocol — applies to every step below.** Each numbered step is exactly one checkpoint and
one work unit. Do NOT run two steps in a single turn, and do NOT continue past a checkpoint on your
own initiative.

For each step, in order:

1. Do the step's work on a clean tree.
2. Run the step's own verification commands. For Rust the gate is
   `cargo build --workspace && cargo test --workspace && cargo fmt --all --check &&
   cargo clippy --workspace --all-targets -- -D warnings`; for web work `npm run lint && npm run
   typecheck`. `rustfmt` (1.9.0) and `clippy` (0.1.98) come from home-manager alongside `rustc`
   (`/etc/nixos-config/home/devbox.nix`) and are on `PATH`, so all four commands run as written
   (verified 2026-10-18). If a machine lacks them, `AGENTS.md` has the
   `nix shell nixpkgs#rustfmt nixpkgs#clippy -c ...` fallback. Never claim a formatting or lint pass
   that did not run.
3. Stop and report, in this order and no longer than it needs to be:
   - **Built** — the files created or changed, and the observable behavior that now exists.
   - **Concepts** — the Rust or React ideas this step introduced, briefly: what the construct is,
     what problem it solves here, and where to read further in the code. This project is being used
     to learn the stack, so a step whose code the user cannot follow is not finished.
   - **Decisions taken** — anything the step had to settle that the plan did not already fix, and why.
     Anything the plan did fix is not repeated.
   - **Verified** — the exact commands run and their observed output, including the failure cases that
     were exercised. Never claim a check that was not run.
   - **Inspect** — the one or two files worth reading by hand, and the fastest way to see the behavior
     in a browser, a `curl`, or a file on disk.
   - **Proposed commit** — a single imperative one-line message covering the step.
4. Wait. Do not commit — the user commits manually. Do not begin the next step until told to.

A step whose verification fails is fixed inside that step; do not carry a failure forward and do not
start the next step to "come back to it". If a step turns out to hide work for more than one sitting,
stop at a point where the tree builds and the tests pass, say so, and split the remainder into the
next checkpoint rather than leaving the tree broken.

If the plan is silent on something that matters, or looks wrong now that the code is in front of you,
**ask the user and stop** rather than picking silently. The "Decisions taken" line is for small
mechanical settlements (a helper's name, which of two equivalent call shapes) — not for quietly
narrowing scope, changing the file format, or skipping a verification.

## Deployment

**Deployed 2026-10-21** as `v0.1.0`. The deployment is a self-hosted container with a persistent
data volume; Postgres is **not** involved, so a nightly `tar` of that volume is a complete logical
backup. Host-specific provisioning, addresses and tunnel configuration are kept outside this
public repository.

- Register the first account before the instance is publicly reachable: the first account becomes
  the owner without an invite, so the instance must not be exposed unclaimed.
- Production pulls the pinned image built by the `v*` CI job rather than compiling Rust on the
  host; a Rust release build needs more memory and cores than a small deployment host typically
  has.
- Set `THING_COOKIE_SECURE=true` and `THING_PUBLIC_URL` to the deployment's own origin. The
  compose port binds loopback by default; widen `THING_BIND`/`THING_LISTEN_IP` only behind the
  tunnel.
- The data volume is the only state. Keep it on durable storage owned by the image's unprivileged
  user, and include it in the host's backup routine.
