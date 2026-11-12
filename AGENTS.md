# Repository Guidelines

> **Binding for every agent — read this whole file before the first action and again before every
> checkpoint.** The rules here are hard requirements, not suggestions. The fixed dev account
> (`a@b.c` / `devpass123`), the `./data` directory and the "the user commits; the agent never
> does" rule are absolute: do not reseed, rotate the password, write sessions into
> `data/accounts.sqlite`, stage, commit, tag or rewrite history. Run the gate that matches the
> files touched and never claim a gate that did not run. Deliver one checkpoint per turn, leave
> the changes uncommitted, update the changelog in the same working tree, and end every report
> with the **Verified**, **Test it** and **Proposed commit** sections. If a user request conflicts
> with this file, stop and ask; do not pick the simpler task, silently narrow scope, or substitute
> a plan of your own. Prior agents have ignored the fixed password and the no-commit rule; that is
> a task failure, not a preference.

## Project Overview

`thing` is a self-hosted, Anytype-inspired tracking app. Users define types and properties,
create records, track values over time, and share a space with live collaboration. Mental model
is Excel: **Type = table, Property = column, Object = row, Value = cell**, with user-defined
schema.

Two claims drive design:

- **Markdown files are canonical.** One object = one `.md` file with YAML frontmatter, and an
  attachment's bytes live beside it under the space's `files/` tree, named by their content. The
  server keeps a rebuildable in-memory index; no database holds space content.
- **One Rust core, reused.** `thing-core` owns domain model, format, validation, query, store.
  `thing-server` is an I/O shell. Later binaries (CLI, Tauri, MCP) link the same core.

**Current state: M1 is deployed as v0.1.0; M2 (`0.2.0`), M3 (`0.3.0`), M4 (`0.4.0`), the
v0.4.1 follow-ups (`0.4.1`), v0.4.2 mobile craft (`0.4.2`), v0.4.3 touch follow-through
(`0.4.3`), v0.4.4 usability sweep (`0.4.4`), v0.4.5 schedule views (`0.4.5`), M5 search,
links and the writing surface (`0.5.0`, schema 4), the v0.5.1 links, search-landing and rename
repair patch (`0.5.1`, schema 4), the v0.5.2 visual refresh, Night Glass (`0.5.2`, schema 4), and
the v0.5.3 stability pass (`0.5.3`, schema 4), M6 files and images (`0.6.0`, schema 5) and M6.1
attachments UX (`0.7.0`, schema 6), the M6.2 workspace UX patch (`0.7.1`, schema 6), M8
calculated properties (`0.8.0`, schema 7) and the M8.1 grid-interaction patch (`0.8.1`, schema 7)
are implemented, not yet tagged or deployed; CI is green.
The
v0.4.3 physical-iPhone pass is still open.**
`thing-core` exposes
`model`, `error`, `accent` (the six preset ids and `is_accent`), `slug` (with the type/property key
grammar next to the filename slugs), `value`, `markdown`, `schedule`, `csv`, `search` (`tokens`,
`SearchIndex` and `snippet`), `links` (`parse`, `LinkStatus`, the link and backlink views),
`formula` (the expression lexer, parser, static type checker, evaluator and reference rewrite) and
`compute` (property-definition validation and the request-scoped `Evaluator`), `store` (`SpaceStore` trait + `FsSpaceStore`, the `files/` and `.thumbs/` path grammar, the
attachment reads and writes and `paths_in_body`), `validate` (objects, filters, sorts and
`validate_views`), `filter`, `query` and `index` (`SpaceIndex`, including the derived search
index, the folded title map that resolves `[[Type/Title]]` links, `outgoing_links`,
`outgoing_relations`, `backlinks_of`, the owned `attachment_references` that cover bytes, property
values and body mentions share, and `view_problems`), with fixture round-trip tests, filesystem tests over
`tempfile::TempDir`, schedule tests over a fixed clock and explicit zone, and table-view tests over
a space built on disk.
`thing-server` has its shell (`config`, `error`, `spaces`, `watcher`, `state`), its auth and
membership surface (`accounts`, `auth`, `routes/auth`, `routes/spaces`), and its schema and object
APIs: `routes/search` (the ranked title-and-body read), `routes/types` (types and schedule
vocabulary), `routes/views` (named views: create, patch,
delete, default), `routes/properties`
(properties and options, key rename, forced removal), `routes/objects` (records, list with
filter/sort/search/view selection, raw, history, trash, restore, purge, the `with=links,backlinks`
detail extension — where `with=links` now also carries the read-only `links_to` projection — the
space graph, Complete, snooze and the agenda's window, range and type parameters), `routes/files` (raw upload,
the `?w=` thumbnail read, the library read that names each path's records, and the owner's garbage
collection) and `routes/values` (the `{value, label}` rendering every response uses). `scripts/seed.sh`
builds the Garden demo space against a running server, with relative due dates in
`America/Toronto`, five Plant views (table, board, gallery, calendar, nurseries) and a `Nursery`
text column seeded for the column-promotion preview. `web/` is
a Vite + React 19 SPA with the signed-out surfaces (sign in, register, invite join), the space list,
the schema editor (`pages/schema.tsx`, `components/schema/`) and the live per-type views
(`pages/type-table.tsx`, `components/type-table.tsx`, `components/views/`) with URL-backed view
selection, filters and sorts, inline cell editing with optimistic writes and `409` recovery, the
recurrence editor, WebSocket invalidation through `lib/use-space-events.ts`, the object panel with
per-format inputs, a markdown body, Complete and the `Links` panel and graph
(`pages/object.tsx`, `components/object-panel.tsx`, `components/links-panel.tsx`,
`components/graph-section.tsx`), the shared file field, attachments field and image lightbox
(`components/file-field.tsx`, `components/attachment-field.tsx`,
`components/image-lightbox.tsx`, `components/property-field.tsx`), the rendered body that resolves
a stored image and opens it in that lightbox (`components/markdown-view.tsx`,
`components/markdown-editor.tsx`), the space library (`pages/library.tsx`) and the storage section
of space settings,
the Schedule page's List and Calendar over one agenda read, its type filter and snooze
(`pages/agenda.tsx`, `components/agenda/`), the shared month grid
(`components/views/month-grid.tsx`) and the nav badge (`components/space-nav.tsx`), space settings
with name, searchable emoji icon, timezone and confirmed deletion (`pages/settings.tsx`,
`components/icon-picker.tsx`, `lib/emoji.ts`), and history and trash
(`components/history-panel.tsx`, `pages/trash.tsx`). `Dockerfile`, `docker-compose.yml` and
`.github/workflows/ci.yml` build the SPA and binary into one hardened image, run both gates plus
Semgrep, and push a tagged `ghcr.io` image; `docker-compose.dev.yml` and `.devcontainer/` run the
same app with live reload. M2–M6.1 are not tagged or deployed yet.

M4 added the everyday-use layer: quick capture and a command palette with global hotkeys
(`components/quick-capture.tsx`, `components/command-palette.tsx`, `lib/hotkeys.ts`), the space
home with browser-local recents and rail order (`pages/space.tsx`, `lib/recent.ts`,
`lib/nav-order.ts`), table paging, selection, bulk edits and row actions
(`components/type-table.tsx`, `components/views/table-view.tsx`, `components/bulk-bar.tsx`), CSV
export/import (`crates/core/src/csv.rs`, `routes/csv.rs`, `components/views/data-panel.tsx`), the
member/type/property lifecycle surfaces, and the browser-local Left-handed mode
(`pages/user-settings.tsx`, `lib/handedness.ts`, `components/handedness.tsx`).

v0.4.1 carries the follow-ups found in daily use at schema 4: left/right-handed mode moved every
thumb-zone surface through one `data-hand` attribute and a DOM-reversing `ThumbRow`
(`lib/handedness.ts`, `components/handedness.tsx`, `styles/globals.css`); **Add property** from the
table's trailing header or Columns panel with the property/type/view three-stage write and retry
(`components/add-property.tsx`, `components/views/column-panel.tsx`); record icons stored as the
`icon` frontmatter key and rendered in the record header, table title, home recents, palette, board,
gallery and trash (`components/object-panel.tsx`, `components/icon-picker.tsx`, `lib/recent.ts`);
the shared, owner-set accent in `space.yml` applied only by `SpaceLayout`, with a one-time seed from
the v0.4 local key (`lib/accent.ts`, `components/space-layout.tsx`, `components/accent-picker.tsx`);
Select/Multi-select option-order sorting in the core (`value.rs`, `query.rs`); the Columns toolbar
button; and the shell polish (Capture's `C`, header grid, rail order, phone type rows, confirmed
sign out). Mobile swaps the rail for a portaled bottom
bar and drawer carrying Capture and Search, and the table for a compact row menu; keyboard-only
affordances are hidden there, and every timestamp renders in the space's zone.

v0.4.2 is the phone patch, no server or format change: the viewport meta opts into
`viewport-fit=cover` and `interactive-widget=resizes-content`, and `lib/viewport.ts` publishes
`--vv-height` / `--vv-top` / `--kb-height` on `<html>` so the sheet geometry clears the on-screen
keyboard even on iOS; `components/ui/sheet.tsx` (`SheetViewport` / `SheetPopup`, `useSheetViewport`
mounted once from `App.tsx`) is now the only overlay geometry, used by the palette, capture,
shortcuts, add-property, the space drawer and sign-out; the palette focuses its field in the same
commit that opens it and stays mounted across handedness modes; table widths are literal
(`lib/table-widths.ts`: `savedWidths`, `widthPlan`, `dragWidth`, a filler column absorbs leftover
space, `DRAG_THRESHOLD` 3 px), with an optimistic layout write that never invalidates the object
list, no resizers on coarse pointers, a trailing spacer before the sticky action rail, and a pinned
title in one phone scroller; the type page collapses to one toolbar row with a **View** sheet, the
record title owns its line with the id behind a disclosure and no duplicated property key; and the
coarse-pointer floor is 44 px targets and 16 px inputs.

v0.4.3 finishes the touch interactions v0.4.2 opened, again with no server, format or dependency
change: `lib/media.ts` publishes `useCompactWidth` / `useCoarsePointer`, and `icon-picker.tsx` splits
its panel out so the picker is a keyboard-aware bottom sheet in front of the capture sheet or record
page on a phone, with browser-local recents (`lib/emoji-recent.ts`), open-at-current scrolling and a
32-unit custom field; toasts clear the keyboard and the phone bar; the phone type page's toolbar is
five controls with one View sheet (menu, settings, save-as, data) and a labelled "View changed"
band; capture defaults to the route's type and keeps values across a type switch; the type header
reads `— records` while its list loads; and every page meets the 11 px text floor. Small fixes:
Schedule's completion verb, Edit type deep-linking to the editor, the header's connection state no
longer moving Search and Capture, and the table's leading seam.

v0.4.4 is the usability sweep, web-only and again with no server, format or dependency change:
Schedule gains the table's Undo, a whole-row link and named horizon controls (`pages/agenda.tsx`);
record-page trash gains Undo and a completion toast names its record (`components/object-panel.tsx`);
the view strip wraps at every width and reorders saved views in place, while the phone toolbar's
View sheet is renamed More (`components/views/view-tabs.tsx`, `components/type-table.tsx`); board
and gallery cards print property names and the gallery cover is a tinted band
(`components/views/board-view.tsx`, `gallery-view.tsx`, `lib/format.ts`); the phone Columns panel
drops the mono key and the desktop width advice, and an empty type offers Import CSV directly
(`components/views/column-panel.tsx`); the calendar opens on the current week and Today scrolls to
today's row (`components/views/calendar-view.tsx`); a record's relation reads as chips with the
picker collapsed and targets fetched only on demand (`components/property-field.tsx`,
`lib/format.ts`); and the loose ends are closed: a fresh home hides an empty Recent
section (`pages/space.tsx`), quick capture confirms a discard (`components/quick-capture.tsx`), a
phone shows an amber connection dot (`components/app-shell.tsx`), the palette says titles
(`components/command-palette.tsx`), the accent reset says reset and the last owner's controls are
disabled (`pages/settings.tsx`, `pages/members.tsx`).

v0.4.5 turns Schedule into two views of one read, still at schema 4: the agenda route returns one
`rows` array plus `later_count` and takes `days` or an inclusive `from`/`to` range and a `types`
filter (`components/agenda/agenda-list.tsx` projects the List's buckets from `status`), the
Calendar renders those rows through the extracted `MonthGrid` the type calendar now shares
(`components/agenda/agenda-calendar.tsx`, `components/views/month-grid.tsx`, `lib/views.ts`), and
`lib/agenda.ts` carries the page state — view, horizon, month and types — in the query string with
browser-local storage as the fallback (`lib/agenda.ts`, following `lib/recent.ts`). A type filter
presents as a popover on a fine pointer and a sheet on a phone (`components/agenda/type-filter.tsx`).
A record can be snoozed for 1–90 days from a List row or a calendar day: `schedule::snooze` writes
only `due_date` as `max(due, today) + days`, sharing `complete`'s base-day rule, and
`POST …/objects/{object}/snooze` records an `update` revision (`crates/core/src/schedule.rs`,
`routes/objects.rs`, `components/agenda/snooze-menu.tsx`); the toast's Undo PATCHes the previous
date. No body-format or schema change, one new route, no new dependency. The v0.4.5 device pass had
emulation only; the physical-iPhone gate stays open.

M5 adds search, links and the writing surface at schema 4: `search.rs` tokenizes lowercase
alphanumeric runs and keeps one in-memory inverted index per space (folded title phrase, title
tokens and capped body counts, updated per object), exposed through
`GET /api/spaces/{space}/search` and the palette's debounced `useSearch` with server order and
snippets (`crates/core/src/search.rs`, `routes/search.rs`, `components/command-palette.tsx`,
`lib/debounce.ts`). `links.rs` parses `[[Type/Title]]` outside fences, inline code and escapes;
`SpaceIndex` folds live titles into a resolution map, and the record read takes `with=links`
(outgoing `LinkView`s) and enriches `with=backlinks` with relation and mention rows
(`crates/core/src/links.rs`, `crates/core/src/index.rs`, `routes/objects.rs`,
`components/links-panel.tsx`). The record body gains a textarea editor whose toolbar, shortcuts,
list continuation, `/` commands and `[[` autocomplete are pure functions over value and selection,
with the read renderer as a split preview from `lg` (`lib/markdown-edit.ts`,
`components/markdown-editor.tsx`). The links panel adds `Local` and `Space` graph scopes in plain
SVG over the same detail read, with deterministic ring layout, a 24-node local cap, pan/zoom and
view-only node offsets (`lib/graph.ts`, `components/graph-section.tsx`,
`components/graph-canvas.tsx`). No dependency was added, no object file gains a key, and the
physical-iPhone gate still precedes any keyboard claim.

v0.5.1 is the trust patch, still at schema 4 and with no new route or dependency: `with=links`
gains `links_to`, a stable projection of resolved outgoing relations and body mentions, and the
Links panel renders `Links to`, `Linked from` and `Mentioned in` from that one read while the local
graph draws both directions (`routes/objects.rs`, `components/links-panel.tsx`, `lib/graph.ts`).
Search results carry `?q=` to the record, `MarkdownView` marks every occurrence and scrolls the
first one into view without stealing focus (`pages/object.tsx`, `components/markdown-view.tsx`).
The editor gains an H1–H3 heading menu, paste-a-URL-over-selection, tap-preview-to-write and a
create row for an unresolved `[[type/Title]]` (`components/markdown-editor.tsx`,
`lib/markdown-edit.ts`, `lib/wiki-links.ts`). A title change that would strand mentions opens a
preview listing each source, and `Update links` rewrites exactly the occurrences that resolved to
the record before the rename through independent ordinary PATCHes; stale sources are skipped and
reported (`components/rename-links-dialog.tsx`, `lib/wiki-links.ts::rewriteMentions`,
`components/object-panel.tsx`). On a coarse pointer, Write becomes a fixed writing sheet against
the visual viewport: the page, navigation and page save bar step aside, Save moves into the toolbar,
and a visible Done action returns the page at its prior scroll; a toolbar edit keeps its
caret inside the textarea's scrollport for both typing and toolbar edits, with a three-line lower
margin and a re-reveal while Safari's keyboard settles. `web/src/test/harness.tsx` adds a component-test layer over the real editor, palette, links
panel and rename flow. No object file gains a key, `FORMAT_VERSION` stays
`4`. The v0.5.2 visual refresh is Night Glass: frosted chrome over matte data surfaces, a floating
phone dock, a cover-sheet space home, a specimen-sheet record, ledger tables, one command surface,
one page header for the quiet surfaces, and one date grammar (`styles/globals.css`, `components/`,
`pages/`, `DESIGN.md`, `.impeccable/design.json`). No route, read, permission, format or editor
command changes; `FORMAT_VERSION` stays `4`. The v0.5.3 stability pass adds no route, read or
format: it fixes the map's label placement, brings every finger target to 44 px, folds the desktop
rail to icons, states failed reads with the server's sentence and a Retry, and brings one voice to
the type page, the schedule's empty period and the ledger header.

M6 adds files and images at schema 5: attachment bytes are canonical under each space's
`files/<sha256>/<name>` tree, written through `SpaceStore` and read by one member-only route;
`cover`, `cover_position` and the `file`/`image` property formats join the frontmatter
(`crates/core/src/store/mod.rs`, `crates/core/src/markdown.rs`, `crates/server/src/routes/files.rs`).
An image is served inline with a content-hash ETag and a lazily cached 256 or 512 px thumbnail in
`files/.thumbs/`; PNG, JPEG, WebP and GIF are decoded, SVG is refused. A record's 16:9 cover stores
its focal point as two percentages, the gallery draws an image cover property with the record cover
as fallback, and one lightbox serves the record hero, a tile and an image value. Purge and the
owner's collection remove bytes no live or trashed object names; a missing file is reported by the
space health read and never blocks a record (`components/file-field.tsx`,
`components/image-lightbox.tsx`, `components/views/gallery-view.tsx`, `routes/files.rs`,
`crates/core/src/index.rs`). No new dependency beyond the pinned `image` decoder.

M6.1 widens that at schema 6: a new `attachments` format holds an ordered list of the same
`files/<sha256>/<name>` paths (capped at 200, no duplicate, no text filter), rendered as one grid of
image tiles and file rows and committed once from a table cell (`crates/core/src/model.rs`,
`crates/core/src/value.rs`, `components/attachment-field.tsx`). `attachment_references` now includes
every list entry and every `files/` token in a body (`store::paths_in_body`), so
`referenced_files()`, `missing_files()` and the owner's collection all agree; a body image renders
through the same lightbox and its bytes survive `Collect unused`. `GET …/files` becomes the library
read behind `/s/<space>/library`, listing each stored path once with the live or trashed records that
name it, and space settings show the used and unused totals beside `Collect unused`
(`routes/files.rs`, `pages/library.tsx`, `pages/settings.tsx`). The lightbox is a wrapping carousel
with a counter and arrow keys, and a gallery cover may name an `attachments` property, falling back
to the record cover. `FORMAT_VERSION` is `6` and a schema-5 space upgrades on its first write; no
dependency is added.

M6.2 is the workspace UX patch at the same schema: one searchable property picker
(`lib/property-search.ts`, `components/property-picker.tsx`) behind filter, sort, columns, add,
manage and the palette; Filter, Sort and Columns open in one `ViewPanel` shell as glass popovers
on a fine pointer and one View sheet on a phone, with complete conditions as removable chips;
`components/filter-panel.tsx` adds schedule quick filters and format-aware value editors. A record
adds and manages its own fields (`components/add-property.tsx`, `components/manage-properties.tsx`,
`components/object-panel.tsx`), the schema page splits into Types and Properties tabs
(`pages/schema.tsx`), and a text, select or multi-select column can become a relation to a new type
through `promote::plan`/`targets`/`links` and the `finish` route (`crates/core/src/promote.rs`,
`routes/promote.rs`), previewed and run by `components/schema/promote-column.tsx`. The migration
keeps the source key, moves view columns/sorts and empty filters, drops value filters with a
warning, and leaves every old value in history. `FORMAT_VERSION` stays `6`; no dependency is added.

M8 adds calculated properties at schema 7. `PropertyDef` gains an optional `compute` block —
`kind: formula` with an `expression`, or `kind: rollup` with a `relation`, an optional `property` and
an `aggregate` (`count`, `sum`, `min`, `max`, `list`) — while `format` stays the result type, plus
one computed-only `list` format (`crates/core/src/model.rs`). `crates/core/src/formula.rs` holds a
hand-written lexer, a Pratt parser, a static type checker, a non-panicking evaluator, the reference
scan and the span-preserving rename rewrite (500 characters, 512 tokens, 32 nesting levels);
`crates/core/src/compute.rs` validates a definition alone and against a type, and its `Evaluator`
materializes values per request from one `today` in the space's zone, evaluating only the keys a
list read needs. No calculated value is stored: `validate` refuses a computed key in frontmatter and
a required calculated member, `properties`/`types` refuse a bad definition, `store/fs`'s key rename
rewrites every reference, deletion of a referenced property or target type is a `409`, CSV export
carries the values and import refuses a non-empty cell. The index reports hand-edited definitions in
`computed_problems` without taking the space offline. On the web, `lib/schema.ts` exports the stored
and result formats, `components/schema/computed-fields.tsx` is the one authoring form behind the
schema page and Add property (with an insertable field/function reference), the cell and record
field render read-only with the kind, result and definition, and `list` joins its labels. Schema 7,
workspace `0.8.0`; no dependency is added.

M8.1 is the grid-interaction patch at the same schema 7 and workspace `0.8.1`: `web/src/lib/grid.ts`
owns the data-column, cell and range model (`tabCell`, `normalizeRange`, `rangeCells`) and the two
copy encoders (`toTsv`, `toMarkdown`), `web/src/lib/aggregate.ts` owns one per-format summary rule
and its sentences, and `components/views/table-view.tsx` gains the `anchor` beside `active`, the
Tab/Shift+Tab branch, the range paint, the selection bar, `mod+C` and the `<tfoot>` summary row.
`components/type-table.tsx` passes `scopeKey` and `total`. The footer sums only the rows the list
read returned, states that scope under the table, and never enters a view, a type, the URL or the
server. No route, format, permission or dependency changes.

## Where the plan lives

| File | Role |
|---|---|
| `docs/ROADMAP.md` | **Read first.** Locked architecture decisions, the roadmap M1–M14, the delivery protocol, the deployment plan. |
| `docs/plan/m1-engine-core.md` | The M1 execution spec: repo layout, exact dependencies, on-disk format, core and server design, web design, build order, verification, assumptions. |
| `docs/plan/m2-scheduling-recurrence.md` | The M2 execution spec: schema 2, the schedule engine, implicit properties, Complete, agenda, web scheduling surfaces, verification. |
| `docs/plan/m3-views.md` | The M3 execution spec: schema 3 named views, the four kinds, view CRUD and default, list projection, web view state and renderers, verification. |
| `docs/plan/m4-everyday-usability.md` | The M4 execution spec: CSV, duplicate, palette, capture, home, table truth, lifecycle, accent, responsive and end-to-end verification. |
| `docs/plan/m4.1-follow-ups.md` | The v0.4.1 patch spec: handedness, add property from the table, shared accent, record icons, table controls and option-order sorting. Landed as `0.4.1`, schema 4. |
| `docs/plan/m4.2-mobile-craft.md` | The v0.4.2 patch spec: viewport and sheet geometry, palette focus, literal table widths, the phone table, type page, record page, touch/text floor, docs and the device pass. Landed as `0.4.2`, schema 4. |
| `docs/plan/m4.3-touch-follow-through.md` | The v0.4.3 patch spec: the touch emoji picker sheet and recents, toast clearance, the five-control phone toolbar and View band, capture context, the truthful count and text floor, docs and the device pass. Landed as `0.4.3`, schema 4. |
| `docs/plan/m4.4-usability-sweep.md` | The v0.4.4 patch spec: undo parity, whole-row Schedule targets, phone saved-view wrapping and view order, labels and cards, the phone column panel and CSV import door, calendar-today, record relation chips and first-run/loose ends. Landed as `0.4.4`, schema 4. |
| `docs/plan/m4.5-schedule-views.md` | The v0.4.5 patch spec: one agenda read with rows, a date range and a type filter; the Schedule Calendar across scheduled types; URL-backed and remembered view, horizon, month and types; the type-filter popover/sheet; the shared month grid; snooze for 1–90 days with Undo. Landed as `0.4.5`, schema 4. |
| `docs/plan/m5-search-links-writing.md` | The v0.5.0 spec: the derived search index, the search route and palette, wiki-link parsing and resolution, rendered links, the writing surface, the links panel, the local and space graph, docs and the release pass. Landed as `0.5.0`, schema 4. |
| `docs/plan/m5.1-craft-and-hardening.md` | The v0.5.1 spec: the component test harness and seeded audit, links in both directions, search landing on its match, the heading/paste/preview/create editor actions, and previewed rename link repair. Landed as `0.5.1`, schema 4. |
| `docs/plan/m5.2-visual-refresh.md` | The v0.5.2 spec: the type, colour and state foundation; the space cover sheet; the record specimen sheet; ledger tables and views; the command surface; the phone shell; the quiet surfaces; and the Night Glass material pass. Landed as `0.5.2`, schema 4. |
| `docs/plan/m5.3-stability.md` | The v0.5.3 stability spec: the map's label layout, finger-sized targets, one ledger voice, the schedule's empty state, the tab contract and the shortcut door, offline states, and the release pass. Landed as `0.5.3`, schema 4. |
| `docs/plan/m6-files-and-images.md` | The v0.6.0 spec: canonical attachment bytes under `files/`, schema 5 with `cover` and the `file`/`image` formats, the upload/read/thumbnail routes, record and gallery covers, the lightbox, lifecycle and GC, CSV semantics, and the release pass. Landed as `0.6.0`, schema 5. |
| `docs/plan/m6.1-attachments-ux.md` | The v0.7.0 spec: schema 6 and the `attachments` list format, labels and CSV paths, the lightbox carousel, the attachments field and its read surfaces, body images with their GC rule, the space library and storage settings, and the release pass. Landed as `0.7.0`, schema 6. |
| `docs/plan/m6.2-workspace-ux.md` | The v0.7.1 spec: the searchable property picker, filter/sort/columns overlays and chips, add/manage property from the record, schema tabs, and staged column-to-relation promotion. Landed as `0.7.1`, schema 6. |
| `docs/plan/m8-computed-properties.md` | The v0.8.0 spec: schema 7 and the optional `compute` block, the `list` result format, the formula language, rollups, read-only values on every surface, filter/sort/CSV behavior, lifecycle rules and the release pass. Landed as `0.8.0`, schema 7. |
| `docs/plan/m8.1-grid-interaction.md` | The v0.8.1 spec: the data-column and range model, Tab traversal, rectangular selection, TSV and markdown copy, the row-scoped aggregation footer, and the release pass. Landed as `0.8.1`, schema 7; no format or server change. |
| `docs/plan/m9-property-depth-and-presentation.md` | The v0.9.0 spec at schema 8: the property `display` block (alignment, ISO currency, decimals, grouping) and a table view's `footer`/`footer_hidden` switches, then the property-depth list (validation, defaults, rollup filters, member format, relation filters, formula additions, daily type). Planned; opens after M8.1's release. |

M1, M2, M3 and M4 are implemented: **checkpoints 1–14 of M1 (scaffold; core model and format; store;
index, validation and query; server shell; auth and membership; schema and object APIs; events and
the WebSocket; web scaffold and auth screens; schema editor; live table; object panel and markdown
body; history and trash; docs, CI, containers and the security pass), checkpoints 1–8 of M2 (format
and model; schedule engine; index and validation; server type/property/timezone surface; Complete,
agenda and schedule JSON; web data layer and inputs; Schedule page and timezone surfaces; seed,
docs and end-to-end) and checkpoints 1–8 of M3 (format 3 and the saved-view model; view validation
and health; server type and view routes; list by view; web data layer and view state; table views;
board, gallery and calendar; seed, docs and end-to-end) and checkpoints 1–13 of M4 (CSV codec and
routes; duplicate; palette and shortcuts; UX foundation; quick capture; space home; table truth and
bulk actions; data panel; draft safety; lifecycle; highlight accent; responsive, docs and
end-to-end), and checkpoints 1–8 of M4.1 (handedness; add property; shell and phone polish; table
controls; option-order sorting; record icons and schema 4; shared accent; version, docs and
end-to-end), and checkpoints 1–8 of M4.2 (viewport and sheet primitive; palette and capture focus;
table width model; phone table; type page header; record page; touch and text sweep; version, docs
and the device pass), and checkpoints 1–6 of M4.3 (media hooks and the picker sheet; picker content;
toast placement; phone search and toolbar; capture context; truthful count and text floor) are
landed and CI-green; checkpoint 7 of M4.3 (version, docs and the device pass) has its version and
docs written, and checkpoints 1–9 of M4.4 (undo parity; Schedule targets; phone view wrap; view
order; cards and names; phone columns and import; calendar-today; record relations; first-run and
version/docs) are landed at workspace `0.4.4`, and checkpoints 1–6 of M4.5 (one agenda read; the
shared month grid; the Calendar and page state; the type filter; snooze; version, docs and the
device pass) are landed at workspace `0.4.5`, and checkpoints 1–8 of M5 (the derived search index;
the search route and palette; wiki links in the core and on the record read; rendered links and
navigation; the writing surface; the links panel; the local and space graph; version, docs and the
release pass) are landed at workspace `0.5.0`, and checkpoints 1–6 of M5.1 (the component test
harness and seeded audit; links in both directions; search landing on its match; the editor actions;
previewed rename link repair; version, docs and the release pass) are landed at workspace `0.5.1`,
and checkpoints 1–11 of M5.2 (critique and foundation; space cover sheet; record sheet; ledger
tables; command surface; phone shell; quiet surfaces; save bar; ledger and schedule truth; quiet
density; visual QA, docs and the release) are landed at workspace `0.5.2`, and checkpoints 1–9 of
M5.3 (map labels; finger targets; folded rail; one cell editor; ledger voice; empty schedule; tab
contract; fail-loud reads; visual QA and release) are landed at workspace `0.5.3`, and checkpoints
1–8 of M6 (binary attachments in the store; schema 5; upload and read routes; thumbnails; upload,
file/image properties and the record cover; gallery covers, framing and the lightbox; lifecycle, GC,
CSV and problems; version, docs and release QA) are landed at workspace `0.6.0`, and checkpoints
1–7 of M6.1 (schema 6 and the `attachments` format; the library read and per-format labels; the
lightbox carousel; the attachments field and its read surfaces; body images; the space library,
navigation and storage; version, docs and release QA) are landed at workspace `0.7.0`, and
checkpoints 1–9 of M6.2 (the property picker; filter panel and chips; sort and columns over the
table; add and manage properties from a record; schema tabs and palette lookup; promotion plan and
targets; links and finish; the wizard; this release pass) are landed at workspace `0.7.1`, and
checkpoints 1–8 of M8 (schema 7, `compute` and the `list` format; the formula language; the compute
engine; server definitions, reads and write refusal; rename, delete and CSV; computed values on
every read surface; formula and rollup authoring; this release pass) are landed at workspace
`0.8.0`, and checkpoints 1–5 of M8.1 (the grid model and Tab traversal; rectangular selection;
TSV and markdown copy; the aggregation footer; version, docs and release QA) are landed at
workspace `0.8.1`.** M1 is
deployed; M2–M8.1 are not deployed. The
physical-iPhone gate is still open — it is checkpoint 7's device pass in
[`docs/plan/m4.3-touch-follow-through.md`](docs/plan/m4.3-touch-follow-through.md) §8, and it also
carries the v0.4.2 keyboard gate and the v0.4.4 device pass.
Work proceeds one numbered checkpoint at a time — finish it, report what was built, verified and how
to test it by hand (see [Delivery, Git and Manual QA](#delivery-git-and-manual-qa)), then stop for
review. If the plan is silent on something that matters, ask rather than picking silently.
Later milestones get their own `docs/plan/mN-*.md`.

The post-M1 roadmap was revised on 2026-10-21: **M2** landed scheduling and recurrence with in-app
reminders only; **M3** landed named views; **M4** landed everyday usability plus generic CSV
import/export. Email digests and source-specific `plant-tracker`/`chore` importers are deliberately
out of scope.

## Architecture & Data Flow

```
.md files (YAML frontmatter + body)   SQLite (accounts/sessions/invites only)
        |                                      |
        v                                      v
  store (only FS toucher)  -------->  thing-server (axum HTTP + WS)
        |                                      |
        v                                      v
  in-memory index / query engine      React 19 SPA (web/)
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
  overwrite stale state. Writes are atomic, attachments included: bytes stage under `files/.tmp/`
  and rename into place.
- **Core modules:** `model`, `markdown`, `schedule`, `csv`, `store`, `validate`, `filter`, `query`,
  `index`, `search` and `links` exist. The server shell, auth, the schema, view, search and object
  APIs (including Complete, the agenda and `with=links`), and the event bus exist; the SPA covers
  auth, the space list, the schema editor, the four view renderers, the object panel with its
  writing surface, links panel and graph, the Schedule page, the attachments field, the space
  library, history and trash.

## Key Directories

| Path | Purpose |
|---|---|
| `crates/core/` | `thing-core`: domain, format, validation, query, store |
| `crates/core/src/` | Source: `lib.rs` plus one module per `docs/plan/m1-engine-core.md` §4 entry |
| `crates/core/tests/` | `roundtrip.rs` walking `fixtures/`; store tests are inline in `store/fs.rs` over `tempfile::TempDir` |
| `crates/server/` | `thing-server` binary, axum shell |
| `scripts/` | `seed.sh`: the curl walkthrough that builds the Garden demo space |
| `Dockerfile` | Three stages: `node:24` builds `web/dist`, `rust:1.98.1` builds the release binary over a dependency-cache layer, `debian:13-slim` runs both as the non-root `thing` user with `/data` as the volume |
| `dev.dockerfile` | The dev image: Rust, Node and `cargo-watch` in one container, with `USER dev` |
| `docker-compose.yml` | The production service: builds the image, binds `THING_LISTEN_IP` (loopback by default), mounts `./data`, read-only rootfs, dropped capabilities, `no-new-privileges` |
| `docker-compose.dev.yml` | The dev service: source bind mount, `:8080` and `:5173`, `cargo-watch` plus Vite |
| `.devcontainer/devcontainer.json` | Reuses the dev compose service so VS Code opens the workspace with live server restarts and HMR |
| `scripts/semgrep.sh` | The pinned Semgrep gate CI runs over Rust, Docker, compose, secrets and OWASP |
| `.github/workflows/ci.yml` | Rust and web gates on every push and pull request; a `v*` tag also pushes `ghcr.io/talonlikeaclaw/thing:<tag>` and `:latest` |
| `web/` | Vite + React 19 SPA: `api/` (client, types, query hooks), `components/`, `pages/`, `styles/globals.css` tokens, `test/` |
| `data/` | Runtime space store; gitignored, never commit fixtures here |

## Development Commands

```sh
cargo build --workspace          # both crates
cargo test --workspace           # all Rust tests
cargo test -p thing-core         # core crate only
cargo run -p thing-server        # serves ./data on 127.0.0.1:8080
cargo run -p thing-server -- set-password --email you@example.com   # reads the password from stdin
cargo run -p thing-server -- reindex --space <space-uuid>   # prints a space's file problems
THING_SEED_PASSWORD=... scripts/seed.sh   # signs in as THING_SEED_EMAIL (a@b.c) and seeds Garden

docker compose up --build        # image + SPA on 127.0.0.1:8080, data in ./data
docker compose down

cd web
npm ci
npm run dev                      # SPA on 127.0.0.1:5173, /api proxied to 127.0.0.1:8080
npm run test:run                 # Vitest
npm run lint && npm run typecheck && npm run build
```

Build and test verified in this environment.

### The local dev account — fixed, do not rotate

| | |
|---|---|
| Email | `a@b.c` |
| Password | `devpass123` |
| Space | the seeded **Garden** space in `./data` |

Sign in with that password, or `scripts/seed.sh` with
`THING_SEED_EMAIL=a@b.c THING_SEED_PASSWORD=devpass123`.

**Never change this password, never reseed to "fix" an auth problem, and never write rows into
`data/accounts.sqlite`** — no synthetic sessions, no manual `set-password`, no deleted `data/`.
If a browser session is lost, sign in again with the password above; if the login genuinely fails,
say so and stop rather than resetting the store. Reseeding destroys the owner's spaces and is a
manual QA reset the user performs, not the agent.


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
  `jiff` is core-only and owns IANA timezone lookup and civil-date arithmetic behind `schedule.rs`;
  `time` remains the timestamp type everywhere else.

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
- **Scheduling is a type flag, not a second object kind.** `schedule: true` exposes `due_date`
  (date), `recurrence` (recurrence) and `last_completed_at` (datetime) as generated properties.
  Those keys are reserved in every space, are never written to `properties/`, and a type never
  lists them in its own `properties`. Disabling scheduling is refused while any live or trashed
  object of the type still holds one of the keys.
- **Due is a calendar day in the space timezone.** `schedule::state` compares civil dates resolved
  through jiff, never elapsed hours; a missing or invalid space timezone behaves as UTC and is
  reported in `problems()`, never used to block reads or writes. A late completion re-phases from
  the completion day; an early completion keeps the planned due date; a completion with no
  recurrence clears `due_date` and keeps `last_completed_at`.
- **Complete is a write action, not a form save.** It appends a `complete` revision with the full
  new property map, requires the current `rev` (`409` otherwise), broadcasts `object.completed`,
  and never accepts a title or body. The web's undo is an ordinary PATCH of the two schedule values
  at the returned revision, not a history rewrite.
- **Snooze postpones the plan; it does not hide it.** `schedule::snooze` writes only `due_date`,
  as `max(due, today) + days` in the space zone for 1–90 days, sharing `complete`'s base-day rule;
  `recurrence` and `last_completed_at` are untouched, so a later completion counts from the moved
  date. The route records an `update` revision (never `complete`), requires the current `rev`, and
  refuses a record with no due date. The web's undo PATCHes the previous due date at the returned
  revision. There is no stored hidden-until field and no mute.
- **A PATCH merges, and `null` removes.** `properties: {"room": "study"}` sets one value without
  touching the others; `properties: {"room": null}` drops the key. Every `PATCH` carries the `rev`
  the caller read, and a different one is a `409` with `details.current_rev`.
- **A view is the type's saved query, not an object kind.** A type file carries an ordered `views`
  list (1–50) and one `default_view`. View keys are minted from the name at creation, match the key
  grammar, and never change; display names are unique case-insensitively; the kind is chosen once
  and immutable. Only the field of the current kind exists: a table has no `group_by`, a calendar
  has empty `columns` and a `date_property`.
- **The default view is first.** `default_view` names `views[0]`, so the view that opens the type
  is also its first tab. `POST …/views/{view}/default` moves that view to the front, and a move may
  never put another view in slot 0 or move the default away from it (`409`). A file that writes the
  default elsewhere is normalized to first on read; the next write persists that order.
- **View problems are split by what can be known.** Key/name/default structure is enforced in
  `parse_type`, so a broken type file is unparseable like any other. Cross-file meaning (columns are
  members, `group_by` is a `select`, `date_property` is a `date`, widths are `80..=800`, filters and
  sorts validate) is checked by `validate::validate_views` on every write and reported through
  `/health`'s `view_problems`; the type still loads.
- **A property rename walks every view; a removal checks structurally.** `group_by` and
  `date_property` dependencies refuse a member/property removal (`422`/`409` naming the view), a
  gallery `cover` is cleared, and every other view reference is stripped in the same write.
- **An attachment is its path.** Bytes live at `files/<sha256>/<name>`, the frontmatter value is
  that POSIX path, and the same bytes under the same name are the same path. A path that no longer
  resolves is kept and reported by the space health read, never rewritten or invented; `file` and
  `image` values are plain text paths, and an `image` extension is one of `png`, `jpg`, `webp` or
  `gif` because those are the only bytes the decoder and the reader accept.
- **A set is a list of the same paths, and a body mention is a reference.** An `attachments` value
  is an ordered `Value::List` of `files/…` paths, capped at `MAX_ATTACHMENTS` (200), with no path
  twice and no text filter beyond `is_empty`/`is_not_empty`; upload order is the order, and an empty
  set is an absent key. Any `files/…` token in a body counts as a reference for garbage collection
  and for the missing-file report (`field: "body"`), because GC must never delete bytes a body
  renders. The library lists unique stored paths with the live or trashed records that use them,
  and a path only the trash names is neither unused nor collected.
- **A cover is a reserved key, not a property.** `cover` names one attachment path and
  `cover_position` stores the 16:9 crop's centre as two percentages; `null` clears either, an
  absent key keeps it, and clearing a cover clears its framing. A record's hero and a gallery tile
  that falls back to the record cover share one `object-position`, so the framing a member chooses
  is the framing everyone sees.
- **Layout writes immediately, queries save explicitly.** Column visibility, order and table widths
  PATCH the view as the control commits; filter and sort edits live in the URL until **Save view**.
  Switching views clears those overrides.
- **Search and links are derived, never stored.** The search index and the folded `(type, title)`
  map live only in `SpaceIndex` and rebuild from the markdown; no object file gains a key for a
  search hit or a `[[Type/Title]]` link. A wiki link is body text, not a relation value. Exactly one
  live record of that type and title resolves; zero or many report `unknown`/`ambiguous`, and a
  trashed target never resolves.
- **Calculated values are derived, never stored.** A property's `compute` block defines a value the
  app materializes per request: it appears in no object frontmatter, history snapshot, search index
  or file name, and `validate` refuses a stored value on a computed key. `format` stays the result
  type, so a calculated column sorts, filters, renders and exports exactly like a stored one.
- **One spelling per concept.** No aliases, shims or parallel grammars.
- **Unknown keys are refused.** `deny_unknown_fields` on every document struct: a key this crate
  does not know is an error naming it, never a silent drop. `schema` is stripped and checked before
  deserializing; versions below `MIN_FORMAT_VERSION` or above `FORMAT_VERSION` are refused. The
  writer always emits `FORMAT_VERSION`, so a read-modify-write upgrades an older file in place.
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
- **Every feature, change and fix updates the changelog.** In the same commit as the code, add a new
  `Unreleased` entry in `web/src/content/changelog.ts` (or extend it while it is open): a headline
  in `highlights` for user-visible behavior, a `details` line for the long tail, plain language a
  user understands. Never ship behavior the release notes do not name.
- **Release-note style.** Follow the entries already in `web/src/content/changelog.ts`: order
  `highlights` by user impact, most important first. Each bullet is one sentence and one change:
  never join two unrelated outcomes with "and" or a comma — split them, even if that adds bullets.
  Avoid implementation nouns such as schema keys, endpoints, component names and file paths. Put
  the long tail in `details`, in the same feature order, one change per line. A note says what a
  person can now do, not how it was built.

## Important Files

| File | Role |
|---|---|
| `Cargo.toml` | Workspace root: members, package metadata, all dependency pins |
| `rust-toolchain.toml` | Pins Rust 1.98.1; requests rustfmt/clippy |
| `Cargo.lock` | Committed exact resolutions |
| `crates/core/src/lib.rs` | Core crate root: module list, 2 consts, 1 unit test |
| `crates/core/src/model.rs` | Domain model: every type the crate is typed against, including `ViewDef`/`ViewKind`, `TypeDef.views`/`default_view`, plus the `ObjectSummary` projection, `TITLE_KEY`, `UPDATED_AT_KEY` and `RESERVED_KEYS` |
| `crates/core/src/validate.rs` | `Schema` (borrowed from the index), `validate_object`, `validate_filter`, `validate_sorts`, `validate_views`, `dependent_views`, `missing_relations` |
| `crates/core/src/filter.rs` | `matches` / `row_matches`: one condition against one row, over every `CondOp` |
| `crates/core/src/query.rs` | `apply(filter, sorts, …)`: the view's filter, then its total sort order |
| `crates/core/src/index.rs` | `SpaceIndex`: a whole space in memory, `rebuild_from_disk`, `reload_file`, `problems` (including `view_problems`), `detail`, and `attachment_references`/`referenced_files`/`missing_files` over covers, property values and body mentions |
| `crates/core/src/error.rs` | `CoreError`; the server maps it to HTTP status codes in one place |
| `crates/core/src/slug.rs` | `slugify` / `unique_slug` for filenames under `objects/<type>/`, and the key grammar: `is_valid_key`, `key_from_name`, `MAX_KEY_LEN` |
| `crates/core/src/value.rs` | Per-format YAML/JSON conversion with the property key in the error, plus ordering for sorting |
| `crates/core/src/markdown.rs` | The on-disk format (schema 7): object frontmatter, space/type/property YAML including `compute`, legacy type-view normalization, history lines |
| `crates/core/src/schedule.rs` | The calendar-day schedule engine: timezone resolution, `today_in`, recurrence validation/advance, `state`, `complete`, `snooze` (with the shared `rephase_base`), `MAX_SNOOZE_DAYS`, recurrence labels |
| `crates/core/src/search.rs` | The derived inverted index: `tokens` (lowercased alphanumeric runs, 64-char cap), `SearchIndex::upsert`/`remove`/`rebuild`/`query` with the pinned score and total order, and `snippet` for the matching body window |
| `crates/core/src/links.rs` | The `[[Type/Title]]` grammar: `parse` (fences, inline code and escapes excluded, first slash, 200-char cap), `LinkStatus`/`LinkView`, relation and mention backlink shapes, and `excerpt` |
| `crates/core/src/store/mod.rs` | The `SpaceStore` trait, `FileFingerprint`, `SpaceFile`, the layout consts plus `classify`, the path helpers (`type_path`, `property_path`, `trash_path`, `history_path`, `file_path`, `thumb_path`, `is_file_path`, `split_thumb_path`, `paths_in_body`) and the property rename/removal rewrites |
| `crates/core/src/store/fs.rs` | `FsSpaceStore`: the only filesystem code, atomic writes, the write guard, `rename_property_key`/`remove_property_key` and their per-object revisions |
| `crates/core/tests/fixtures/` | Hand-written files in canonical emitted form; `invalid/` holds refused ones |
| `crates/server/src/` | `thing-server`: `main` (clap, tracing, boot), `config`, `state`, `error`, `accounts`, `auth`, `spaces`, `events`, `watcher`, `routes/{mod,auth,spaces,search,types,views,properties,objects,files,csv,values}` |
| `crates/server/src/events.rs` | The per-space broadcast channel, `SpaceEvent`, and the `/events` WebSocket: origin check, `hello`, then every event; data frames close it, a lagged listener is disconnected, and a removed member or deleted space closes its sockets. API broadcast plus the watcher's echo duplicate an invalidation; that is harmless by design |
| `crates/server/src/watcher.rs` | Debounced reload of changed paths. Forwards only Create/Modify/Remove (Access events would feed a read loop), sorts the batch so `objects/` precedes `trash/`, and announces created/updated/deleted/restored/purged plus membership diffs from `space.yml` |
| `crates/server/src/routes/types.rs` | Type CRUD and detail, schedule enable/disable, and the property-removal and dependency guards that keep saved views valid |
| `crates/server/src/routes/views.rs` | Named-view create, patch, delete and default; mints keys once, protects the last view, promotes the default |
| `crates/server/src/routes/search.rs` | `GET /api/spaces/{space}/search`: validates `q` (1–200), `limit` (1–50) and an optional type key, reads `SpaceIndex::search`, then resolves type/record metadata and the body snippet; `total` is pre-limit |
| `crates/server/src/routes/files.rs` | The attachment surface: raw upload with a sniffed type and content hash, the member-only read with `Cache-Control`/ETag and an optional `?w=256|512` thumbnail, the library read that lists every stored path with the records that use it, and the owner's garbage collection of bytes no live or trashed object, property value or body names |
| `crates/server/src/routes/objects.rs` | The single object write path (mutex → validate → guarded write → revision → reload → broadcast), the list endpoint resolving `?view=` and projecting its fields, the detail read's `?with=history,backlinks,links`, Complete, the agenda and the trash, restore and history routes |
| `crates/server/src/routes/values.rs` | The `{value, label}` rendering: option names, relation titles, missing targets, row and object JSON |
| `web/src/api/client.ts` | The one request path: same-origin cookies, JSON, error envelope → `ApiError` |
| `web/src/api/types.ts` | TypeScript mirrors of the Rust DTOs the SPA speaks to |
| `web/src/api/queries.ts` | Every TanStack Query hook and mutation; auth success seeds `me` and `spaces`; schema writes invalidate the space prefix |
| `web/src/lib/schema.ts` | Pure schema-edit helpers: membership and column order, option drafts, order-insensitive change detection |
| `web/src/lib/views.ts` | Pure view state: selection and URL fallback, effective query and dirty check, widths and column moves, board lanes, calendar dates and month grid |
| `web/src/lib/table-widths.ts` | Literal width model: `savedWidths` (compact 136/104), `widthPlan` with the filler column, `dragWidth`, `DRAG_THRESHOLD`; no proportional scaling |
| `web/src/lib/viewport.ts` | `metricsFor` over `visualViewport`, the rAF-collapsed `subscribeVisualViewport`, and `applyViewportMetrics` writing `--vv-height` / `--vv-top` / `--kb-height` |
| `web/src/components/ui/sheet.tsx` | `SheetViewport` / `SheetPopup` (the one overlay geometry, motion and safe-area footer) plus `useSheetViewport`, mounted once in `App.tsx` |
| `web/src/lib/schedule.ts` | Recurrence labels/drafts, schedule property names, due tone and relative due phrases, and the snooze presets/label/bounds; no date math |
| `web/src/lib/timezone.ts` | The `Intl` timezone list, always including UTC and the space's current zone |
| `web/src/components/schema/` | Type and property lists, editors, and the shared option editor; columns and grouping are per view on the type page |
| `web/src/components/views/` | The view tab row, inline new-view form, view settings, column panel, and the four renderers (`table`, `board`, `gallery`, `calendar`) over one `useObjects` result |
| `web/src/components/recurrence-input.tsx` | The Apply/Cancel editor for `recurrence` values, shared by table cells, panel fields and filters |
| `web/src/pages/agenda.tsx` | The Schedule page: List/Calendar switch, horizon, month and type filter in the URL with storage as fallback, one loading/error path for both views, and one completion/snooze handler with their toasts and Undo |
| `web/src/lib/search.ts` | The in-memory action/type/space scorer and `matchRanges` for palette highlights; record results come from the server and keep its order |
| `web/src/lib/markdown-edit.ts` | Every writing-surface transform as a pure `{value, selection}` edit: wrapping, line prefixes, list continuation, indent, links, fences, slash and wiki triggers, slash application and `insertImages` |
| `web/src/lib/files.ts` | The path grammar helpers and upload guards every attachment surface shares: `MAX_UPLOAD_BYTES`, `ACCEPTED_IMAGES`, `isAcceptedImageType`, `isImagePath` and `imagePaths` |
| `web/src/lib/graph.ts` | `buildLocalGraph` (deduped nodes, capped at 24, relation/mention edges) and `layoutLocalGraph` / `layoutSpaceGraph`, deterministic ring placement with clipped edges |
| `web/src/components/markdown-editor.tsx` | The textarea writing surface: toolbar with the H1–H3 menu, shortcuts, paste-link, preview-tap-to-write, Write/Preview split, and the one caret popup for `/` commands, `[[` completion and the create row |
| `web/src/components/links-panel.tsx` | The record's Links section: the mono count across both directions, `Links to` relation and mention rows, `Linked from` relation rows, `Mentioned in` rows, and the empty sentence |
| `web/src/components/rename-links-dialog.tsx` | The pre-rename preview: reads each mentioning source before the title changes, lists it with its type and count, and offers Update links, Rename only or Cancel |
| `web/src/components/graph-section.tsx` | The Graph disclosure, Local/Space scope and the shared SVG canvas with legend, zoom, pan and node offsets |
| `web/src/components/file-field.tsx` | One file/image control for the record panel: choose or drop, upload with its busy and refusal states, preview, replace, remove and Retry |
| `web/src/components/image-lightbox.tsx` | The one image overlay, built on the sheet primitives: full-size picture, caption, a wrapping previous/next carousel with a position counter and arrow keys, Escape and focus returned to the opener |
| `web/src/components/attachment-field.tsx` | The one file-set editor, shared by the record and the table cell: append-on-upload order, an image grid and file rows, paste and drop, remove with confirmation, `Set as cover`, the set's lightbox, its refusal/Retry state and the deferred commit a cell makes with `Done` |
| `web/src/pages/library.tsx` | The space library: every stored path with the live or trashed records that use it, kind/type/name filters, three sorts, the unused marker, the images' lightbox and the empty states |
| `web/src/components/views/gallery-view.tsx` | A gallery tile's image cover (`?w=512`) with the record cover as fallback, the shared `object-position`, and the tile actions |
| `web/src/test/harness.tsx` | The component-test layer: a fresh QueryClient, MemoryRouter, ToastProvider, fetch stub and JSON response helper |
| `web/src/pages/schema.tsx` | The schema page: list/editor pairs selected by `?type=` and `?property=` |
| `web/src/styles/globals.css` | The design tokens (`@theme`), dark-first with a light-mode override, the glass materials, the `.sheet-*` keyboard geometry, overscroll containment and the coarse-pointer 44 px / 16 px floor |
| `web/src/pages/spaces.tsx` | The keyed space index and the create-space form |
| `DESIGN.md` | **Normative** visual system: Night Glass — a top-lit ground, frosted chrome, matte data cards and a floating dock; tokens are the frontmatter |
| `.impeccable/design.json` | Design sidecar: tonal ramps, motion, breakpoints, component snippets, narrative |
| `README.md` | Product summary, layout, dev commands |
| `PRODUCT.md` | **Normative** product truth: stack, constraints, principles |
| `.gitignore` | Ignores `/target`, `web/dist`, `data/`, `.env` |

**Stale artifacts:** `target/doc/` and old fingerprints in `target/debug/` come from a discarded
earlier attempt. Some module names coincide with today's (`error`, `markdown`, `model`, `slug`,
`value`) but the contents differ. Gitignored build residue; not a reference. Tracked source is the
only truth.

`DESIGN.md` and `.impeccable/design.json` describe the visual system that `web/` actually implements.
When the UI changes, update them; never let them describe a different world.

## Runtime/Tooling Preferences

- **Runtime:** Rust for the server and core; the SPA is Vite + React 19 + Tailwind v4 + Base UI,
  with TanStack Query for server state and React Router for routes.
- **Package manager:** Cargo workspace for Rust; npm in `web/` (`package-lock.json` committed).
- **Compiler:** Nix-provided Rust 1.98.1, x86_64-unknown-linux-gnu. No rustup.
- **CI, container and security.** `.github/workflows/ci.yml` runs the Rust gate, the web gate and
  `scripts/semgrep.sh`; on a `v*` tag it builds and pushes
  `ghcr.io/talonlikeaclaw/thing:<tag>` and `:latest`. Actions are pinned by commit SHA and
  checkouts do not persist the job token. The `Dockerfile` has three stages (`node:24` →
  `rust:1.98.1` → `debian:13-slim`), pins every base image by digest and runs non-root with a
  read-only rootfs. `docker-compose.yml` is the production service; `docker-compose.dev.yml` and
  `.devcontainer/` run both dev servers against the source. `scripts/seed.sh` requires
  `THING_SEED_PASSWORD`, signs in as `THING_SEED_EMAIL` (default `a@b.c`) or registers it, and
  builds the Garden demo space against a running server.
- **Deploy.** Production runs the release image behind a private tunnel with a persistent data
  volume, `THING_COOKIE_SECURE=true`, `THING_PUBLIC_URL` set to the deployment's own origin, and
  `THING_BIND`/`THING_LISTEN_IP` set by the deployment (the compose port binds loopback by default);
  host-specific deployment steps live outside this repository. `tar` of the data directory is a
  complete backup: the space content is the markdown, its history and the attachment bytes under
  `files/`. `files/.thumbs/` holds derived thumbnails and may be excluded; they rebuild on the first
  view of each image.
- Keep `tokio`, `axum`, `rusqlite` and `notify` out of `thing-core`; they belong in the shell or
  the store boundary.

## Delivery, Git and Manual QA

**These are hard requirements. A checkpoint that ignores them is rejected regardless of how good the
code is; "it works" does not excuse a skipped gate, a secret change, or a commit.**

- **The user commits; the agent never does.** Do not run `git add`, `git commit`, `git commit
  --amend`, `git tag`, `git push`, `git stash`, `git reset`, `git checkout -- .` or any other
  command that stages, commits or rewrites history. Leave the checkpoint's changes uncommitted in
  the working tree and end the report with one **Proposed commit** line; the user reviews, stages
  and commits. Read-only git (`git status`, `git diff`, `git log`) is fine.
- **Every checkpoint ends with a manual test guide.** The report carries a **Test it** section: a
  numbered walkthrough the user can follow without reading the diff. Each step names the exact
  route or URL, the viewport or device mode, the tap/keystroke, and the observable result that
  proves the behavior. Cover the checkpoint's new paths plus one regression path it could have
  broken. Say plainly which check this machine cannot perform (a physical device, a real
  keyboard) and what evidence stands in for it; never describe emulation as a device pass.
  Keep the automated gate out of the guide — that was already reported under **Verified**.

## Testing & QA

- **Framework:** built-in `cargo test` for Rust; Vitest + Testing Library + jsdom in `web/` for the
  client. No nextest or coverage tool configured.
- **Unit tests:** inline `#[cfg(test)] mod tests`, as in `crates/core/src/lib.rs`.
- **Integration tests:** `crates/core/tests/*.rs`. Use `tempfile` for filesystem/store fixtures;
  never write repo-root `data/`.
- **HTTP tests:** `thing-server` is a binary crate, so its tests are inline and drive the real
  router over a `tempfile::TempDir` with `tower::ServiceExt::oneshot` and
  `http_body_util::BodyExt::collect` (see `routes::tests`); that is how the auth and role rules are
  pinned.
- **Web tests:** `web/src/**/*.test.ts(x)`, run with `npm run test:run`; drive the real API client
  or a component, never a copy of it.
- **Current coverage:** 1158 tests (306 `thing-core`, 19 `tests/roundtrip.rs`, 129 `thing-server`, 704
  `web`) — one `#[cfg(test)]` module per Rust source file. New behavior needs a test exercising the
  changed path.
- **Fixtures:** `crates/core/tests/fixtures/` holds one hand-written file per format concern;
  `roundtrip.rs` asserts `serialize ∘ parse` reproduces each byte for byte. Add a fixture when the
  format changes, and check it still reads like `docs/plan/m1-engine-core.md` §3.
- **QA:** run `cargo test --workspace` and smoke-run the changed binary; in `web/` run
  `npm run test:run && npm run lint && npm run typecheck && npm run build`. Verify UI changes in a
  real browser, not by tests alone.
- **Regression tests:** keep when they pin behavior, not wording or incidental details.
