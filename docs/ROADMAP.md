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
[`docs/plan/m4-everyday-usability.md`](plan/m4-everyday-usability.md). M1–M4 are landed; M1 is
deployed and M2–M4.1 are not. M4 is complete: checkpoints 1–13 are committed at workspace `0.4.0`.
The patch after it, v0.4.1, is implemented in
[`docs/plan/m4.1-follow-ups.md`](plan/m4.1-follow-ups.md): checkpoints 1–8 are committed at
workspace `0.4.1`, and the format is schema 4 for record icons, the shared space accent and the
schema-5 future-version fixture. The next milestone starts its own `docs/plan/mN-*.md`, written the
way these were. M5–M10 are recorded here so the format does not need reshaping later; each carries
its decisions already made.

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
- **M4 — Everyday usability.** **Landed** (workspace `0.4.0`, not yet deployed; checkpoints 1–13
  implemented); spec:
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
  is chosen in Settings. Phones get a bottom nav drawer within thumb reach, no keyboard-only
  affordances on screen, and a compact table whose row actions fold into a menu so property columns
  stay reachable; timestamps render in the space's zone.

  **v0.4.1 — everyday-usability follow-ups.** **Landed** (workspace `0.4.1`, not yet deployed;
  checkpoints 1–8 implemented, schema 4); spec:
  [`docs/plan/m4.1-follow-ups.md`](plan/m4.1-follow-ups.md). The patch after 0.4.0 collects the
  friction found in daily use: the handedness work deferred above plus the table, rail and header
  fixes below.

  - **Left/right-handed mode.** A browser-local preference. v0.4.0 assumes a right thumb and puts
    compact-editor commits at the right edge, which fixes the immediate friction; a real handedness
    mode must flip every thumb-zone surface together — the mobile bar and its sheet, action rows,
    toasts, row menus and the record save bar — and be verified in both modes. A partial flip is
    worse than a right-handed default, so it is not a 0.4.0 patch.
  - **Add columns from the table.** The table's trailing column header (and the column panel)
    offers **Add property**: choose an existing property the type does not yet carry, or create
    one inline with a name and format. The property is added to the type and to the current view's
    columns without leaving the table, and its cells are editable in place. Reuses the property
    and view APIs, writes like any other schema edit, and stays editor-only.
  - **Advertise `C` on Capture.** The `c` binding already fires on every space surface and the
    header button carries `aria-keyshortcuts="c"`, but only Search (`⌘K`) and Shortcuts (`?`) show
    a keycap. Add `C` so the existing binding is discoverable.
  - **Align the header actions to the rail.** On desktop the Capture / Search / Shortcuts cluster
    hugs the far right of the header while the page below is a rail-plus-content grid. Left-align
    the cluster to the rail's right edge so the header and the page share one grid.
  - **Types below the rail links.** In the desktop rail and the mobile sheet, move the type list
    under All spaces, Overview and the utility links, so the links stay above the fold as a space
    accumulates types.
  - **Dashboard type rows on phones.** The row carries name, key, SCHEDULED and two counts on one
    line, so the name collapses to about five letters. On narrow screens drop the key and the
    counts — keep icon, name and SCHEDULED — and give the name the row's width.
  - **Confirm sign out.** Header Sign out ends the session on the first click. Put a blocking
    confirmation (Cancel / Sign out) in front of it and say that an unsaved draft will be lost.
  - **Columns out of the kebab.** Column visibility and order are reachable only from the
    "More view actions" popover today, so the control reads as overflow plumbing. Give Columns a
    first-class toolbar button beside Filter and Sort, with the shown-column count, and keep the
    panel it opens.
  - **Select options stay on screen.** A select cell's option list is an absolutely positioned
    panel inside the table's `max-h-[70vh] overflow-auto` scroller, so it is cut off on the last
    rows. Portal the list and flip it above the cell when the space below is short, keeping
    type-to-filter, create-option and keyboard selection intact.
  - **Sort arrows say what they mean.** The column header's arrow does not communicate the active
    order reliably. Make ascending and descending unmistakable and keep the glyph, `aria-sort` and
    the Sort panel agreeing with the row order the server returns, checked on text, select and
    date columns.
  - **Select columns sort by option order.** A select or multi-select sorts its values as text
    (`value::compare` compares the keys), so a column of Kitchen, Study, Balcony comes back
    Balcony, Kitchen, Study. Sort by the option's position in the property definition instead,
    including multi-select (first differing option), and re-sort when the options are reordered;
    keep empty placement and direction unchanged.
  - **Record icons.** Objects carry no icon today; only types and spaces do. Add an optional
    `icon` to the object frontmatter (object schema 4, absent means none), reuse the type icon
    picker and emoji catalogue, and show it in the record header, table title cells, space-home
    recents, search/palette results, board cards, gallery tiles and the trash. Objects without an
    icon keep the current layout, and the icon write goes through the normal record PATCH.
  - **A shared space accent.** The accent now lives in the space (`accent` in `space.yml`,
    alongside name, icon and timezone) and is set through the owner-only space PATCH with the usual
    `space.updated` broadcast; every client applies it, so one owner's choice reaches every member
    without a reload. The v0.4 browser-local choice is read once to seed a space for an owner, then
    deleted; a non-owner's old value is never used. The six contrast-tested presets are the whole
    set, and an unknown id is a `422` field `accent`.
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
