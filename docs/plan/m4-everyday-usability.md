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
- **Generic CSV export and import for any type**: export every live record of a type, and import
  new records into an existing type with a preview, row/column errors and no partial validation.
- **Responsive and touch polish** across the new surfaces and the existing table and rail.

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

Success is: a new user lands on a space home that explains types and offers a first action; a
returning user presses `Cmd+K`, types three letters, opens a record, presses `c`, captures a chore
with its required room, and is looking at the new record; the owner selects five plants, sets
`room`, duplicates two, trashes one and undoes it from the toast; and the owner exports Plant as CSV,
imports it into a second empty Plant type, and gets the same titles, values, bodies and schedule
keys back, with a deliberately broken row refused by row and column before anything is written.

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
seconds, the provider's current default) is the visible undo window; the Trash page remains the
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
  palette is open and the query is non-empty, `staleTime: 60_000`. The explicit empty filter and
  sort mean every record is eligible and the newest 100 are returned regardless of the type's
  saved view. Returns flattened `{ id, type, title, updated_at }` rows.
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

### 7.2 Pure helpers

New modules, all tested without React:

- `web/src/lib/search.ts`
  - `score(query, text): number | null` — case-insensitive subsequence match; higher for a prefix,
    a word-boundary start and contiguous runs; `null` when the query is not a subsequence.
  - `rank<T>(query, items, text): T[]` — stable sort by score; empty query returns input order.
- `web/src/lib/hotkeys.ts`
  - `isEditableTarget(target: EventTarget | null): boolean` — input, textarea, select,
    contenteditable.
  - `useGlobalHotkeys(bindings)` — one `keydown` listener while mounted, ignores editable targets
    unless a binding says `allowInInput` (Escape), respects `metaKey`/`ctrlKey` per platform, and
    returns a platform label (`⌘K` or `Ctrl K`).
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
main and footer:

- Header, left to right: wordmark; on space routes a ghost **Capture** button (plus icon);
  a **Search / command** button showing the platform shortcut label; the account email (as today)
  and Sign out. Capture is ghost so the page's own primary action (for example the type page's
  **New record**) remains the one accent per view. Below `sm`, the actions become 44px icon buttons
  with `aria-label`; the email stays hidden. The type page keeps its existing inline **New record**
  button; Capture is the global, minimal form and never replaces inline row entry.
- On routes without a space (`/`), the palette still opens over spaces and global actions; the
  Capture button is hidden, and the palette's Quick capture action explains "Open a space to
  capture a record." Space-scoped actions (Schedule, Types, Members, Trash, Settings) are omitted
  when no space is in the path. Sign out remains.
- Derive the current space id from the path by matching both `/s/:spaceId` and `/s/:spaceId/*`
  (AppShell is a layout route and cannot read child params with `useParams`; matching the bare
  space route too keeps the space home covered).
- Register the global hotkeys: `Mod+K` palette, `c` quick capture, `?` shortcut sheet. Plain keys
  (`c`, `?`, `j`, `k`, `x`, `/`) are ignored while an editable element has focus; `Mod+K` and
  Escape are allowed there, so the palette opens from any field and closes the active overlay. While
  any overlay is open, the other global bindings are suspended; `Mod+K` toggles the palette and
  Escape closes whichever overlay is open.
- Render `ShortcutSheet` (Base UI Dialog) listing the global and table shortcuts in one keyed list:
  `⌘K / Ctrl K`, `c`, `?`, `/`, `j`/`k`, `x`, `Enter`, `Esc`, `⌘S`.

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
  - **Records** — `usePaletteRecords`; selecting goes to `/s/<id>/o/<objectId>`. Only shown when
    the query is non-empty.
  - **Recent** — from `readRecent`; shown only when the query is empty.
- Empty query: Actions, Recent, Types, Spaces. Non-empty: rank each section with `score`, cap
  Actions 5, Records 12, Types 5, Spaces 5. Flatten in that order for arrow navigation.
- Keys: ArrowDown/ArrowUp wrap, Home/End jump, Enter runs the active item, Escape closes. Hover sets
  the active item. `aria-live="polite"` reports the result count. A query with no matches shows
  "No matches. Try a type, a record title, or an action." rather than an empty sheet.
- On close, focus returns to the trigger. Selecting an item closes before navigating.
- A record result shows its title, mono type key and relative `updated_at`; a type result shows its
  name and mono key; a space result shows its name and role.

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
  - **Create** toasts "Record created", keeps the dialog open, resets the title and required values,
    keeps the type, and refocuses the title.
  - **Create and open** closes and navigates to `/s/<space>/o/<id>`.
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
- `SpaceNav` gains an **Overview** link to `/s/<id>` and its `selected` prop becomes
  `"overview" | "schedule" | undefined`.

### 7.6 Table paging, selection, bulk actions and row actions

`TypeTable` and `components/views/table-view.tsx`:

- **Paging.** Add `?page=` (1-based, default 1) to the **table** view. The table sends `limit:
  PAGE_SIZE` and `offset: (page - 1) * PAGE_SIZE`; clamp a stale page after a fetch whose `total`
  shrank. Page changes clear selection. Any view, filter, sorts or `q` change deletes `page` (and
  selection); switching away from the table deletes `page`. Footer under the table: `1–50 of 120`
  in mono, Prev/Next ghost buttons, disabled at the ends. At 375px the footer stays one row.
  Board, gallery and calendar are not paged: they request `limit: 500` (the server maximum) so the
  layout sees as much of the type as one response carries. If their `total > 500`, a mono footer
  says the view is truncated and to use the table.
- **Selection.** `TableView` gains a leading checkbox column, 44px wide, not part of the saved
  `columns` or `widths`. The header checkbox selects every loaded row (the page) and shows an
  indeterminate state for a partial page; row checkboxes are native inputs in 44px labels. Selected
  rows get a `bg-raised` fill — no colored side stripe. Keep the row's own links and cells working.
  Selection is available to editors only. A selected id that disappears from the loaded page (a
  live delete) is pruned; ids are never sent for rows the page no longer shows.
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
- **Keyboard.** When focus is inside the table and not in an editable cell: `j`/`k` move an active
  row (starting at the first row, scrolled into view, marked by a 1px `line-strong` inset outline),
  `x` toggles its checkbox, `Enter` opens it, `Escape` clears the active row and selection. `/`
  focuses the search box. The active row is visual only; selection remains the checkbox state
  (`bg-raised`), so the two never look the same.
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
  - On file selection, refuse a file over 5 MiB client-side with the same sentence the server would
    use, then POST a dry run and show: "N rows ready" when every row is valid, otherwise
    "N valid rows; M problems". Include a compact preview of the first 5 valid rows (title plus
    non-empty values as mono `key: value`) and the problem list (first 20) as
    `row 7 · room — unknown option attic` in ember text. A file-level problem uses `file` instead
    of a row number.
  - **Import N records** is enabled only when `valid` and N > 0. It commits, toasts "Imported N
    records", invalidates the space, closes the panel and clears selection. Success does not
    navigate; the current view updates through invalidation.
  - A partial I/O failure invalidates the space prefix (so the records that landed appear), shows
    the server's message and the count already written, and leaves the panel open so the file can be
    corrected and retried.
  - No drag-and-drop upload target. The file input is the whole control.

### 7.8 Responsive and touch

- Header: the new actions are icon buttons below `sm`; Sign out also becomes a labeled icon button
  so the wordmark, Capture, palette and Sign out fit without overflow.
- Palette and capture: full-width bottom sheets below `sm`, 16px inputs, 44px rows, focus trap,
  Escape, and focus restored to the trigger.
- Space nav: Overview first; every link and the space select keep 44px targets on coarse pointers;
  the type list remains a vertical rail on desktop and a compact stacked block on mobile.
- Table: keep horizontal scrolling with the sticky header and action column. Checkboxes, row
  actions and the bulk bar are 44px on coarse pointers. Do not add a card renderer in M4.
- Toasts: action buttons are 44px on coarse pointers and remain keyboard reachable.
- Verify at 375×667, 768×1024 and 1280×800; no horizontal page overflow, no clipped dialogs, no
  hover-only control that is needed on touch.

### 7.9 Visual direction

Stay inside the Nocturnal Field Guide: dark first, hairline rules, mono keys and counts, one lichen
accent for selection/focus/primary action. The palette is a ruled sheet with a mono section label
and a single active row marked by a lichen key, not a filled highlight; the capture sheet is a form,
not a wizard; the bulk bar is a hairline band; row actions are line icons at one weight. Colour never
carries state alone: `SCHEDULED`, `DEFAULT`, `N selected`, error rows and result counts are text.

## 8. Build order

Each numbered item is one checkpoint and one turn. Stop and report after each, per the ROADMAP
protocol. Do not run two in one turn.

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
   `lib/hotkeys.ts`, `lib/recent.ts`, `lib/paging.ts` with tests; add `usePaletteRecords` and the
   AppShell header actions, `CommandPalette` and `ShortcutSheet`. No capture yet: the palette's
   Quick capture action may be hidden behind a disabled state until checkpoint 5, or wired to a
   placeholder that opens nothing; prefer hiding it until its action exists. Verify: web gate plus
   a browser pass on `Mod+K`, arrows, Enter, Escape, `?`, and one record/type/space navigation.
5. **Quick capture.** Add the provider/dialog, type picker, required-property fields, last-type
   storage, Create and Create-and-open, the header button, the `c` shortcut and the palette action.
   Verify: web gate plus a browser pass for each button, required-field refusal, rapid double
   create, create-and-open, viewer absence, and a space with no types.
6. **Space home, recent items and onboarding.** Rewrite `pages/space.tsx` as the home, add the
   Overview nav link, read/record recent items, add the type rows and the onboarding copy, and add
   the type-page empty-state create button. Verify: web gate plus a browser pass that opens three
   records, reloads, sees them on the home, checks another browser profile is empty, and checks a
   new space's onboarding.
7. **Table paging, selection, bulk actions and row actions.** Add `?page=`, the checkbox column,
   the bulk bar and its property editor, the fan-out hooks, row Duplicate/Trash, undo toasts and
   the table hotkeys. Verify: web gate plus a browser pass with a type of 60+ records: page 2,
   select across the page, set and clear a property, duplicate, trash, undo, partial-failure copy,
   and viewer absence.
8. **CSV data panel.** Add the Data button/panel, export download, template download, import file +
   dry-run preview, problem list, commit, success/failure handling, and viewer export-only. Verify:
   web gate plus a browser pass: export Plant, download its template, import the export into a
   second empty Plant type, inspect the created files, break one row and see no writes, and check
   the 5 MiB/10k limits through the API.
9. **Responsive, docs and end-to-end.** Do the responsive/touch pass in §7.8, bump the workspace and
   web package to `0.4.0`, update `docs/ROADMAP.md` (M4 landed, checkpoints, plan link, version),
   `AGENTS.md` (current state, new invariants, critical files), `README.md` (features and CSV
   command examples), `DESIGN.md` and `.impeccable/design.json` (palette, capture, bulk bar, row
   actions, mobile sheets). Run the full verification in §10. Report the final CSV bytes and the
   final space-home behavior.

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
- `web/src/api/queries.ts` — palette record queries, duplicate, four bulk fan-out hooks, import and
  export. Every write invalidates the space prefix as today.
- `web/src/lib/search.ts`, `hotkeys.ts`, `recent.ts`, `paging.ts` — pure, tested; the only place
  matching, keyboard guards, local recents and page math live.
- `web/src/components/app-shell.tsx` — the only mount point for the two overlays and global hotkeys;
  derive the space id with `useMatch`, not `useParams`.
- `web/src/components/command-palette.tsx` — accessible combobox/listbox, bounded record lookup;
  do not add `cmdk`.
- `web/src/components/quick-capture.tsx` — required properties only; reuses `PropertyInput`; no
  second value editor.
- `web/src/pages/space.tsx` — the real home; recent items and onboarding; no first-type redirect.
- `web/src/components/type-table.tsx` / `components/views/table-view.tsx` — paging, selection, bulk
  bar and row actions; keep one `useObjects` result and the four renderers untouched otherwise.
- `web/src/components/views/data-panel.tsx` — new; export and import UI; one file at a time.
- `DESIGN.md` — normative for the new palette, capture sheet, bulk bar and touch rules.

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
- Type page Data panel: export downloads and opens as a spreadsheet; import previews a valid file,
  refuses a broken one by row/column with no writes, then commits a valid one and shows it live.
  A viewer can export and cannot import.
- 375px: header actions, palette, capture, nav, table scroll, bulk bar and toasts are usable; no
  page-level horizontal overflow; inputs are 16px and targets are 44px.
- Two windows: duplicate, import, trash/undo and bulk edit propagate through the existing space
  events without a manual refresh.

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
- The undo window is the toast's six-second life; the Trash page is the durable recovery surface.
  There is no background purge or grace period change.
- Duplicate copies schedule values without re-phasing. A duplicated recurring chore is due when the
  original is due; Complete is the action that advances it.
- No format bump means a v0.3 binary can read M4 data. The only new state is browser-local recents
  and new CSV/duplicate routes, none of which an older reader needs.
- No new npm dependency. Base UI dialog/checkbox primitives and native `File`/`Blob` cover the new
  surfaces; a `cmdk` or `papaparse` dependency would duplicate code already present or add a second
  CSV grammar.
- Two editors importing or bulk-editing concurrently get per-record conflicts, not a merge. The
  space write mutex serializes the writes; the later stale `rev` is refused and surfaced.
