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

M1 is specified in full in [`docs/plan/m1-engine-core.md`](plan/m1-engine-core.md). It is landed;
the deployment steps below are the remaining M1 work. Later milestones get their own
`docs/plan/mN-*.md` when they start, so each one is written the way this one was. M2–M10 are recorded
here so the M1 schema does not need reshaping later; each carries its decisions already made.

- **M1 — Engine core.** **Landed** — checkpoints 1–14 are implemented: spaces, members, invites,
  roles, auth; user-defined types and properties; object CRUD with a markdown body; the live
  per-type table view with filters and sorts; read-only history; trash; external file edits noticed
  and reflected; a seed script; CI; container. Deployment (the bullets below) is the remaining
  work.
- **M2 — Scheduling and reminders.** Any type may declare `schedule: true`, which adds three implicit
  properties (`due_date` (date), `recurrence` (recurrence), `last_completed_at` (datetime)) plus a
  `complete` action that writes a completion and re-phases the cadence. Recurrence = `days` |
  `weekly` | `monthly` with the chore-proven clamping rules (weekday `0`=Sun…`6`=Sat, month day
  `1–31` clamped to the month's last day); due/overdue are **calendar days in the space's IANA
  timezone**, never elapsed hours; a late completion re-phases from the day it happened. Reminders go
  out as an email digest reusing the slot-not-timer design (a `due_last_notified_on` civil date is the
  source of truth, so a restart can never double-send) plus an in-app overdue badge.
- **M3 — Importers.** `plant-tracker` (Postgres: `species`, `plants`, `care_types`, `care_plans`,
  `plant_care`, `photos`) and `chore` (Postgres: `room`, `chore`, `completion`, `household`) become
  markdown spaces. One importer binary per source, each reading via `psql`-free direct SQL and writing
  through `thing-core`'s store so every imported record gets a real revision. CSV import/export of a
  type lands here too.
- **M4 — Views.** Multiple named views per type, stored in the type file: `table`, `board` (group by a
  select property), `gallery` (cover property), `calendar` (a date property). Per-view visible
  columns, widths, sorts, filters. Views are the type's own saved query, not a separate object kind.
- **M5 — Search and linking.** Full-text search over titles and bodies with an on-disk inverted index
  rebuilt on change; in-body `[[Type/Title]]` wiki links that create a relation; a backlinks panel on
  every object; a graph view. Relation properties already exist in M1, so this is UI plus an index.
- **M6 — Files and images.** Attachments stored beside the object under `files/`, referenced from
  frontmatter; thumbnails; a `file`/`image` property format; cover images. Bytes stay on disk and in
  the backup chain.
- **M7 — Desktop.** Tauri shell around the built SPA with a local space directory that works offline.
  Sync is per object: `GET /api/spaces/{space}/objects?since=<rev>` returns changed markdown files
  verbatim, `PUT` sends the file back with `If-Match: <rev>`; a conflicting write is not merged but
  both versions are kept (the loser lands in history and in `conflicts/`), because the format cannot
  lose data it was given.
- **M8 — Agent surface.** Long-lived API tokens (a bearer alternative to the session cookie, already
  accepted by the WebSocket endpoint in M1), a generated OpenAPI document, and an MCP server exposing
  list/create/update/search over spaces. This is what lets the user's omp agents drive their own app
  the way they drive the self-hosted Anytype today.
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


The homelab repo already has the recipe; this milestone only fills it in. Postgres is **not** involved,
which makes this the first app in the fleet with no database dependency — a nightly `tar` of
`/opt/thing/data` is a complete logical backup, and vzdump already covers the LXC. Each bullet below
is its own checkpoint and its own commit, in the order listed, under the same delivery protocol as
M1; the app repo is not touched.

- `homelab/tofu/thing.tf` — VMID 216 (next free in the stable 200–249 range), hostname `thing`,
  `192.168.0.216`, 2 cores, 2048 MB RAM, 16 GB rootfs, `unprivileged = true`, keeping the
  `lifecycle { ignore_changes = [initialization[0].user_account[0]] }` guard.
- `homelab/ansible/inventory.ini` — add host `192.168.0.216` to a new `[thing]` group.
- `homelab/ansible/playbooks/thing.yml` — `app_dir=/opt/thing`, `thing_version: "v0.1.0"` pinned by
  tag, Docker install, `/opt/thing/.env` rendered at mode 0600 from `ansible/vars/thing.yml`
  (`THING_COOKIE_SECURE=true`, `THING_PUBLIC_URL=https://thing.talonlikeaclaw.com`, `THING_BIND=0.0.0.0:8080`, `THING_LISTEN_IP=0.0.0.0`),
  `docker compose pull && up -d`, and a `pg_dump`-free data volume at `/opt/thing/data`.
- `homelab/ansible/playbooks/cloudflared.yml` — add `thing → http://192.168.0.216:8080` to the ingress
  list, then rerun the playbook.
- `ssh root@192.168.0.200 cloudflared tunnel route dns homelab thing.talonlikeaclaw.com`.
- `homelab/README.md` — add the service row and update the upgrade checklist.

Production pulls the pinned image built by the `v*` CI job rather than compiling Rust on the LXC: a
Rust release build needs far more than 2 cores and 2 GB, and chore's 8 GB rootfs ENOSPC is already a
documented hazard on this fleet.
