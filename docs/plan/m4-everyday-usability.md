# Milestone 4 — everyday usability

Everything below is the M4 execution spec. Implement top-to-bottom, one checkpoint per turn, under
the delivery protocol in [`docs/ROADMAP.md`](../ROADMAP.md). Read `docs/ROADMAP.md` first, then this
file; M1 is deployed as `v0.1.0`, M2 and M3 are landed as workspace `0.2.0` and `0.3.0`. Nothing here
re-opens a locked decision.

## 1. Scope

M4 makes the existing engine fast to use every day and gives a spreadsheet-shaped way in and out of
it. It adds no new file kind and no new schema field.

In scope:

- **Quick capture** from any signed-in surface: type picker, title, the type's required properties,
  Create and Create-and-open.
- **Command palette** on `Cmd/Ctrl+K` over actions, spaces, types and record titles, with full
  keyboard operation and a `?` shortcut sheet.
- **Keyboard navigation and shortcuts** for the palette, quick capture and the table (`j`/`k`,
  `x`, `Enter`, `/`, `Escape`).
- **Duplicate** a record, on the server, with a new identity and a Create revision.
- **Move to trash with an undo window** from the table, the record panel and bulk actions.
- **Multi-select and bulk edits** in the table: set or clear one property, duplicate, move to trash,
  with per-record results and a visible failure count.
- **Table paging**, because the list endpoint caps at 50 rows and the table currently cannot reach
  the rest of a large type. Selection is page-local.
- **Recent items** on a real space home, kept in the browser, plus **onboarding empty states** at
  every dead end.
- **Reorderable space rail**: the Schedule, Schema, Members, Settings and Trash links can be moved
  up or down, per user and per space, with a browser-local saved order.
- **A visible shortcut affordance and in-app changelog**: a footer build version, release notes at
  `/changelog`, and a header control that opens the shortcut sheet.
- **Generic CSV export and import for any type**: export every live record of a type, and import
  new records into an existing type with a preview, row/column errors and no partial validation.
- **Responsive and touch polish** across the new surfaces and the existing table and rail.
- **A UX foundation the new features can stand on**: one space layout route with a rail that marks
  the current page, draft-safe navigation, local and retryable write errors, truthful list state,
  route titles/focus/announcements, a skip link, scroll restoration, a connection indicator, a
  toast policy that never eats an Undo, and a contrast/touch floor for shared controls.
- **Lifecycle and sharing surfaces the server already supports**: an owner can create, copy and
  revoke invites, change a role and remove a member; an editor can delete a type or property with
  an explicit disposition; Trash gains bulk restore and bulk purge. No new server route is needed.
- **A per-space highlight accent**: six highlighter-family accents (lichen, yellow, orange, cyan,
  green, pink), chosen per user and space in Settings, applied to focus, selection, primary actions
  and active navigation. Contract in §4.8; it is browser-local, not a shared space colour.

Out of scope, deliberately:

- Server-side recent items, cross-device activity, or a new table in the accounts database. Recent
  items are browser-local; the space is the shared object.
- Full-text search, an inverted index, backlinks, wiki links and the graph view (M5). The palette's
  record lookup is title-substring over a bounded, client-side set; M5 replaces it with the index
  and body matches.
- Upsert, merge, or schema inference in CSV import. Import always creates new records in an existing
  type; there is no id/rev column and no way to overwrite a record with a file.
- Source-specific `plant-tracker`/`chore` importers, attachments, formulas, history restore, and
  drag-and-drop between board lanes or onto calendar days.
- A batch API. Bulk actions fan out over the existing per-object write path; each record keeps its
  own revision.
- A server-stored, shared or cross-device accent. The accent is browser-local per user and space
  (§4.8). Putting it in `space.yml` would change a file a v0.3 binary must still read, and a colour
  preference does not belong to the space's content.
- Account self-service beyond the login hint: changing email/password and listing sessions needs new
  auth routes, so the UI points at the operator's `set-password` command instead.
- Accepting an invite while already signed in. Redemption stays part of registration; `/join/:code`
  offers to sign out while keeping the code in the URL. A signed-in accept endpoint is later work.
- An offline mutation queue, background sync, or server-side draft autosave. M4 guards navigation;
  it does not make a disconnected write succeed.

Success is: a new user lands on a space home that explains types and offers a first action; a
returning user presses `Cmd+K`, types three letters, opens a record, presses `c`, captures a chore
with its required room, and is looking at the new record; the owner selects five plants, sets
`room`, duplicates two, trashes one and undoes it from the toast; a keyboard-only user does the same
without touching a pointer; a failed save leaves the typed value on screen with Retry; switching
pages never discards an unsaved draft; and the owner exports Plant as CSV, imports it into a second
empty Plant type, and gets the same titles, values, bodies and schedule keys back, with a
deliberately broken row refused by row and column before anything is written. The owner can also
invite a collaborator, delete an obsolete property, and set a yellow highlight for one space without
changing it for anyone else.

## 2. Starting state

What M4 builds on, so a new session does not re-derive it:

- `thing-core`: `model` (`ObjectDoc`, `ObjectSummary`, `TypeDef`, `PropertyDef`, `PropertyFormat`,
  `Value`, `Recurrence`), `markdown` over `FORMAT_VERSION = 3`, `store` (`SpaceStore`,
  `FsSpaceStore`, `new_object_path`, `save_object`, `move_to_trash`, `restore`, `purge`,
  `append_revision`), `validate` (`validate_object`, `validate_views`, `Schema`), `value`
  (`parse_value`, `to_json`, `from_json`, `is_empty`), `schedule` (`SCHEDULE_KEYS`, `state`,
  `complete`), `filter`, `query`, `index` (`SpaceIndex`, `summaries`, `objects`, `object`).
- `thing-server`: one per-space `tokio::sync::Mutex` (`SpaceHandle.write`), one object write path
  (`objects.rs::commit`), one guarded store write with atomic rename, per-file index reload, and
  per-space events. `routes/objects.rs` owns create, patch, trash, restore, complete and list.
- `web/`: `AppShell` with header and footer only; `SpaceNav` repeated by each space page;
  TanStack Query with the `["space", id]` prefix; `useUpdateObject` optimistic cell writes;
  `useCreateObject`; `useTrashObject`/`useRestoreObject`; the toast provider with one optional
  action; `TypeTable` and `TableView`; `PropertyInput`; `useSpaceEvents` invalidating the whole
  space prefix on every event.
- Existing empty states: spaces list, no-types space, schema, type table, board lane, agenda, trash.
  There is no palette, quick capture, recent store, selection, bulk action, paging control, CSV code
  or download/upload path anywhere.
- There is no per-space layout route. `SpaceNav` is rendered by only `agenda`, `type-table`,
  `object` and `trash`; Schema, Members and Settings have no rail or space switcher, every utility
  link except Schedule hardcodes `current: false`, and `/s/:id` redirects to the first type rather
  than acting as a home.
- `recordRecent` is written and tested but has no caller; the palette's Recent section therefore
  never appears. `useBulkRestoreObjects` is likewise unused. The toast provider keeps only three
  toasts, evicts the oldest, and resets one shared six-second timer whenever another toast arrives.
- The object panel, schema editor and space settings guard no in-app navigation; only the object
  panel registers `beforeunload`. A failed cell save closes its editor and reverts the row, losing
  the typed value. A new record is created as `Untitled` before the user names it.
- Members is read-only although `create_invite`, `list_invites`, `revoke_invite`, `set_member` and
  `remove_member` exist; type and property deletion exist on the server but have no UI; Trash is
  one row at a time.
- Resting field borders are 1.42:1 against the dark ground and 1.30:1 in light; `faint` text at
  10–11px is below 4.5:1; several raw buttons (emoji cells, Purge) are below 44px on coarse
  pointers. `formatDate` hardcodes UTC while the rest of the app is local.
- There is no accent preference; `--color-accent` is the only accent in the stylesheet.

## 3. Dependency and format version

**No format bump.** `FORMAT_VERSION` stays **3**; `MIN_FORMAT_VERSION` stays 1. There is no new
frontmatter key, no new file, no SQLite table and no change to `space.yml`, type files, property
files, history lines or object files. A v0.3 binary reads every M4 file unchanged. CSV output is an
interchange surface, not a second canonical store; markdown remains canonical.

New Rust dependency, added once to `[workspace.dependencies]` and used only by `thing-core`:

```toml
csv = "1"
```

No new npm dependency. The palette, capture sheet, selection bar and shortcut layer are React; the
Base UI dialog/checkbox primitives already installed cover focus trapping and native checkbox
semantics. CSV parsing and writing happen on the server; the client reads a `File`, posts bytes and
saves a `Blob`.

`space.yml` is untouched. The accent (§4.8) cannot live there: `SpaceMeta` is
`#[serde(deny_unknown_fields)]`, so a new key would make a v0.3 binary refuse the whole space.
The accent is browser-local, like recent items and rail order.

The workspace and `web/package.json` become `0.4.0` in the final checkpoint.

## 4. Contracts

### 4.1 CSV grammar

One CSV per type. The header row names **property keys**, never display names, for the same reason
frontmatter does: keys are stable and unique, names are editable and may collide across types.
`title` and `_body` are the two reserved headers. `_body` rather than `body` because a property key
may legitimately be `body`, while the key grammar requires a leading lowercase letter, so `_body`
cannot collide with any property. Header order on export is fixed:

```
title, <declared members in type order>, [due_date, recurrence, last_completed_at], _body
```

The three schedule keys appear only when the type has `schedule: true`, in that order, even when
every cell is empty. Every declared member is a column even when every cell is empty, so an export
is a complete description of the type's record shape. Trashed records are not exported.

Cells by format:

| format | export cell | import cell |
|---|---|---|
| `text`, `url`, `email` | the string verbatim | the string verbatim |
| `date` | `YYYY-MM-DD` | `YYYY-MM-DD`, validated |
| `datetime` | RFC 3339 UTC | RFC 3339, validated |
| `number` | canonical decimal (`12.5`) | canonical decimal; non-finite refused |
| `checkbox` | `true` or `false` | exactly `true` or `false` |
| `select` | option **key** | option key; unknown option refused |
| `multi_select` | JSON array of option keys, e.g. `["porch","study"]` | the same JSON array |
| `relation` (single) | target object UUID | an existing target UUID |
| `relation` (multi) | JSON array of target UUIDs | the same JSON array |
| `recurrence` | JSON object, e.g. `{"kind":"weekly","every":1,"weekday":1}` | the same JSON object |

- An empty cell means **absent**, never `""`, `[]` or `null`. A `false` checkbox is a real value and
  is written as `false`. An empty JSON array is an empty cell on export and is omitted on import,
  matching the unset-value invariant.
- Lists and recurrences are JSON inside one quoted CSV cell. This is the one spelling the API and
  frontmatter already use; a comma- or semicolon-separated list would introduce a second grammar
  and collide with labels containing the separator.
- Relation cells address objects by UUID, per the locked identity decision. Importing relations into
  a fresh type therefore requires the targets to exist first; leave relation cells empty on the
  first pass and fill them later, or import the target type first. This is documented in the import
  panel rather than guessed around.
- Export UTF-8 with a leading BOM (spreadsheet compatibility), RFC 4180 quoting and CRLF row ends.
  Import accepts a BOM and either LF or CRLF. Quoting is minimal; a field containing a comma, quote,
  CR or LF is quoted and internal quotes are doubled.
- Import header names are exact and case-sensitive. Duplicate headers, an unknown header, a missing
  `title`, or a header that names a schedule key while scheduling is off is a file-level error
  (`row: 0`). Header order is free; omitted optional columns are absent for every row.
- Row numbers in errors are 1-based data rows: the header is row 0, the first record is row 1.
- Limits: 5 MiB of request body and 10,000 data rows. A body larger than 5 MiB but at most the
  route's 6 MiB limit is refused before parsing with a single file-level problem; a larger body is
  refused by axum's payload limit. A file with more than 10,000 data rows is refused after parsing
  (a quoted multiline cell means rows cannot be counted by lines). A header-only *import* file is
  refused as having no records.
- Export order is `title` case-insensitively, then `id`, so two exports of the same space are
  byte-identical. Import assigns new UUIDv7s; order in the file does not matter.
- `_body` is the markdown body, last column, quoted when multiline. Import stores it verbatim.
- Export is a projection of the type definition: a hand-edited object holding a key the type does
  not declare has no column and is not represented in CSV. The markdown file still holds it; CSV is
  not the backup format. The export never invents a column.

### 4.2 Import semantics

Import is **create-only** and **all-or-nothing at validation**:

1. Parse the header and every row; convert each cell to a typed `Value`; build an `ObjectDoc`
   candidate; run `validate_object` against the current index. Collect every problem, not only the
   first, capped at 50 in the response; keep the rows that had no problem so a dry run can preview
   them.
2. If any problem exists, write nothing and refuse the commit with `422`.
3. If every row is valid, take the space write lock and write the records sequentially: new
   `Uuid::now_v7()`, `rev: 1`, the same `created_at`/`updated_at`, `created_by`/`updated_by` the
   caller, `save_object(path, doc, None)`, then a `Create` revision. Only after all writes does the
   handler broadcast one `objects.imported` event and return the created ids.

Step 3 is not a filesystem transaction: there is no multi-file commit in the store. If an I/O error
occurs mid-way, the handler stops, returns `500` with `details.created` naming what landed, and the
UI reports "N records were written before the failure". Validation failure never writes; an I/O
failure never rolls back. This matches the store's atomic-per-file rule and never discards a file
that was already given to it.

### 4.3 Duplicate semantics

A duplicate is an ordinary create:

- New UUIDv7, `rev: 1`, new `created_at`/`updated_at`, `created_by`/`updated_by` the caller.
- Same `type`, all properties (including `due_date`, `recurrence` and `last_completed_at`), and the
  same body. Nothing is normalized, re-phased or recomputed.
- Title defaults to `"<original> (copy)"`, with the original base truncated so the result fits
  `MAX_TITLE_LEN`; the request may supply a title, cleaned by the same `clean_text` path as create.
- A source that is trashed or absent is `404`; a duplicate of a duplicate is allowed.
- The write is the same sequence as create: lock, validate, write under a fresh slug, append a
  `Create` revision, reload the index, broadcast `object.created`, return `201` with the full object.
- Duplicating does not touch the source file, its revisions or its `updated_at`.

### 4.4 Trash and undo

No new undo table or timed job. `DELETE /objects/{id}` still moves one file to `trash/<id>.md`; the
Undo action in the toast calls the existing `POST /objects/{id}/restore`. The toast's lifetime (six
seconds of visible, un-hovered time) is the visible undo window; hovering or focusing the toast
pauses dismissal, and a newer toast never evicts one carrying an action. The Trash page remains the
durable recovery surface after it closes. Bulk trash restores every id it trashed, and reports a
count if any restore fails.

### 4.5 Bulk edits

Bulk actions fan out over the existing per-object endpoints; there is no batch route and no
transaction.

- Every target carries the `rev` its row was read at. A stale row is a `409` for that record only;
  the others still apply.
- The mutation returns `{ succeeded, failed }`, where `failed` carries the first error message per
  record. The UI shows "Updated 8 of 10; 2 changed since you loaded them" and invalidates the space.
- A bulk property edit writes one property per target (`properties: {key: value}`), or removes it
  (`properties: {key: null}`). It never touches title or body.
- Bulk trash and bulk duplicate reuse the same fan-out and return their created/trashed ids for the
  toast's Undo action.
- Selection is a set of object ids for the loaded page only. It is cleared when the view, filter,
  sorts, search or page changes. After a bulk action, succeeded ids are removed from the selection
  and failed ids stay selected for retry. It never silently includes rows the user cannot see.

### 4.6 Recent items

Browser-local, per user and per space:

- Storage key: `thing:recent:<userId>:<spaceId>`.
- Value: a JSON array of at most 12 `{ id, type, title, at }` entries, most recent first, one entry
  per id (re-opening moves it to the front and updates the title). The stored title is a snapshot;
  a rename elsewhere shows the old title until the record is opened again.
- Written when an object is opened in the record panel or on its page. Read on the space home and in
  the palette's empty state.
- Defensive read: malformed JSON or wrong-shaped entries yield an empty list; no exception reaches
  the page. A write that localStorage refuses (quota, private mode) is swallowed: recents are
  best-effort and never block opening a record. A deleted record's stored entry is not pruned by a
  server call; opening it reaches the normal not-found page.
- No server endpoint, no SQLite table, no format field, no cross-device promise.

### 4.7 Rail order, version and changelog

Browser-local and read-only to the server, like recent items:

- Storage key: `thing:nav-order:<userId>:<spaceId>`. Value: a JSON array of the five rail ids
  `schema`, `schedule`, `members`, `trash`, `settings` in the user's order.
- Default order is Schema, Schedule, Members, Trash, Settings. Unknown ids and duplicates are
  dropped; any known link missing from a stored order is appended in its default position. A
  malformed value yields the default order, and a refused write is swallowed.
- **All spaces** is not part of the saved order; it stays fixed above the reorderable links, under
  a hairline, because leaving the space is not a space destination.
- The rail shows a ghost **Reorder links** control that reveals 32px up/down buttons (44px on coarse
  pointers) beside each link. The controls write on every move; there is no Save.
- The footer shows `v<version>` from `web/package.json` and links to `/changelog`. The version is
  injected at build time from `web/vite.config.ts`; the release notes are maintained in
  `web/src/content/changelog.ts` and must be updated in the same commit as a version bump. Neither
  adds a server route or a format field.

### 4.8 Highlight accent

The accent is a **browser-local, per-user, per-space** preference. It re-colours the existing
one-accent surfaces — focus rings, selection, primary buttons, active rail and view tabs, the
`DEFAULT` marker — and nothing else. It is not a second accent, a theme skin, or a shared space
brand.

- Storage key `thing:accent:<userId>:<spaceId>`; value is one of `lichen`, `yellow`, `orange`,
  `cyan`, `green`, `pink`.
- Default is `lichen`. An absent key, malformed value, unknown id, or a refused write means the
  in-memory choice still applies for the session and the UI does not error; the same defensive read
  and swallowed write as §4.6.
- The choice is per space as well as per user: two spaces can show different highlights in one
  browser, and two members can see different highlights in the same space. There is no
  cross-device promise and no server route.
- Only space routes are themed. `/`, auth, `/changelog` and 404 render `lichen`; entering a space
  applies its saved accent, and leaving resets it.
- Applied as `data-accent="<id>"` on `<html>`. The six palettes are defined in
  `web/src/lib/accent.ts` (the source for the picker and the contrast test) and mirrored in
  `globals.css` as `:root[data-accent=…]` overrides of `--color-accent` and `--color-accent-ink`;
  the table below is the single normative spelling for both. Components keep using the existing
  `accent` / `accent-ink` tokens; no component branches on the id.
- The picker is a six-option radio group in Settings > Appearance, visible to every role because the
  preference is local. Each option shows the colour **name in text** and a sample swatch; selected
  state uses both the accent outline and `aria-checked`. No free colour input, no `<input
  type=color>`, no arbitrary hex field.
- Contrast is a contract: every entry must pass, in both schemes, 4.5:1 for accent text on ground
  and accent-ink text on accent. `lib/accent.test.ts` computes the ratios from the exported
  constants, so a future colour edit that fails is a failing test.

The literal values, measured against dark ground `#121512` and light ground `#f4f3ec`:

| id | label | dark accent | dark ink | light accent | light ink |
|---|---|---|---|---|---|
| `lichen` | Lichen | `#c8d96b` | `#14180f` | `#5f6f1e` | `#f7f8f0` |
| `yellow` | Yellow | `#f2d64b` | `#1a1503` | `#6f5d00` | `#fbf9ea` |
| `orange` | Orange | `#f5a24a` | `#1c1204` | `#9a4a00` | `#fdf6ee` |
| `cyan` | Cyan | `#6fdbe8` | `#04181a` | `#00646e` | `#eefcfe` |
| `green` | Green | `#7fe08a` | `#051706` | `#256b33` | `#f0fbf2` |
| `pink` | Pink | `#f49ac1` | `#1d0711` | `#96325f` | `#fdf1f6` |

### 4.9 UX invariants

These are acceptance contracts for every M4 surface, not suggestions.

1. **A write never loses input.** A failed cell, title, body, schema or settings save leaves the
   user's attempted value on screen with an inline error and a Retry; it never silently reverts or
   clears the editor.
2. **A dirty draft is guarded.** In-app navigation away from an edited record, type, property or
   space setting asks Save / Discard / Stay. `beforeunload` remains for tab close.
3. **State is never guessed.** A list distinguishes loading, updating from a previous query, empty
   because there are no records, empty because a filter/search excludes them, and failed. Totals,
   page ranges and truncation are always stated; stale rows are visibly dimmed and cannot be edited
   or selected as if current.
4. **Every empty state has an action.** The copy names the next action and the surface offers the
   control for it (New record, Clear search, Clear filters, Create a type, Import CSV), or explains
   why the viewer cannot perform it.
5. **Errors are local and retryable.** The message appears next to the control that failed, not only
   in a corner toast; a toast is a summary, never the only report. Server `details` are preserved
   for row/field errors rather than flattened into one sentence.
6. **Keyboard parity.** Capture, palette navigation, table row navigation, selection, bulk edit, save
   and back are reachable without a pointer; overlay focus is trapped, Escape closes only the top
   layer, and focus returns to the trigger.
7. **A route announces itself.** Every route sets `document.title`, moves focus to its heading (or
   the main landmark), and has a skip-to-content link; client navigation restores or resets scroll
   deliberately.
8. **Colour is never the only signal.** Selection, current page, errors, `DEFAULT`, `SCHEDULED`,
   active row and result counts carry text, `aria-*` or a rule as well as hue.
9. **No hidden truncation.** A list that cannot show every matching row says so and offers the way
   to see the rest; non-table views request the server maximum and show a truncation notice when
   `total` exceeds it.

## 5. Core changes

### 5.1 New module `crates/core/src/csv.rs`

Add `pub mod csv;` to `lib.rs`. The module is pure: no filesystem, no clock, no UUID minting.

```rust
/// One record as CSV carries it, before an identity or timestamps exist.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CsvRecord {
    /// 1-based data row; the header is row 0.
    pub row: usize,
    pub title: String,
    /// Typed values by property key; an absent key is an empty cell.
    pub properties: BTreeMap<String, Value>,
    pub body: String,
}

/// One reason a CSV file was refused. `row` is 0 for a file/header problem
/// and 1-based for data rows; `field` is the header key or `csv`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CsvProblem {
    pub row: usize,
    pub field: String,
    pub message: String,
}

/// The valid rows and every problem found while parsing the file.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CsvParse {
    /// Data rows read, valid or not; 0 for a header-only file.
    pub rows: usize,
    /// Rows with no problem, in file order; used for a dry-run preview.
    pub records: Vec<CsvRecord>,
    /// Every problem found; empty means the file may be committed.
    pub problems: Vec<CsvProblem>,
}

/// Every live record of `def`, in the grammar of §4.1. The caller supplies
/// `records` already ordered by title then id. The header comes from `def`;
/// each cell comes from the value's own variant, so a hand-edited mismatch
/// cannot make export guess or panic.
pub fn export(def: &TypeDef, records: &[&ObjectDoc]) -> String;

/// Parses and validates a whole file. It returns every valid row and every
/// problem; the caller commits only when `problems` is empty, so validation is
/// all-or-nothing even though a preview can show the valid rows.
pub fn parse(schema: &Schema, def: &TypeDef, text: &str) -> CsvParse;
```

Implementation rules:

- Build the header from `def.properties` and, when `def.schedule`, `schedule::SCHEDULE_KEYS`,
  bracketed by `TITLE_KEY` and the literal `BODY_KEY = "_body"`. `_body` is not a legal property
  key, so the body column cannot collide with user data.
- `export` formats each value by its `Value` variant: text verbatim, number as a canonical decimal,
  bool as `true`/`false`, list as a JSON array, recurrence as a JSON object. It writes a cell only
  when the object holds the key. It always writes the same number of fields per row and uses the
  `csv` crate's writer with CRLF and a BOM. It cannot fail: the buffer is a `Vec<u8>` and every value
  is valid UTF-8, so writer errors are structurally impossible and `expect` carries that reason.
  Inside `thing_core::csv`, refer to the dependency as `::csv` or alias it, so the module and the
  crate do not shadow each other.
- `parse` strips one leading U+FEFF, uses the `csv` crate with headers enabled and flexible records
  disabled, and maps syntax/UTF-8/field-count errors to a `CsvProblem` at the current 1-based data
  row, carrying the reader's physical line in the message when it differs.
- Header validation happens once: duplicate name, unknown name, missing `title`, or a schedule key
  on an unscheduled type. A file with zero data rows produces one file-level problem, so a
  downloaded header-only template cannot be committed as an empty import.
- Cell parsing: empty is absent; text formats become `Value::Text`; number is a finite `f64`;
  checkbox is exactly `true`/`false`; select is the option key as `Text`; multi-select and multi
  relation are `serde_json::from_str::<Vec<String>>`; single relation is a UUID string; recurrence is
  `serde_json::from_str::<Recurrence>`. Unknown options, unknown relation targets, malformed dates,
  emails and URLs are left to `validate_object`, so there is one authority for meaning.
- Trim the title (the same `trim` the create route's `clean_text` performs), then build a candidate
  `ObjectDoc` with `Uuid::nil()`, `rev: 1`, `OffsetDateTime::UNIX_EPOCH` and the `type_key`, then
  call `validate_object`. Each returned error is rebased onto
  `CsvProblem { row, field: key, message }`. Property text keeps its spaces verbatim.
- Tests: one full round trip for every format including scheduled keys and a multiline body; empty
  cells; `false`; quoted comma/quote/newline; BOM; CRLF and LF; unknown, duplicate and reordered
  headers; missing title; header-only; malformed CSV; bad number/checkbox/date/email/URL; unknown
  select option; unknown relation target; recurrence JSON; multi-select and multi-relation arrays;
  a schedule key on an unscheduled type; a type with a property keyed `body` still has distinct
  `body` and `_body` columns; export ordering; an undeclared object key is not a column; every row
  has every column.

### 5.2 No other core changes

`model`, `markdown`, `validate`, `index`, `filter`, `query`, `store` and `schedule` are unchanged.
`SCHEDULE_KEYS` already exists and is the only schedule-key order any new code uses.

## 6. Server changes

### 6.1 Duplicate route

`crates/server/src/routes/objects.rs` gains one route:

```
POST /api/spaces/{space}/objects/{object}/duplicate   [editor]
```

Body, with `deny_unknown_fields`:

```json
{ "title": "Monstera (patio)" }
```

`title` is optional. Handler:

1. `space_for(..., Role::Editor)`.
2. Take `handle.write.lock()`.
3. Load the live source doc; `404` if it is trashed or absent.
4. Clone the doc, replace `id` with `Uuid::now_v7()`, set `rev: 1`, both timestamps to one `now`,
   both user fields to the caller, clear `trashed_at`/`trashed_from`, and set the title from the
   request or the default. `clean_text("title", ...)` applies.
5. `new_object_path`, `validate_object`, `save_object(None)`, append a `Create` revision with the
   snapshot and body, `reload_file`, broadcast `object.created`.
6. Return `201` with `object_json`.

### 6.2 CSV export route

New module `crates/server/src/routes/csv.rs`, merged in `routes/mod.rs`.

```
GET /api/spaces/{space}/types/{type}/export[?template=true]   [viewer]
```

- Resolve the type; `404` if unknown. Read under the index lock: `TypeDef`, then every live
  `ObjectDoc` whose `type_key` matches. Sort by `title.to_lowercase()` then `id`.
- `csv::export(def, &records)`; return `200` with:
  - `Content-Type: text/csv; charset=utf-8`
  - `Content-Disposition: attachment; filename="thing-<type-key>-<YYYY-MM-DD>.csv"` (UTC date;
    the type key is already a safe slug)
- `?template=true` returns the header row and no records, for the import panel's **Download
  template** link. The header is built from the same function as a full export, so the two cannot
  drift. Any other query parameter is refused by `ApiQuery::finish`.

### 6.3 CSV import route

```
POST /api/spaces/{space}/types/{type}/import?dry_run=true|false   [editor]
Content-Type: text/csv
```

- Route-level `DefaultBodyLimit::max(6 * 1024 * 1024)`, with a handler check at 5 MiB (refuse
  strictly larger), so a 5–6 MiB body gets the JSON envelope and anything larger is refused by axum.
- `dry_run` defaults to `false`; a value other than `true`/`false` is `422` on `dry_run`. Missing or
  non-`text/csv` `Content-Type` is `422` on `content-type`.
- Read bytes, check size, decode UTF-8 (refuse with one `csv` problem), call `csv::parse` against
  the current index, then refuse over 10,000 data rows with one file-level problem. The 5 MiB cap
  bounds the work before the row count exists; a quoted multiline cell means rows cannot be counted
  by lines.
- **Dry run:** a readable, correctly typed file always returns `200`, including one with row
  problems (the problems are the response):

```json
{
  "rows": 12,
  "valid": false,
  "errors": [
    { "row": 7, "field": "room", "message": "unknown option attic" }
  ],
  "preview": [
    { "row": 1, "title": "Monstera", "values": { "room": "porch" } }
  ]
}
```

`rows` is `CsvParse.rows` (every data row read, valid or not). `preview` is at most 20 rows from
`CsvParse.records` and uses `value::to_json` for each typed value. `valid` means `errors` is empty.
A refused row appears only in `errors`; valid rows still preview so the user can see what will be
written.

- **Commit:** if `parse` returns any problem, `422` with `details.errors` in the same shape and no
  writes. Otherwise take the write lock, re-read the type (a schema change between parse and commit
  invalidates the parse: re-run `parse` under the lock), then write every record as described in
  §4.2. Return `201`:

```json
{ "count": 12, "created": [ { "id": "019...", "title": "Monstera" } ] }
```

Broadcast one `objects.imported` event with `{ "type": "<key>", "count": 12 }`; the client's
prefix invalidation already ignores the payload. The watcher will also see each new file and emit
its own announcements; that is harmless by design.

- Add `ApiError::validation_details(Vec<Value>)` in `error.rs` for a 422 whose `details.errors`
  carries `{row, field, message}`; do not force CSV problems into `CoreError` and lose the row. Add
  `ApiError::internal_details(message, Value)` for the partial-write 500 whose `details.created`
  names what landed.

### 6.4 No other server changes

- Existing object list, create, patch, trash, restore, complete, agenda, history and relations are
  unchanged.
- Existing events remain; only `objects.imported` is new.
- No bulk route, no cross-type object listing, no palette endpoint.
- Existing invite/member routes (`POST`/`GET .../invites`, `DELETE .../invites/{code}`,
  `POST`/`DELETE .../members/{user}`), type deletion (`DELETE .../types/{key}?delete_objects=`),
  property deletion (`DELETE .../properties/{key}?force=`) and property-key rename are unchanged;
  M4 only puts a UI on them. Their existing guards (last owner, dependent views, in-use counts)
  stay authoritative.
- No accent route and no `space.yml` change; §4.8 is browser-local.

## 7. Web changes

### 7.1 API layer

`web/src/api/types.ts`:

```ts
export interface CsvProblem { row: number; field: string; message: string }
export interface CsvPreviewRow { row: number; title: string; values: Record<string, unknown> }
export interface CsvPreview {
  rows: number;
  valid: boolean;
  errors: CsvProblem[];
  preview: CsvPreviewRow[];
}
export interface CsvImportResult {
  count: number;
  created: { id: Uuid; title: string }[];
}
export interface DuplicateObjectInput { id: Uuid; title?: string }
export interface Invite {
  code: string;
  role: Role;
  created_at: string;
  expires_at: string | null;
  used_at: string | null;
}
export interface CreateInviteResult {
  code: string;
  url: string;
  expires_at: string | null;
}
export interface MemberView {
  user: Uuid;
  name: string;
  email: string | null;
  role: Role;
}
```

`web/src/api/client.ts`:

- Keep `request<T>` unchanged for JSON.
- Add `sendCsv<T>(path, file): Promise<T>`: POST with `content-type: text/csv`, `credentials:
  "same-origin"`, `accept: application/json`, body the `File`; parse the JSON response and the same
  `ApiError` envelope on non-2xx.
- Add `downloadFile(path, fallbackName): Promise<void>`: fetch with credentials; on failure parse
  the JSON envelope and throw; otherwise create an object URL, click a temporary `<a download>` with
  the filename parsed from `Content-Disposition` (fallback `fallbackName`), and revoke the URL.

`web/src/api/queries.ts`:

- `queryKeys.palette(spaceId, typeKey)`: `["space", spaceId, "palette", typeKey]`.
- `usePaletteRecords(spaceId, typeKeys, enabled)`: one `useQueries` entry per type, GET
  `/objects?type=<key>&filter=<empty>&sorts=<updated_at desc>&limit=100`, `enabled` only when the
  palette is open (not on every keystroke), `staleTime: 60_000`. The explicit empty filter and
  sort mean every record is eligible and the newest 100 are returned regardless of the type's
  saved view. Returns flattened `{ id, type, title, updated_at }` rows plus `isPending` and
  `isError` for each lookup.
- `useDuplicateObject(spaceId)`: POST duplicate; invalidate the objects prefix, the space prefix and
  the types prefix; return `ObjectDetail`.
- `useBulkUpdateObjects(spaceId)`: input `{ targets: {id, rev}[], properties: Record<string,
  unknown | null> }`; `Promise.allSettled` over PATCH; return `{ succeeded: Uuid[]; failed: { id;
  message }[] }`; invalidate objects/space on settle. No optimistic row rewrite: the point is a
  truthful result count.
- `useBulkTrashObjects(spaceId)`, `useBulkRestoreObjects(spaceId)`,
  `useBulkDuplicateObjects(spaceId)`: same fan-out and result shape. These bypass
  `useSpaceMutation` because it assumes one input and one result.
- `useCsvPreview(spaceId, typeKey)`: `sendCsv` with `?dry_run=true`, returning `CsvPreview`; no
  invalidation.
- `useImportCsv(spaceId, typeKey)`: `sendCsv` with `?dry_run=false`, returning `CsvImportResult`;
  invalidate the space prefix on success or on a partial-write failure.
- `useExportCsv(spaceId, typeKey)`: `downloadFile` to the export route, optionally with
  `?template=true`; used by buttons, not a query.
- `useInvites(spaceId, enabled)`: GET the space's invites; owner-only and enabled only while the
  Members page is showing the invite panel. `useCreateInvite`, `useRevokeInvite`, `useSetMember`,
  `useRemoveMember`: POST/DELETE the existing routes; invalidate the space prefix on success and
  return the refreshed detail.
- `useDeleteType(spaceId, key)`: DELETE with `?delete_objects=true` only after the danger-zone
  choice; invalidate the space and types prefixes. `useDeleteProperty(spaceId, key)`: DELETE with
  `?force=true` only after the in-use confirmation; invalidate the space prefix. Neither hook hides
  a `409`: the caller renders the server's usage count and asks for the explicit choice.
- `useSpaceEvents` returns `"connecting" | "live" | "reconnecting"` (plus the existing invalidation
  behaviour) so the header can show a connection state. No new endpoint.

### 7.2 Pure helpers

New modules, all tested without React:

- `web/src/lib/search.ts`
  - `score(query, text): number | null` — case-insensitive subsequence match; higher for a prefix,
    a word-boundary start and contiguous runs; `null` when the query is not a subsequence.
  - `rank<T>(query, items, text): T[]` — stable sort by score; empty query returns input order.
- `web/src/lib/hotkeys.ts`
  - `isEditableTarget(target: EventTarget | null): boolean` — input, textarea, select,
    contenteditable. Also treat an event whose `defaultPrevented` is true, and a target inside
    `[role="dialog"]`, as owned by the surface.
  - `useGlobalHotkeys(bindings)` — one `keydown` listener while mounted, ignores editable targets
    unless a binding says `allowInInput` (Escape), respects `metaKey`/`ctrlKey` per platform,
    ignores `event.repeat` for toggles, and returns a platform label (`⌘K` or `Ctrl K`).
  - `SHORTCUTS` — the single descriptor list (`keys`, `label`, `scope`, `when`) used by both the
    listener and `ShortcutSheet`. The sheet must never advertise a key that has no binding.
- `web/src/lib/accent.ts`
  - `AccentId`, `ACCENTS` (id, label, dark accent/ink, light accent/ink, per §4.8),
    `DEFAULT_ACCENT = "lichen"`.
  - `accentKey(userId, spaceId)`; `readAccent(storage, key): AccentId`; `writeAccent(storage, key,
    id): void`, both defensive and swallowing storage failures like `recent.ts`.
  - `accent.test.ts` computes WCAG ratios from `ACCENTS` against the two grounds and asserts every
    pair is at least 4.5:1.
- `web/src/lib/display.ts`
  - `readApiProblems(error): { row?: number; field?: string; message: string }[]` and
    `readApiCreated(error): number | undefined`, reading `ApiError.details` without flattening it.
    `readError` stays the one-sentence summary for toasts and headings.
- `web/src/lib/filter.ts`
  - `datePresets(column, today, zone)` returns the conditions for `Overdue`, `Today`, `This week`
    and `Next 7 days`, using existing `greater_or_equal` / `less_or_equal` operators. No new filter
    grammar and no server change.
- `web/src/lib/recent.ts`
  - `recentKey(userId, spaceId)`.
  - `readRecent(storage, key): RecentItem[]` with defensive validation.
  - `recordRecent(storage, key, item, at): RecentItem[]` with de-dupe, 12-item cap and the update
    rule from §4.6.
  - Tests use a fake `Storage`.
- `web/src/lib/paging.ts`
  - `PAGE_SIZE = 50`, `pageFromParam(raw): number`, `pageCount(total): number`,
    `clampPage(page, total): number`, `pageRange(total, page): { offset, limit, first, last }`.
- `web/src/lib/views.ts`: no change to view selection; add `withoutPage(params)` used whenever view,
  filter, sorts or search changes.

### 7.3 App shell, command palette and shortcut sheet

`AppShell` becomes the mount point for the two global overlays, while keeping its current header,
main and footer. `router.tsx` gains one nested destination:

```
{ path: "s/:spaceId", element: <SpaceLayout />, children: [ ... ] }
```

- `components/space-layout.tsx` owns `useSpace`, `useTypes`, the rail and `<Outlet />`. The rail's
  nav order and reorder state live here, so they survive navigation instead of resetting per page.
  `SpaceNav` derives `current` from `useLocation().pathname` and emits `aria-current="page"`; the
  five hardcoded `current: false` entries go. Schema, Members, Settings and a no-types space now
  render the same rail as the table.
- The layout renders one pending state and one error state for the space before the outlet. A 404
  offers **All spaces**; a 403 says to ask an owner; a network failure offers **Retry**. No page
  repeats that fallback.
- Below `lg`, the rail collapses into a sticky space bar (icon, name, role, disclosure) that opens
  the space switcher, types and utility links; the page content starts in the first viewport. Above
  `lg` the existing sticky aside remains. The bar and every rail row keep 44px targets on coarse
  pointers.
- Header, left to right: wordmark; on space routes a ghost **Capture** button (plus icon);
  a **Search / command** button showing the platform shortcut label; a connection indicator when
  the live socket is not `live`; the account email (as today) and Sign out. Capture is ghost so the
  page's own primary action (for example the type page's **New record**) remains the one accent per
  view. Below `sm`, the actions become 44px icon buttons with `aria-label`; the email stays hidden.
  The type page keeps its existing inline **New record** button; Capture is the global, minimal form
  and never replaces inline row entry.
- On routes without a space (`/`), the palette still opens over spaces and global actions; the
  Capture button is hidden, and the palette's Quick capture action explains "Open a space to
  capture a record." Space-scoped actions (Schedule, Types, Members, Trash, Settings) are omitted
  when no space is in the path. Sign out remains.
- Derive the current space id from the path by matching both `/s/:spaceId` and `/s/:spaceId/*`
  (AppShell is a layout route and cannot read child params with `useParams`; matching the bare
  space route too keeps the space home covered).
- Register global hotkeys from `SHORTCUTS`: `Mod+K` palette, `c` quick capture, `?` shortcut
  sheet. Plain keys are ignored while an editable element or a dialog owns focus; `Mod+K` and
  Escape are allowed there. Adding a shortcut means adding one descriptor, not editing two lists.
- **One Escape owner.** A small overlay stack (context provider) records open layers in order. Escape
  closes only the top layer and stops propagation; while any layer is open, global bindings other
  than `Mod+K` and the stack's Escape are suspended. `Cmd/Ctrl+S` in the record panel is registered
  with a `when: no overlay open` predicate, so it cannot save the page behind a sheet. The global
  listener ignores `event.repeat` for toggles, so holding `Mod+K` does not strobe the palette.
- Render `ShortcutSheet` (Base UI Dialog) from `SHORTCUTS`, grouped by scope and filtered to the
  bindings currently active on the route. It never lists a key that is not registered.

`components/command-palette.tsx`:

- One Base UI Dialog whose popup is a centered 40rem sheet, and a full-width bottom sheet below
  `sm`; input autofocus, `text-base` (16px) on coarse pointers, body scroll locked.
- State: query, active index, open. The input is a combobox (`role="combobox"`, `aria-expanded`,
  `aria-controls`, `aria-activedescendant`); the list is a `listbox` of `option` rows grouped by
  section with `aria-label`.
- Sources:
  - **Actions** — Quick capture (opens the capture sheet; editors only), Open Schedule, Types and
    properties, Members, Trash, Settings, All spaces. Role-filter the capture action.
  - **Spaces** — `useSpaces`; selecting switches to `/s/<id>`.
  - **Types** — `useTypes(currentSpace)`; selecting goes to `/s/<id>/t/<key>`.
  - **Records** — `usePaletteRecords`; selecting goes to `/s/<id>/o/<objectId>`. Ranked only when
    the query has at least two characters; a one-character query falls back to Recent/Actions and
    never scores the whole set.
  - **Recent** — from `readRecent`; shown only when the query is empty.
- While record lookups are pending, the Records section reads "Searching records…" rather than
  "No matches"; a failed lookup shows "Search unavailable — Retry" and leaves the other sections
  usable. A slow or broken lookup is never rendered as an empty index.
- Empty query: Actions, Recent, Types, Spaces. Non-empty: rank each section with `score`, cap
  Actions 5, Records 12, Types 5, Spaces 5. Flatten in that order for arrow navigation.
- Keys: ArrowDown/ArrowUp wrap, Home/End jump, Enter runs the active item, Escape closes. Hover sets
  the active item. `aria-live="polite"` reports the result count. A query with no matches shows
  "No matches. Try a type, a record title, or an action." rather than an empty sheet.
- On close, focus returns to the trigger. Selecting an item closes before navigating.
- A record result shows its title, mono type key and relative `updated_at`; a type result shows its
  name and mono key; a space result shows its name and role.
- The palette's footer hint for `?` is removed unless the shortcut actually works from inside the
  palette; the shortcut sheet may be opened from the palette as a stacked layer or not advertised at
  all.

The record lookup is deliberately bounded: up to 100 most recently updated records per type, titles
only, fetched once when the palette opens. M5 replaces this with the index and body search; M4 must
not claim body search.

### 7.4 Quick capture

`components/quick-capture.tsx` plus a small context provider mounted by `AppShell`:

- `useQuickCapture().open(typeKey?)` opens the dialog; the provider is available to the header,
  palette, space home, type page and empty states.
- Base UI Dialog, same responsive sheet rules as the palette.
- Fields:
  - **Type** — a select over the current space's types. Defaults to the last type captured by this
    user in this space (`thing:quick-capture-type:<userId>:<spaceId>`), else the type passed by the
    opener, else the first type. Changing it keeps the title and resets property fields.
  - **Title** — required, `maxLength=200`, autofocused.
  - **Required properties only** — every `TypeProperty.required` member, rendered with the existing
    `PropertyInput` and labelled with its name and mono key. Generated schedule keys are never
    required. Non-required properties are absent; this is capture, not the full record panel.
  - A short sentence when the type has no required properties: "Only a title is required for this
    type."
- Buttons: **Create** (primary) and **Create and open** (ghost). `Mod+Enter` creates;
  `Mod+Shift+Enter` creates and opens. Both are disabled while pending, when the title is empty, or
  when any required value is empty. `Escape` closes and discards the draft; there is no draft
  autosave.
- Submit posts `{type, title, properties}` through `useCreateObject`, omitting absent values.
  - **Create** toasts "Record created" with an **Open** action, keeps the dialog open, resets the
    title and required values, keeps the type, and refocuses the title.
  - **Create and open** closes and navigates to `/s/<space>/o/<id>`.
- A refused submit keeps the sheet open with every value intact, shows the server's message inline
  above the buttons, focuses the first invalid field, and re-enables both buttons for a retry. A
  toast never becomes the only report of a failed capture.
- A successful create from a filtered or paged table clears the query state that would hide the new
  row when the user closes the sheet, or the toast's Open action is the explicit escape hatch. A
  new record is never created invisibly without one of the two.
- A viewer never sees the trigger or the palette action. A space with no types shows "This space has
  no types yet" with a link to the schema page for editors (viewers are told to ask an owner)
  instead of a form.
- On the spaces list, open capture is unavailable because there is no target space.

### 7.5 Space home, recent items and onboarding

`pages/space.tsx` stops redirecting to the first type and becomes the space home at `/s/:spaceId`:

- Header: icon, name, role, Settings link — the existing block.
- **Recent** (when the recent list is non-empty): at most 12 rows, each linking to its record, with
  the title, mono type key and relative time. The list is read once on mount from `recent.ts`.
  Empty copy: "Records you open will appear here."
- **Types**: every type as a keyed row (icon, name, mono key, object count, property count, and
  `SCHEDULED` when it has scheduling), linking to its default view. Editors get a `+ New type` link
  to `/schema`; viewers see no create action. Empty state is the onboarding panel:
  - Heading "Start with a type".
  - One sentence: "A type is a table. Its properties are columns; its records are rows."
  - Three numbered lines: create a type, add properties, add records.
  - Editors get a primary link "Create your first type" to `/s/<id>/schema`, plus one sentence that
    CSV import appears on a type page once a type exists. Viewers get "Ask an owner to create the
    first type" and no link.
- Quick actions: **Capture** (editors only; opens the capture sheet) and **Open schedule** (every
  role); both 44px on coarse pointers.
- The page records nothing by itself. `useRecordRecent` is called by the object page and the record
  panel when an object is loaded. `useSpaceEvents` runs on the home so type counts and recent
  records stay live with the rest of the space.
- Onboarding refinements elsewhere:
  - Spaces list, zero spaces: "No spaces yet. Start one below; you can invite people once it
    exists." (the form is already below).
  - Type page, zero records and no filter/search: show the sentence plus the existing **New
    record** button (the inline create-and-edit path), instead of only the words "Create the first
    one." Typing a title immediately is the fastest first record; Capture is for every other
    surface.
  - Schema page, no types: keep the inline create form, add the same one-sentence explanation above
    it.
  - Trash, palette and board/calendar empty states keep their current copy unless it names no next
    action; do not add sample data, tours or modals.
- `SpaceNav` gains an **Overview** link to `/s/<id>`. Its `current` flag is derived from
  `useLocation().pathname` in the layout; the old page-local `selected` prop is removed, so Overview,
  Schedule and every utility link mark themselves in one place.
- Every dead end gains its action: type page with zero records shows **New record** (already
  inline), filtered-empty shows **Clear filters** and **Clear search**, a board with no lanes shows
  **Open view settings** for editors and explains the missing property for viewers, calendar with no
  dated records shows **Open the table**, and Trash with no items links back to the space.

### 7.6 Table paging, selection, bulk actions and row actions

`TypeTable` and `components/views/table-view.tsx`:

- **Filter drafts.** A condition is not sent to the server until it has a value. `FilterBar` keeps
  its own draft list; `newCondition` starts with `value` absent; the wire query contains only
  complete conditions. A new or column-changed row shows "Needs a value" and the table keeps its
  current rows. Changing or clearing a value never produces `value: ""`; clearing removes the
  condition from the query. Saving a view persists only complete conditions and leaves an
  incomplete draft visible until the user fixes or removes it. The same rule applies to a select
  condition whose option is not chosen yet.
- **Sortable headers.** Each property header label is a button: click sorts `ascending`, click again
  `descending`, a third click removes that column from the sort. Shift-click appends/toggles a
  secondary sort. The active header shows an arrow and `aria-sort`; the SortBar remains the place
  for reordering and removing multi-column sorts. A sort change deletes `page` and clears
  selection, like every other query change.
- **Sticky identity.** The title column is pinned left with a `surface` background and a 1px rule,
  matching the right action column; it does not scroll out of view. The header sticks inside a
  bounded `overflow-auto` table scrollport (not a horizontal-only wrapper), so labels remain
  visible on long tables. No shadow is used to fake the sticky edge.
- **Truthful fetching.** `useObjects` exposes `isFetching`/`isPlaceholderData`; the table body gets
  `aria-busy`, dims to 60% while a new query is in flight, and disables cell, checkbox and row
  actions until the current rows arrive. A stale page is never editable as if it were current, and
  a fetch never silently cancels an in-flight cell write for the same row.
- **Paging.** Add `?page=` (1-based, default 1) to the **table** view. The table sends `limit:
  PAGE_SIZE` and `offset: (page - 1) * PAGE_SIZE`; clamp a stale page after a fetch whose `total`
  shrank. Page changes clear selection. Any view, filter, sorts or `q` change deletes `page` (and
  selection); switching away from the table deletes `page`. Footer under the table: `1–50 of 120`
  in mono, Prev/Next ghost buttons, disabled at the ends. At 375px the footer stays one row.
  Board, gallery and calendar are not paged: they request `limit: 500` (the server maximum) so the
  layout sees as much of the type as one response carries. If their `total > 500`, a mono footer
  says the view is truncated and to use the table.
- **Selection.** Selection lives in `TypeTable`, not `TableView`, and is cleared by an effect keyed
  on `view.key`, the serialized filter, the serialized sorts, `q` and `page`. `TableView` stays
  mounted across those changes, so a row-local selection state would outlive the visible rows. The
  table gains a leading checkbox column, 44px wide, not part of the saved `columns` or `widths`, and
  the constant is included in `totalWidth` and the sticky offsets. The header checkbox selects
  every loaded row (the page) and shows an indeterminate state for a partial page; row checkboxes
  are native inputs in 44px labels. Selected rows get a `bg-raised` fill — no colored side stripe.
  Keep the row's own links and cells working. Selection is available to editors only. A selected id
  that disappears from the loaded page (a live delete) is pruned; ids are never sent for rows the
  page no longer shows.
- **Bulk bar.** Rendered between the filter/sort bar and the renderer when `selected.size > 0`:
  `N selected` in mono, then **Edit property**, **Duplicate**, **Move to trash**, **Clear**. On
  `<md` it becomes a sticky bottom bar above the footer with 44px controls and safe-area padding.
  - **Edit property** toggles an inline panel (not a modal) with a property select (all type members
    including generated schedule keys, not `title`), the existing `PropertyInput` for the chosen
    property, **Apply**, **Clear value**, **Cancel**. Apply fans out
    `useBulkUpdateObjects` with one key; Clear sends `null`. A required property's clear is refused
    by the server and shown in the bar. Keep the panel open after a partial failure so the user can
    retry the failed rows.
  - **Duplicate** fans out `useBulkDuplicateObjects`, toasts "Duplicated N records" with **Undo**,
    which trashes the new ids. Remove the succeeded ids from the selection; a partial failure keeps
    only the failed ids selected.
  - **Move to trash** fans out `useBulkTrashObjects`, toasts "Moved N records to trash" with
    **Undo**, which restores the ids. Remove the succeeded ids from the selection; a partial failure
    keeps only the failed ids selected. The Trash page remains the durable path.
  - Results: "Updated 8 of 10; 2 changed since you loaded them" as a danger toast, with the first
    failure's server message; no alert dialog. Failed rows stay selected for retry.
- **Row actions.** The sticky action column gains two icon buttons next to Complete/open:
  `Duplicate` (copy icon) and `Move to trash` (trash icon), with `aria-label` and 44px hit areas.
  They are visible on hover/focus on fine pointers and always visible on coarse pointers. Trash is
  one click plus the undo toast, not a confirmation dialog; Duplicate toasts with Undo. The record
  panel gains a **Duplicate** button in its header and keeps its existing inline trash
  confirmation; both actions use the same toast-with-Undo behavior. Duplicating from the panel does
  not navigate.
- **Keyboard.** The table is one tab stop, not 300. Wrap it in a focusable grid container
  (`role="grid"`, `aria-rowcount`, `aria-colcount`) with roving `tabIndex`: exactly one cell is
  tabbable, the active cell; only the active row's checkbox and action buttons are tabbable, and
  every other row's controls are `tabIndex="-1"`. `j`/`k` move the active row, `h`/`l` or
  Left/Right move the active column, `Enter` activates the focused cell (opens the editor or the
  record), `x` toggles the row's checkbox, `Escape` clears the active row and selection, `/` focuses
  search. The active row is marked by a 1px `line-strong` inset outline; selection remains
  `bg-raised`, so the two never look the same. The grid handler ignores events from inputs, open
  menus and `event.defaultPrevented`, and ignores `event.repeat` for `x`. Each editable cell's
  accessible name includes the record title, the property name and the current value (`Edit Room for
  “Monstera”, currently “Study”`), so a screen reader can tell rows apart. Rows carry
  `aria-selected` and `aria-rowindex`; the title cell is `scope="row"`. Scrolling the active row or
  cell into view must not move focus.
- **Viewers.** No checkbox column, no bulk bar, no row action buttons, no hotkeys beyond navigation
  and opening a record.

### 7.7 CSV data panel

On the type page, a **Data** ghost button joins Columns / Save view / Reset / View settings for
editors; viewers get the same Data button next to search with export only. Opening it closes Columns
and View settings. The inline panel (below the toolbar, above the filter bar) contains:

- **Export** — "Every live record of this type, one row each. Columns are property keys; lists and
  recurrences are JSON." A **Download CSV** button calls `useExportCsv` and uses
  `thing-<type>-<date>.csv` as the fallback filename. Viewers see this section and no import.
- **Import** (editors only) — a file input accepting `.csv,text/csv`, the explanation "The header
  row must use this type's property keys. Empty cells mean no value. Relations use record IDs."
  and a **Download template** button that requests the export with `?template=true` (header only),
  so the user starts from the exact header rather than a file full of existing rows.
  - On file selection, refuse a file that is not `.csv`/`text/csv` or is over 5 MiB client-side with
    the sentence the server would use, so no wrong file round-trips. The dry-run request carries an
    `AbortSignal`; choosing another file or closing the panel aborts the previous one. Preview and
    Import share one pending state: Import is disabled while a dry run or a commit is in flight, so
    a double click cannot import twice.
  - The dry run shows "N rows ready" when every row is valid, otherwise "N valid rows; M problems".
    Include a compact preview of the first 5 valid rows (title plus non-empty values as mono
    `key: value`) and the problem list (first 20) as `row 7 · room — unknown option attic` in ember
    text. File-level problems use `file`; the list comes from `readApiProblems`, never from
    `readError`'s flattened sentence. A row/field problem focuses or links to its row where the
    panel can show it.
  - **Import N records** is enabled only when `valid` and N > 0. It commits, toasts "Imported N
    records", invalidates the space, closes the panel and clears selection. Success does not
    navigate; the current view updates through invalidation.
  - A partial I/O failure invalidates the space prefix (so the records that landed appear), shows
    the server's message and the count already written, and leaves the panel open so the file can be
    corrected and retried.
  - Export failures render inline in the panel with Retry; a blocked download or a 4xx is not a
    silent no-op.
  - No drag-and-drop upload target. The file input is the whole control.

### 7.8 Responsive and touch

- Header: below `lg` Capture and palette move into the bottom bar, so the header keeps only the
  wordmark and a 44px Sign out icon; from `lg` they stay as labeled header controls. The Shortcuts
  button is keyboard-only and does not render below `sm` or on a coarse pointer; its `?` cap and the
  palette's key hints follow.
- Palette and capture: full-width bottom sheets below `sm`, 16px inputs, 44px rows, focus trap,
  Escape, and focus restored to the trigger.
- Space nav: Overview first; every link and the space select keep 44px targets on coarse pointers.
  Below `lg` the rail is a fixed **bottom bar** carrying the space menu plus direct Capture and
  palette buttons, within thumb reach rather than at the top; the space area opens the same links
  as a bottom sheet. The bar clears the safe area, the page and footer reserve room for it, and the
  sheet closes on selection, Escape or its close button with focus returned to the bar. It is
  rendered through a portal because the page wrapper's transform would otherwise capture a fixed
  child.
- Table: keep horizontal scrolling with the sticky header and pinned title on desktop.
  Checkboxes, row actions and the bulk bar are 44px on coarse pointers. Below 640px the title
  unpins, the action cell keeps only Open plus a 44px row menu (Complete, Duplicate, Move to trash),
  so a property column is visible and swipeable; the action column is no longer 184px of icons.
  Do not add a card renderer in M4.
- Toasts: action buttons are 44px on coarse pointers and remain keyboard reachable; danger toasts
  do not auto-dismiss while hovered or focused.
- Contrast floor: introduce `--color-line-interactive` at ≥3:1 against `ground` for field, select
  and trigger boundaries in both schemes; use it only for interactive controls, keeping
  `--color-line` for dividers. Raise `--color-faint` to ≥4.5:1 wherever it renders text. A raw
  `<button>` (emoji cells, Purge, icon-only controls) gets the same 44px coarse-pointer rule as the
  shared `Button`.
- Every displayed date is formatted in the space timezone (or explicitly labelled UTC if a surface
  is intentionally UTC). The timezone picker gains filtering and a **Use this device's zone**
  action rather than a flat list of every IANA zone.
- Verify at 375×667, 768×1024 and 1280×800; first content in the first viewport, no horizontal page
  overflow, no clipped dialogs, no hover-only control that is needed on touch.

### 7.9 Visual direction

Stay inside the Nocturnal Field Guide: dark first, hairline rules, mono keys and counts, one accent
at a time for selection/focus/primary action, drawn from §4.8. The palette is a ruled sheet with a
mono section label and a single active row marked by the accent key, not a filled highlight; the
capture sheet is a form, not a wizard; the bulk bar is a hairline band; row actions are line icons at
one weight. Colour never carries state alone: `SCHEDULED`, `DEFAULT`, `N selected`, error rows and
result counts are text. A per-space accent changes hue, never the hierarchy or the amount of colour
on screen.

### 7.10 UX foundation and feedback

These are cross-cutting and land before the feature checkpoints; they are not per-page polish.

- **Error taxonomy.** One helper classifies an `ApiError`: `401` redirects to login with the full
  current location; `403` renders "You don't have access. Ask an owner."; `404` renders the missing
  thing plus **All spaces**; network/5xx renders **Retry**. A page never treats a failed session
  probe as a signed-out user.
- **AuthGate and auth forms.** `AuthGate` renders a loading state while `me.isPending`, a retryable
  "Could not check your session" on `isError`, and redirects only when the query succeeded with
  `data === null`. `/login`, `/register` and `/join/:code` also wait for `me` before rendering a
  form, so a signed-in visitor never sees a flash of the auth surface. The post-login return target
  is `pathname + search + hash`, validated as an internal path.
- **Toast policy.** Each toast owns its timer. Hovering or focusing a toast pauses it; a danger
  toast stays until dismissed; an action toast is never evicted by newer toasts; the visible stack
  is capped at four and the oldest non-action toast is the only one dropped. Each toast is its own
  live region with the correct politeness (`status` for plain, `alert` for danger), not nested
  inside a second `aria-live`. Toasts remain the summary, never the only error surface.
- **Route announcement.** A small `useRouteMeta(title)` hook sets `document.title` from the space,
  type and record already loaded; a route-change effect focuses the page `h1` (or `<main>`) and
  writes one polite announcement. A **Skip to content** link precedes the header. React Router's
  `<ScrollRestoration />` is rendered so back/forward restores the prior offset and a new destination
  starts at the top. A record opened from a long table does not land mid-page.
- **Breadcrumbs and back.** One breadcrumb component (`Space / Type / Record`) replaces the
  page-invented `←` links. Where the browser has in-app history, Back returns to the actual previous
  surface (Agenda, a filtered table, the palette); otherwise it goes to the canonical parent. The
  label names the destination, not "Back".
- **Connection state.** `useSpaceEvents` exposes `connecting | live | reconnecting`. The header shows
  a mono text indicator only when not live; on a transition back to live it invalidates the space
  prefix. While the socket is down, `refetchOnWindowFocus` is enabled so a returning tab refreshes;
  while live, it stays off. Offline is shown as text, never only a colour.
- **Search box.** Search commits on Enter or a 250ms debounce, never on blur alone; blur with an
  unchanged value does nothing. A visible **Clear** control is always present when `q` is set, and
  **Reset** clears `q` as well as filters and sorts (or is renamed **Clear filters**).
- **Structured errors.** `readApiProblems` feeds CSV rows, field errors and partial-write counts;
  `readError` remains the one-sentence summary. A form field error renders under that field with
  `role="alert"` and focus moves to the first invalid field on submit.

### 7.11 Draft safety, write feedback and view parity

- **Router guard.** `useDirtyGuard(dirty, save)` uses React Router's blocker. Navigating away from a
  dirty record, type, property or space setting opens a hairline dialog: **Save**, **Discard**,
  **Stay**. Save runs the page's existing save and stays on failure; Discard leaves; Stay closes the
  dialog. `beforeunload` remains for tab close. The guard is one hook, not four copies.
- **Record panel draft.**
  - The body opens in **Preview** when non-empty; **Write** is an explicit tab. An empty body opens
    in Write. Preview is read-only and cannot dirty the record.
  - Fields with a pending change carry an accent dot and a **Revert** action; the header count says
    "3 unsaved changes" in text.
  - Save, pending and error live in a sticky bar at the panel's bottom edge, adjacent to the action,
    not above the properties. `saveError` clears on the next edit and offers **Retry**.
  - While a save is in flight, fields are frozen; the success response never blind-replaces newer
    keystrokes because none can be typed. Clicking `Complete` while dirty opens a confirm:
    **Save changes and complete**, **Discard changes and complete**, **Cancel**. The save runs first;
    if it fails, completion does not run and the draft stays.
  - A `409` shows a conflict block: **Reload their version**, **Keep my draft**, or **Save anyway**
    (a fresh write from the reloaded revision). The draft is never silently discarded.
  - Fields are keyed by record id + property key, not by a save counter, so a successful save does
    not remount them or drop focus; focus returns to the field that had it.
  - `Mod+Enter` saves, `Escape` invokes the dirty guard and leaves when clean. `Mod+S` is registered
    only while no overlay is open.
  - Dangling relation values render as a **Missing target** row with the short id and a remove
    action; the relation editor can remove one id, not only every relation. Unknown property keys
    render through `valueLabel`, never `[object Object]`.
  - Date and datetime fields gain **Clear** and **Today**/**Now**; values are entered and displayed
    in the space timezone.
- **Cell writes.** The cell editor stays open until the write succeeds; on failure it shows an inline
  message with **Retry** and keeps the attempted value. Writes to one row are serialized through a
  per-row promise queue and use the `rev` returned by the server, so two quick edits cannot
  self-conflict. On success or cancel, focus returns to the cell button. The toast is a summary.
- **New record lifecycle.** **New record** opens an inline draft row; the POST happens on the first
  non-empty title commit, so Escape leaves no `Untitled` file. A successful create toasts with
  **Open** and **Undo** (trash the new id), clears the query state that would hide the row, and
  highlights it briefly. Required members are checked before the POST and shown inline on the draft
  row, not after a 422.
- **View parity.**
  - Board cards, gallery tiles and calendar chips gain the same **Complete** and kebab
    (**Open**, **Duplicate**, **Move to trash**) actions as table rows, using the same toasts and
    permissions. They are not links-only previews.
  - Board lane counts reflect the full view total, not the loaded rows. Calendar's `+N more` opens a
    day popover listing every chip; a month with no dated records shows **Open the table** and a
    sentence about the date property. Gallery/board empty states offer **Open view settings** to
    editors.
  - Long titles are readable: `title` attribute plus a two-line clamp, not an unlabeled ellipsis.
- **View settings.** Kind stays fixed; `group_by`, `cover` and `date_property` become editable for
  the matching kind. A board with a missing property links directly to that control instead of
  telling the user to hand-edit a type file. **Save current filter/sort as new view** sits next to
  **Save view**, and **View tabs** use a real tablist with arrow keys, focus the new-view name, and
  scroll the selected tab into view.

### 7.12 Lifecycle and sharing surfaces

- **Members page** (replace the read-only list):
  - Owner sees an **Invite people** block: role select (editor default), **Create invite**, then a
    row with the full `/join/<code>` URL, **Copy link** (toast "Invite link copied"), and
    **Revoke**. Pending and used invites are listed separately; used ones show when they were used.
    A failed copy falls back to selecting the URL text.
  - Owner can change a member's role with a select and remove a member with a confirm; both use the
    existing routes. The server's last-owner refusal is rendered inline with its own sentence.
    Removing yourself asks for confirmation and explains you will lose access.
  - Every role sees a one-line capability legend: owner manages the space and people; editor
    creates and edits content; viewer reads only.
  - Non-owners see the member list and "Only an owner can invite or change roles", with no disabled
    controls pretending to work.
- **Type deletion.** The type editor gains a danger zone showing the live record count. Deleting a
  type with records requires an explicit checkbox **Move these N records to trash** and typing the
  type key; the records go to Trash, not purge, and the UI says so. On success, navigate to
  `/schema` with a toast. No silent cascade.
- **Property deletion.** The property editor shows usage (`N types · N records`) and any dependent
  views. If a view uses it, the action is blocked with a list linking to those view settings. If it
  is in use, deletion requires typing the key and confirms that the value is removed from every
  record and recorded in each history. Property-key rename is a separate action with a warning that
  keys appear in files and CSV headers.
- **Type/property keys at creation.** Both create forms state, above the name field, that the key
  is derived from the name, permanent, and used in file paths and CSV headers; the form never
  promises a live key preview, because that would duplicate the server's `key_from_name` rule.
  The saved key is shown immediately after creation with "the display name can change; the key
  cannot". Property-key rename remains available as a separate, warned action.
- **Trash.** Selection with a "N selected" bar, bulk **Restore** and bulk **Purge forever**.
  Restore toasts with **Open**; purge requires typing the count or space name and focuses the confirm
  control. Row-level errors stay next to the row; a shared pending flag does not disable every row.
- **Join flow.** `/join/:code` waits for `me`. When signed in, explain that redemption happens
  during registration and offer **Sign out and use this invite**, which signs out and *stays on the
  same URL* so the code is never lost. When signed out, the registration form carries the fixed code.
  Copy says "you'll join the space", not "land in it", because registration returns to the space
  list.
- **Spaces list.** Make the name area one full-row link (the annotation button stays separate), hide
  the "0 spaces" count until the query resolves, and sort by most recently visited (browser-local)
  with a name fallback.

### 7.13 Highlight accent

- `components/accent-picker.tsx`, rendered in `pages/settings.tsx` under a new **Appearance** section
  visible to every role:
  - Six radio options from `ACCENTS`, each a 44px swatch plus the label in text (`Lichen`, `Yellow`,
    `Orange`, `Cyan`, `Green`, `Pink`) and a selected rule/outline. `role="radiogroup"` with
    `aria-labelledby`; arrow keys move and select; the current option is `aria-checked`.
  - Hint: "Highlight is saved in this browser for this space. It changes focus, selection and the
    primary action; nobody else sees it."
  - Immediate apply, no Save button. A **Reset to Lichen** ghost control appears when not default.
    A refused storage write leaves the choice active for the session and shows no error.
- `SpaceLayout` reads the accent when the space id and user id are known, writes
  `document.documentElement.dataset.accent`, and resets to `lichen` when leaving the space. The read
  happens in a layout effect so the first paint inside a space uses the saved hue.
- `globals.css` adds the six `:root[data-accent=…]` blocks for dark and light from §4.8, overriding
  only `--color-accent` and `--color-accent-ink`. Existing `accent`/`accent-ink` utilities, the
  selection rule, focus outline and caret inherit automatically. No component takes an accent prop.
- `DESIGN.md` and `.impeccable/design.json` record the six palettes and the rule that the accent is
  state-only. The colour name is always visible in the picker; swatches are not the only signal.

## 8. Build order

Each numbered item is one checkpoint and one turn. Stop and report after each, per the ROADMAP
protocol. Do not run two in one turn.

Status at amendment time (2026-10-23): checkpoints 1–3 are committed; checkpoint 4's files are in the
working tree. The numbering preserves that work, so the new UX foundation is checkpoint 5 and the
remaining new surfaces follow it. A checkpoint already in progress absorbs the amendments written
for it rather than restarting.

1. **CSV codec in core.** Add the `csv` workspace dependency and `crates/core/src/csv.rs` with
   `CsvRecord`, `CsvProblem`, `export` and `parse` exactly as §5.1, plus `pub mod csv;`. Write the
   unit tests listed there, including the schedule keys and every format. No server or web change.
   Verify: `cargo test -p thing-core`, then the full Rust gate. Report an exported sample and a
   refused sample.
2. **Duplicate route.** Add `POST .../duplicate`, the optional title body, the create sequence,
   `object.created`, and HTTP tests for copying properties/body/schedule values, new id/rev,
   source unchanged, title override, overlong title, unknown field, trashed source and viewer
   refusal. Verify: full Rust gate plus a curl duplicate and a file diff.
3. **CSV routes.** Add `routes/csv.rs`, the export response headers/content, `?template=true`, the
   import dry-run and commit paths, limits, `ApiError::validation_details`, the aggregate event and
   route tests (valid file, invalid row, unknown header, header-only, BOM/CRLF, limits, template,
   viewer export allowed, viewer import refused, no writes on invalid). Verify: full Rust gate plus
   curl: export a seeded type, download its template, dry-run a two-row valid file and a
   one-bad-row file, commit, and list the new records.
4. **Palette and shortcut layer.** Add the API DTOs and client CSV helpers, `lib/search.ts`,
   `lib/hotkeys.ts` with `SHORTCUTS` and the overlay stack, `lib/recent.ts`, `lib/paging.ts` with
   tests; add `usePaletteRecords` (fetched once on open, with pending/error), the AppShell header
   actions, `CommandPalette` and `ShortcutSheet`. No capture yet: the palette's Quick capture action
   is hidden until its action exists. Also add the browser-local rail order (§4.7), the header
   Shortcuts button, the footer version and the `/changelog` page. Verify: web gate plus a browser
   pass on `Mod+K` (including key repeat), arrows, Enter, Escape with stacked overlays, `?`,
   one record/type/space navigation, a slow lookup showing "Searching records…" rather than "No
   matches", a rail reorder that survives navigation and reload, and the changelog link and version.
5. **UX foundation.** Add `SpaceLayout` and the nested `s/:spaceId` route; move `SpaceNav` into the
   layout, derive `current` from the path, add Overview and the mobile space bar. Add the error
   taxonomy, `AuthGate` pending/error/null split, route title/focus/announcement, skip link,
   `ScrollRestoration`, breadcrumbs, connection indicator, toast policy, search-commit rule,
   interactive-border token and `readApiProblems`. No new feature surface beyond navigation and
   feedback. Verify: web gate plus a browser pass that reaches Schema/Members/Settings with the rail
   present and current, opens a record from a scrolled table without landing mid-page, tab-uses the
   skip link, sees a retryable session error instead of the login form, sees the offline indicator
   when the socket is stopped, and gets content above the fold at 375px.
6. **Quick capture.** Add the provider/dialog, type picker, required-property fields, last-type
   storage, Create and Create-and-open, the header button, the `c` shortcut and the palette action.
   Verify: web gate plus a browser pass for each button, required-field refusal, a refused create
   that keeps the sheet and values with an inline error and Retry, rapid double create blocked,
   create-and-open, viewer absence, and a space with no types.
7. **Space home, recent items and onboarding.** Rewrite `pages/space.tsx` as the home, add the
   Overview nav link, read/record recent items, add the type rows and the onboarding copy, and add
   an action to every empty state. Verify: web gate plus a browser pass that opens three records,
   reloads, sees them on the home, checks another browser profile is empty, checks a new space's
   onboarding, and uses `Clear filters`/`Clear search` from a filtered-empty table.
8. **Table truth, paging, selection, bulk actions and row actions.** Add filter drafts, sortable
   headers, the pinned title column and bounded scrollport, `isPlaceholderData` dimming, `?page=`,
   the checkbox column and selection reset token, the bulk bar and its property editor, the fan-out
   hooks, row Duplicate/Trash, undo toasts and the grid keyboard model. Verify: web gate plus a
   browser pass with a type of 60+ records: add a condition before typing and keep the rows, sort
   from a header, scroll right with the title pinned, page 2, select across the page, set and clear a
   property, duplicate, trash, undo, partial-failure copy, viewer absence, and a keyboard-only
   select/bulk-edit run.
9. **CSV data panel.** Add the Data button/panel, export download, template download, import file +
   dry-run preview, structured problem list, abort/guard, commit, success/failure handling, and
   viewer export-only. Verify: web gate plus a browser pass: export Plant, download its template,
   import the export into a second empty Plant type, inspect the created files, break one row and see
   no writes with its row/field message, cancel a slow upload, and check the 5 MiB/10k limits
   through the API.
10. **Draft safety and write feedback.** Add `useDirtyGuard` and wire it through the record panel,
    schema editors and space settings; add the sticky save bar, per-field dirty markers, preview-first
    body, save-in-flight freezing, conflict choices, focus preservation, dangling-relation row,
    date Clear/Today, cell retry and per-row serialization, the draft-row create lifecycle, view
    parity actions, `+N more`, editable `group_by`/`cover`/`date_property`, and tablist behavior.
    Verify: web gate plus a browser pass: edit a body then click a rail link and choose Stay; save a
    cell with the server stopped and retry; open a record, save, and confirm focus stays in the field;
    click Complete with a dirty draft; open a board and Complete/duplicate/trash a card; open a
    calendar day with four chips; change a board group property in view settings.
11. **Lifecycle and sharing.** Add the Members invite/member controls, type and property danger
    zones, property-key rename warning, create-form key notice, Trash bulk restore/purge, the
    join sign-out path that keeps the code, and the spaces-list refinements. Verify: web gate plus a
    browser pass creating and revoking an invite, copying its URL, changing a role, hitting the
    last-owner refusal, deleting an empty type and a type with records, deleting an in-use property
    and a property used by a view, bulk-restoring and bulk-purging trash, and signing out from
    `/join/:code` to reach the registration form with the code intact.
12. **Highlight accent.** Add `lib/accent.ts` and its contrast test, the six CSS blocks, the
    `SpaceLayout` application/reset, the Settings > Appearance picker, and the DESIGN/`.impeccable`
    documentation. Verify: web gate plus a browser pass selecting each accent in dark and light,
    confirming selection/focus/primary action change together, that the choice survives reload and
    is different in a second space, that a fresh profile is Lichen, that a non-owner can change it,
    and that `npm run test:run` enforces the contrast floor.
13. **Responsive, docs and end-to-end.** Do the responsive/touch pass in §7.8 (including the bottom
    nav drawer, hidden mobile keyboard affordances, compact table row actions and in-zone
    timestamps), bump the workspace and
    web package to `0.4.0`, move the `Unreleased` changelog entry to `0.4.0`, update `docs/ROADMAP.md`
    (M4 landed, checkpoints, plan link, version), `AGENTS.md` (current state, new invariants, critical
    files), `README.md` (features and CSV command examples), `DESIGN.md` and
    `.impeccable/design.json` (accent palettes, palette, capture, bulk bar, row actions, mobile
    sheets). Run the full verification in §10, including the keyboard-only and no-lost-input passes.
    Report the final CSV bytes, the accent palette and the final space-home behavior.

## 9. Critical files and anchors

- `crates/core/src/csv.rs` — new; the only CSV grammar. Keys not labels, JSON for lists and
  recurrences, empty cell is absent. The `csv` crate is the only new dependency.
- `crates/core/src/lib.rs` / root `Cargo.toml` — export the module and pin `csv`.
- `crates/server/src/routes/objects.rs` — duplicate reuses the create sequence; do not fork the write
  path or mint a second title-normalization rule.
- `crates/server/src/routes/csv.rs` — export ordering and headers; dry-run/commit; validate all rows
  before writing; one aggregate event.
- `crates/server/src/error.rs` — `validation_details` for row-aware 422s and `internal_details` for
  a partial import; keep every other status mapping unchanged.
- `web/src/api/client.ts` — the JSON `request` stays; CSV needs its own two helpers, not a
  content-type branch inside `request`.
- `web/src/api/queries.ts` — palette record queries, duplicate, four bulk fan-out hooks, import,
  export, invites/members, type/property deletion. Every write invalidates the space prefix as
  today.
- `web/src/lib/search.ts`, `hotkeys.ts`, `recent.ts`, `paging.ts`, `accent.ts`, `filter.ts`,
  `display.ts` — pure, tested where the logic is pure; the only place matching, shortcut
  descriptors, keyboard guards, local recents, page math, accent palettes/contrast and structured
  error reading live.
- `web/src/router.tsx` / `components/space-layout.tsx` — one nested `s/:spaceId` layout owning the
  rail and its nav order; pages no longer duplicate `SpaceNav`.
- `web/src/components/app-shell.tsx` — the only mount point for the two overlays, global hotkeys and
  the overlay stack; derive the space id with `useMatch`, not `useParams`.
- `web/src/components/space-nav.tsx` — Overview first; `current` from the path, not a per-page prop.
- `web/src/components/command-palette.tsx` — accessible combobox/listbox, bounded lookup fetched
  once on open, explicit pending/error copy; do not add `cmdk`.
- `web/src/components/quick-capture.tsx` — required properties only; reuses `PropertyInput`; no
  second value editor; failures keep the sheet.
- `web/src/components/object-panel.tsx` / `components/views/table-view.tsx` — draft guard, sticky
  save bar, focus preservation, cell retry, grid keyboard; keep the single write path.
- `web/src/pages/space.tsx` — the real home; recent items and onboarding; no first-type redirect.
- `web/src/components/type-table.tsx` / `components/views/table-view.tsx` — filter drafts, sortable
  headers, sticky identity, `isPlaceholderData` dimming, paging, selection token, bulk bar, row
  actions; keep one `useObjects` result and the four renderers otherwise unchanged.
- `web/src/components/views/data-panel.tsx` — new; export and import UI; one file at a time.
- `web/src/pages/members.tsx` — invites, roles and removal over the existing routes.
- `web/src/components/schema/type-editor.tsx` / `property-editor.tsx` — danger zones, usage counts,
  key permanence; the existing `409` details are rendered, not hidden.
- `web/src/components/ui/toast.tsx` — per-toast timers, pause, action-toast retention, one live
  region per toast.
- `web/src/components/accent-picker.tsx` / `lib/accent.ts` — the six accents, defensive storage and
  the contrast test; no component takes an accent prop.
- `web/src/styles/globals.css` — `:root[data-accent=…]` overrides and the interactive-border token;
  one accent at a time.
- `web/src/pages/settings.tsx` — Appearance section for every role; owner-only identity and danger
  stay separate.
- `DESIGN.md` / `.impeccable/design.json` — normative for the accent palettes, palette, capture
  sheet, bulk bar, feedback surfaces and touch rules.

## 10. Verification

Prerequisites unchanged: `cargo 1.98`, Node 24, a free port 8080.

```
cargo build --workspace
cargo test --workspace
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cd web && npm ci && npm run test:run && npm run lint && npm run typecheck && npm run build
```

API smoke with `THING_DATA_DIR=./data cargo run -p thing-server` and a fresh seed:

1. `POST /objects/{id}/duplicate` returns `201` with a new id, `rev: 1`, the same type, properties,
   schedule values and body, and title `... (copy)`. The source file, its revisions and `updated_at`
   are unchanged. A `{title}` body overrides the title; an overlong title is `422`; a trashed id is
   `404`; a viewer is `403`.
2. `GET /api/spaces/{space}/types/plant/export` returns `text/csv`, an attachment filename and a
   BOM. The header is `title,<member keys>,due_date,recurrence,last_completed_at,_body`; every
   live Plant record is one row; trashed records are absent; CRLF and RFC 4180 quoting hold.
   `?template=true` returns the same header with no record rows.
3. Re-import that export into a second `plant` type with the same schema: dry run is `200 valid`;
   commit is `201`; `GET /objects?type=` returns the same titles and typed values; the files contain
   `schema: 3`; each history has one `create` revision.
4. A file with one unknown option is `422` with `details.errors[0].row` and `.field`; nothing was
   written. A file with an unknown header, duplicate header, missing `title`, header-only body, bad
   UTF-8, a schedule key on an unscheduled type, a bad date/email/URL/number/boolean, or a malformed
   cross-field record each fails the same way.
5. `>5 MiB` and `>10,000` rows are refused with a file-level problem; 5 MiB exactly is accepted.
   `?dry_run=maybe` is `422`; a non-`text/csv` content type is `422`.
6. Export/import is byte-identical across two exports of an unchanged space. Import creates new
   ids; two imports of the same file create two sets of records.
7. Restart the server: recents (browser), palette records, exported files, duplicates, imported
   records, pages and selections are unchanged or reset exactly as specified. No schema file
   changed beyond the records themselves.

UI pass (server on 8080, `npm run dev` in `web/`):

- `Cmd+K`/`Ctrl+K` opens the palette; type a record title, arrow to it, press Enter, and land on the
  record. `?` opens the shortcut sheet; `Esc` closes both and returns focus. Space, type and action
  results navigate. A viewer sees no Capture action.
- `c` opens capture. Pick a type with a required select; Create is disabled until it has a value;
  Create keeps the sheet open and resets the title; Create and open lands on the record. The chosen
  type persists next time. A space with no types shows the link instead of a form.
- Open three records, reload, and find them in Recent on the space home; a second browser profile
  has none. The space home's type rows show counts and link to the default view. A brand-new space
  shows the onboarding copy and the first-type link.
- In a type with 60+ records, page to 2; select three rows, set `room`, and see all three change
  with one revision each; clear the property; duplicate two and undo; trash one, undo from the
  toast, and see it back in the table. Force a stale revision in a second window and see the
  partial-failure count, not a silent success.
- Row duplicate/trash work with the mouse, keyboard and a coarse pointer; the bulk bar is reachable
  and does not cover the last row; selection clears on filter/sort/search/page/view changes.
- Keyboard only, no pointer: open the palette, open a record, edit a property and the body, save,
  navigate back through the dirty guard, open capture, create-and-open, and complete a row from the
  table. Focus is visible at every step and returns to the trigger after each dialog.
- Draft safety: edit a body or a schema name, click a rail link, and see Save / Discard / Stay;
  Discard leaves and Save persists. Click Complete with a dirty record and see it refused or saved
  first. Stop the server, edit a cell, see the editor keep the value with an inline error, start the
  server, and Retry succeeds without retyping.
- Truthful lists: add a filter condition before choosing a value and confirm the rows do not blank
  or 422; clear a select value and confirm the condition is removed, not sent as `""`. Change a
  filter, search or page and confirm the old rows dim and cannot be edited until the new ones
  arrive. Sort from a header and see the arrow plus `aria-sort`.
- Rail and routing: Schema, Members, Settings and Trash all render the rail with the current link
  marked; `/s/:id` is a home, not a redirect; open a record from a scrolled table and confirm the
  destination starts at the top; Back returns to the actual previous surface.
- Members: create an invite as owner, copy its `/join/<code>` URL, revoke it, change a role, and
  hit the last-owner refusal with its inline message. A non-owner sees the list and the explanation,
  not disabled controls. Visit the copied link signed out, register, and confirm the space is in
  the list; visit it signed in and confirm **Sign out and use this invite** keeps `/join/:code`.
- Lifecycle: delete an empty type, a type with records after choosing **Move to Trash**, an in-use
  property after typing its key, and confirm a property used by a view is blocked with a link to
  that view. Bulk-restore and bulk-purge Trash; focus lands on the purge confirm.
- Accent: in Space settings, switch through all six accents in dark and light; selection, focus,
  the primary button and the active rail change together; reload keeps the choice; a second space
  keeps its own; a fresh profile is Lichen; a non-owner can change it; no other member's UI changes.
  `npm run test:run` includes the contrast test and it passes.
- Type page Data panel: export downloads and opens as a spreadsheet; import previews a valid file,
  refuses a broken one by row/column with no writes, then commits a valid one and shows it live.
  A viewer can export and cannot import.
- 375px: header actions, palette, capture, the collapsed space bar, table scroll with the pinned
  title, bulk bar and toasts are usable; first content is in the first viewport; no page-level
  horizontal overflow; inputs are 16px and targets are 44px.
- Two windows: duplicate, import, trash/undo and bulk edit propagate through the existing space
  events without a manual refresh; kill the socket and see the connection indicator, then restore
  it and see the views refresh.

## 11. Assumptions and contingencies

- CSV headers are property keys, not display names. A spreadsheet-oriented export with labels would
  need a second header row or a mapping dialog and a second spelling; M4 does not add one. The
  header-only template download is the documented starting point.
- Import is create-only, one type at a time, with no schema inference. Rebuilding `plant-tracker`
  means creating the type and properties first, exporting the source to match those keys, and
  importing rows. Upsert and type creation from CSV are later work if they are ever wanted.
- Relation cells are UUIDs. Importing relations into a fresh space needs the targets first; this is
  explicit in the panel rather than a title lookup with ambiguous duplicates.
- CSV list and recurrence cells are JSON in one cell. This looks technical in a spreadsheet, but it
  is the only lossless, delimiter-safe spelling that matches the API and frontmatter.
- Export does not prefix leading `=`, `+`, `-` or `@` to neutralize spreadsheet formulas; doing so
  would change the user's text and make import lossy. The app never opens the file, and the export
  UI says it is data. If CSV ever becomes a public share surface, neutralization belongs there.
- The import is all-or-nothing at validation, not across filesystem writes. A mid-write I/O failure
  reports what landed and never rolls back a file it already wrote. There is no multi-file
  transaction in the store.
- Bulk operations are per-record writes with per-record revisions. They are intentionally not
  atomic; a stale row fails alone and the UI reports the count. A batch endpoint would need its own
  conflict policy and is not part of M4.
- Table paging is added because the list endpoint defaults to 50. Selection is page-local; there is
  no "select all 120 matching records" action. That would need a server-side bulk query and is out
  of scope. Board, gallery and calendar keep their existing single-request layout and use the
  500-row server cap; they are not paged in M4.
- Recent items are browser-local and per user id. They survive reloads in the same browser, not a
  new device or a private window. Putting them in SQLite would violate the accounts-only rule.
- Palette record lookup is title-only over at most 100 recently updated records per type, filtered
  client-side. It costs one list request per type when the palette opens (cached for 60 seconds),
  which is acceptable for a self-hosted space and avoids a fourth object-listing surface. A record
  outside that window is found after M5's index. M4's palette is navigation, not search.
- The undo window is the toast's six seconds of visible, un-hovered life; hovering/focusing pauses
  it, and an action toast is never evicted. The Trash page is the durable recovery surface. There is
  no background purge or grace period change.
- Duplicate copies schedule values without re-phasing. A duplicated recurring chore is due when the
  original is due; Complete is the action that advances it.
- No format bump means a v0.3 binary can read M4 data. The only new state is browser-local recents,
  rail order and accent, plus the new CSV/duplicate routes; an older reader needs none of it.
- The accent is a fixed six-colour palette, not a colour picker. Arbitrary hex would make contrast,
  focus visibility and accent-ink legibility a per-user gamble; six tested values keep §4.8 true.
  It is per user and per space in the browser, not shared and not synced; a space-stored accent
  would require a `space.yml` field and a format/compatibility decision that M4 avoids.
- Members, invites, role changes, type/property deletion, property-key rename and Trash purge all
  use routes that already exist. M4 adds UI, not server policy; the server's last-owner, in-use and
  dependent-view refusals are rendered rather than pre-empted by a second rule in React.
- Invite redemption remains part of registration. An existing signed-in account cannot join through
  an invite in M4; `/join/:code` says so and signs out without losing the code. A signed-in accept
  endpoint is later work.
- The dirty guard is a navigation prompt, not autosave. A crash, tab close or browser kill still
  loses an unsaved draft except for the existing `beforeunload` warning. Server-side drafts are a
  separate feature with their own storage and conflict rules.
- No new npm dependency. Base UI dialog/checkbox primitives and native `File`/`Blob` cover the new
  surfaces; a `cmdk` or `papaparse` dependency would duplicate code already present or add a second
  CSV grammar.
- Two editors importing or bulk-editing concurrently get per-record conflicts, not a merge. The
  space write mutex serializes the writes; the later stale `rev` is refused and surfaced.
