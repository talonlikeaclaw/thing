# Milestone 3 — views

Everything below is the M3 execution spec. Implement top-to-bottom, one checkpoint per turn, under
the delivery protocol in [`docs/ROADMAP.md`](../ROADMAP.md). Read `docs/ROADMAP.md` first, then this
file; M1 is deployed as `v0.1.0` and M2 is landed as workspace `0.2.0`. Nothing here re-opens a
locked decision.

## 1. Scope

M3 turns a type's single table configuration into **named saved views**. A view is still part of
the type definition on disk, not a new object kind and not a directory of its own.

In scope:

- Every type carries an ordered list of views and names one default.
- Four kinds: `table`, `board`, `gallery`, `calendar`.
- Per-view `filter`, `sorts`, `columns`, and table `widths`; board `group_by`, gallery `cover`, and
  calendar `date_property`.
- View keys are stable slugs, derived from the view's name once, exactly like type and property
  keys.
- Create, rename, reconfigure, delete, and choose-default actions, in the SPA and over the API.
- A view switcher on the type page, and the selected view in the URL
  (`/s/:spaceId/t/:typeKey?view=<view-key>`).
- The board groups by a select property, the gallery uses a property label as its cover, and the
  calendar lays records out by a date property — including M2's `due_date`.
- Layout writes (column visibility, order and width) persist immediately for editors; filter and
  sort edits stay in the URL until **Save view** persists them.

Out of scope, deliberately: cross-type views, per-user (private) views, view objects, drag-and-drop
between board lanes, creating a record directly into a lane or on a calendar day, week/day calendar
modes, recurrence projection into future dates, image covers and file properties (M6), formulas and
rollups (M9), and public share links. A view is shared with the space because it lives in the type
file; there is no second ownership model.

Success is a Plant type whose file holds four named views, whose default table view keeps its
columns and widths across a restart, whose board groups records by `room`, whose gallery shows a
property label as its cover, and whose calendar shows records on their `due_date` — with the type
`.yml` proving every view and the API returning the selected view's projected values.

## 2. Starting state

What M3 builds on, so a new session does not re-derive it:

- `thing-core`: `model` (`TypeDef`, `ViewDef`, `Filter`, `Sort`, `Value`), `markdown` over
  `FORMAT_VERSION = 2`, `store` (`SpaceStore` + `FsSpaceStore`, `rename_property_in_type`,
  `remove_property_from_type`), `validate` (`validate_filter`, `validate_sorts`), `filter`,
  `query::apply(&ViewDef, ...)`, `index` (`SpaceIndex`, `Problems`), `schedule`.
- `thing-server`: `routes/types.rs` owns the type file, its single `view`, schedule enable/disable
  and `check_view`; `routes/objects.rs` resolves the type's saved view for `GET /objects` and
  returns only `view.columns` in row `values`; `routes/values.rs` owns `Projection`,
  `value_columns` and `summary_json`.
- `web/`: `TypeDef.view`, `lib/filter.ts`'s `effectiveView`, the table in
  `components/type-table.tsx`, the filter and sort bars, and the schema type editor that edits
  `view.columns`.
- M2's schedule keys, Complete and agenda are landed and untouched except where a view names
  `due_date`.

Anchors that M3 changes: `crates/core/src/{model,markdown,query,validate,index}.rs`,
`crates/core/src/store/{mod,fs}.rs`, `crates/server/src/routes/{types,objects,values,properties,spaces}.rs`,
`crates/server/src/routes/mod.rs`, `web/src/api/{types,queries}.ts`, `web/src/lib/{filter,timezone}.ts`,
`web/src/components/{type-table,space-nav}.tsx`, `web/src/components/schema/type-editor.tsx`,
`web/src/pages/type-table.tsx`, `scripts/seed.sh`.

## 3. Dependency and format version

No new Rust or npm dependency. Views are data; layout, grouping and the calendar grid are plain
TypeScript and React. `Intl` remains the only timezone source in the SPA.

`FORMAT_VERSION` becomes **3**. This is one format for every file kind, as in M1 and M2:

- `check_schema` accepts `1..=3`; `MIN_FORMAT_VERSION = 1` stays a named constant.
- The writer emits `schema: 3` for every file it rewrites.
- A schema-1 or schema-2 type is read through a legacy shape and normalized in memory to the
  schema-3 shape. Its next write upgrades it. There is no migration pass.
- Older binaries refuse schema 3 loudly. That is the existing policy and the desired failure mode.
- Schema-1 and schema-2 fixtures stay as the backwards-compatibility tests. New fixtures are
  schema 3.

Only the type shape changes. Objects, properties, space metadata and history lines keep their
schema-2 fields; bumping the number for all of them is what keeps one version, one gate.

## 4. On-disk format

### 4.1 Type files

`types/<key>.yml` replaces the single `view` mapping with an ordered `views` list and a
`default_view` key. Field order is stable:

```yaml
schema: 3
key: chore
name: Chore
name_plural: Chores
icon: "🧹"
description: ""
schedule: true
properties:
  - key: room
    required: false
    featured: true
views:
  - key: all
    name: All
    kind: table
    filter:
      op: and
      conditions: []
    sorts:
      - property: updated_at
        direction: desc
    columns: [title, due_date, room]
    widths:
      due_date: 160
      title: 280
  - key: by_room
    name: By room
    kind: board
    filter:
      op: and
      conditions: []
    sorts: []
    columns: [title, due_date]
    group_by: room
  - key: gallery
    name: Gallery
    kind: gallery
    filter:
      op: and
      conditions: []
    sorts:
      - property: updated_at
        direction: desc
    columns: [title, room]
    cover: room
  - key: calendar
    name: Calendar
    kind: calendar
    filter:
      op: and
      conditions: []
    sorts: []
    columns: []
    date_property: due_date
default_view: all
```

`TypeDef` fields:

```rust
pub struct TypeDef {
    // unchanged fields first
    pub properties: Vec<TypeProperty>,
    pub views: Vec<ViewDef>,
    pub default_view: String,
}

pub struct ViewDef {
    pub key: String,
    pub name: String,
    pub kind: ViewKind,
    pub filter: Filter,
    pub sorts: Vec<Sort>,
    /// `title` first, then property keys. Empty only for `calendar`.
    pub columns: Vec<String>,
    /// Table widths in CSS pixels; absent means the renderer's default.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub widths: BTreeMap<String, u16>,
    /// `board` only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group_by: Option<String>,
    /// `gallery` only; absent means a typographic cover.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cover: Option<String>,
    /// `calendar` only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub date_property: Option<String>,
}

#[serde(rename_all = "snake_case")]
pub enum ViewKind { Table, Board, Gallery, Calendar }
```

`columns` is always written, including `columns: []` for calendar views, so every view has one
shape. `widths` is a `BTreeMap`, so keys serialize in byte order; the fixture above is in that
order. `title` may have a width but never moves out of first position.

`TypeDef` helpers, used by routes and validation:

```rust
impl TypeDef {
    /// The view with this key, if the type defines one.
    pub fn view(&self, key: &str) -> Option<&ViewDef>;
    /// The view `default_view` names; `None` only for an in-memory def that
    /// has not been through parsing or validation.
    pub fn default_view(&self) -> Option<&ViewDef>;
}
```

### 4.2 View identity and names

- A view **key** is minted from its name with `slug::key_from_name` at creation and never changes.
  It matches the existing key grammar `^[a-z][a-z0-9_]{0,39}$`.
- Keys are unique within the type. Creating a view whose derived key is taken returns
  `409 conflict`, not a numbered alias. Rename the existing view or choose another name.
- Display **names** are 1–80 characters, unique within the type case-insensitively, and editable.
- The view kind is chosen at creation and is immutable. Changing how the same records are shown is
  a new view, not a mode on an existing one.
- A type always has between **1 and 50** views. Deleting the last view is refused.
- `default_view` names exactly one key. Deleting the default view promotes the view that followed
  it in file order, else the first remaining one, in the same write.
- The API refers to a view by its key. The SPA puts that key in the URL. No display-name lookup.

### 4.3 The four kinds

| kind | required fields | optional fields | `columns` meaning |
|---|---|---|---|
| `table` | `columns` starts with `title` | `widths` | visible columns, in order |
| `board` | `group_by` (a `select` property), `columns` starts with `title` | — | fields on each card, after the title |
| `gallery` | `columns` starts with `title` | `cover` (any property) | fields on each card, after the title |
| `calendar` | `date_property` (a `date` property) | — | must be empty |

Rules for every kind:

- `filter` and `sorts` use the existing grammars and validators. Sorts order rows in a table, cards
  within a board lane, cards in the gallery, and chips within a calendar day.
- `columns` names `title` plus property members of the type (declared, plus the generated schedule
  keys while scheduled). No duplicates.
- `widths` exists only on `table`; every key must be a column; every value is `80..=800`.
- `group_by` exists only on `board`; it must name a member whose format is `select`.
- `cover` exists only on `gallery`; it must name a property member, not `title`. A missing value on
  a record falls back to a typographic tile.
- `date_property` exists only on `calendar`; it must name a member whose format is `date`
  (not `datetime`, so no timezone conversion is needed in the grid).
- Irrelevant optional fields are **absent**, not ignored. A table view with `group_by` set is a
  validation error, so the file has one spelling per kind.

The flat struct rather than four nested configs keeps the file and the API readable, and the
validator is the single place that enforces which fields belong to which kind.

### 4.4 Legacy conversion (schema 1 and 2)

A type file with `schema: 1` or `schema: 2` has the old shape:

```yaml
view:
  sorts: ...
  filter: ...
  columns: [title, room]
```

`parse_type` reads that shape and normalizes it to:

```yaml
views:
  - key: all
    name: All
    kind: table
    filter: <same>
    sorts: <same>
    columns: <same>
default_view: all
```

- The key and name are fixed (`all`, `All`); nothing else is invented.
- No widths are added.
- The legacy and new shapes are mutually exclusive: a file that carries both, or a schema-3 file
  that carries `view`, is refused as malformed rather than merged.
- All writes emit the schema-3 shape. Copying a schema-2 type file into a live space still works;
  its next type write upgrades it.

### 4.5 Structural versus semantic checks

`parse_type` enforces what can be checked without the rest of the space:

- the file has at least one view and at most 50;
- every view key is unique and matches the key grammar;
- every view name is non-empty and unique case-insensitively;
- `default_view` names one of the views.

Failing any of these makes the type file unparseable, so `SpaceIndex` reports it and leaves it out —
the same policy as any other broken file. Cross-file meaning (columns are members, `group_by` is a
select, `date_property` is a date, widths are in range, filters and sorts are valid) needs the
space schema, so it is checked on every write and reported by `/health` when a hand edit breaks it.
A type with semantic view problems still loads; the unaffected views keep working.

## 5. Core changes

### 5.1 `model.rs`

- Add `ViewKind`, the extended `ViewDef`, `TypeDef.views`, `TypeDef.default_view`, and the two
  helpers from §4.1.
- Keep `has_property` unchanged: a view may name a declared member or a generated schedule key
  while scheduling is on.
- Update every `TypeDef` and `ViewDef` literal in the workspace and tests; the compiler is the
  checklist. The existing `view` field disappears.

### 5.2 `markdown.rs`

- `parse_type` becomes version-aware: read `schema` first, deserialize either the schema-3 type
  document or the legacy one, and normalize the legacy `view` to `views`/`default_view`.
- `serialize_type` always writes the schema-3 shape.
- Keep `write_document` emitting `FORMAT_VERSION` for every file kind.
- Fixtures:
  - rename the M1/M2 current files to explicit legacy names: `object_scheduled.md` →
    `object_scheduled_v2.md`, `space_balcony.yml` → `space_balcony_v2.yml`,
    `property_recurrence.yml` → `property_recurrence_v2.yml`, `type_chore.yml` →
    `type_chore_v2.yml`;
  - add schema-3 `object_scheduled.md`, `space_balcony.yml`, `property_recurrence.yml` and
    `type_views.yml` (one type carrying table, board, gallery and calendar views);
  - keep `type_plant.yml` at schema 1 and the four schema-1 object fixtures;
  - round-trip byte-for-byte only the schema-3 fixtures; parse schema 1 and 2 fixtures and assert
    the first write emits schema 3 and the meaning survives;
  - assert the schema-2 `type_chore_v2.yml` normalizes to one `all` table view with the same
    filter, sorts and columns.

### 5.3 `validate.rs`

Add one public entry point and keep the existing filters and sorts validators:

```rust
/// Every problem with every view of a type: keys, names, the default, the
/// per-kind fields, and the filter/sorts/columns those views name.
pub fn validate_views(schema: &Schema, def: &TypeDef) -> Vec<CoreError>;
```

It returns `CoreError::ValidationFailed` with a field path the client can point at:
`views.<key>.columns`, `views.<key>.widths.order`, and so on. The rules are §4.2–§4.3. The server's
current `check_view` is deleted; type and view routes call this function.

Add a helper used by the routes that must refuse a destructive schema edit:

```rust
/// Views that structurally depend on `property` (`group_by` or `date_property`).
pub fn dependent_views(def: &TypeDef, property: &str) -> Vec<&ViewDef>;
```

`cover` is optional, so it is cleared rather than treated as a dependency.

### 5.4 `query.rs`

`query::apply` currently takes a whole `ViewDef` but reads only `filter` and `sorts`. Change it to
the two things it uses:

```rust
pub fn apply(
    filter: &Filter,
    sorts: &[Sort],
    summaries: &[ObjectSummary],
    schema: &Schema,
) -> Vec<ObjectSummary>;
```

Update call sites and tests. This keeps the query engine independent of the named-view envelope and
avoids constructing fake views in the server.

### 5.5 `index.rs`

- `Problems` gains:

  ```rust
  pub struct ViewProblem {
      pub type_key: String,
      pub view_key: String,
      pub field: String,
      pub message: String,
  }

  pub view_problems: Vec<ViewProblem>,
  ```

  `problems()` runs `validate_views` for every type and maps each error into a `ViewProblem`. This
  is how a hand-edited view is surfaced without taking the type offline.
- No other index behavior changes: view defaults and the query order stay server-side concerns.
- `problems_json` in `crates/server/src/routes/mod.rs` serializes the new array; `/health` carries
  it.

### 5.6 Store helpers

`crates/core/src/store/mod.rs`:

- `rename_property_in_type` walks **every** view and rewrites the key in `columns`, `widths` map
  keys, `sorts`, `filter.conditions`, `group_by`, `cover`, and `date_property`. It returns whether
  anything changed, as today.
- `remove_property_from_type` strips the key from every view's `columns`, `widths`, `sorts` and
  `filter.conditions`; clears `cover`; and defensively clears `group_by`/`date_property` if they
  name it. Routes guard the structural cases first (§6.4), so this fallback only protects a direct
  store call.
- The store-level `rename_property_key`/`remove_property_key` behavior is otherwise unchanged,
  including the per-object revisions.

## 6. Server changes

### 6.1 Type detail and creation

`TypeDetail` replaces `view` with:

```json
{
  "...": "existing fields",
  "properties": [],
  "views": [/* §4.1 shape */],
  "default_view": "all"
}
```

- `POST /types` always creates one view: key `all`, name `All`, kind `table`, filter empty, sort
  `updated_at desc`, columns `[title]`, no widths, and `default_view: all`. A scheduled type adds
  `due_date` through `set_schedule` as it does today, to this default view.
- `PATCH /types/{key}` no longer accepts `view`. A request carrying it is refused by
  `deny_unknown_fields`, which is the honest break: views now have their own routes.
- `PatchTypeRequest` keeps `properties`, and removing a member follows §6.4.
- `TypeSummary` is unchanged. View count is not added; the detail carries the list.

### 6.2 View routes

New module `crates/server/src/routes/views.rs`, registered next to the type routes. Every handler
requires `[editor]`, takes the space write mutex, reads the current type from the index, mutates
it, validates the whole type, writes `types/<key>.yml` through the store's fingerprint guard,
reloads the index, and broadcasts `type.updated` with `{"key": "<type>", "view": "<view>"}`.

```
POST   /api/spaces/{space}/types/{type}/views
PATCH  /api/spaces/{space}/types/{type}/views/{view}
DELETE /api/spaces/{space}/types/{type}/views/{view}
POST   /api/spaces/{space}/types/{type}/views/{view}/default
```

All four return the updated `TypeDetail` (create also `201`) so the client never has to refetch to
learn a minted key or a promoted default.

`POST` body:

```json
{
  "name": "By room",
  "kind": "board",
  "group_by": "room",
  "columns": ["title", "due_date"],
  "sorts": [],
  "filter": { "op": "and", "conditions": [] }
}
```

- `name` and `kind` are required. `group_by`/`date_property`/`cover` are accepted only for their
  kind.
- Omitted `filter`, `sorts`, `columns` and `widths` copy the type's current default view; a newly
  created view therefore starts from what the user was looking at rather than from an empty table.
  For `table`, `board` and `gallery`, if the copied columns are empty or do not start with `title`,
  use `[title]` instead, so a view created from a calendar default is valid. A calendar's `columns`
  default to empty, and widths are copied only for a table.
- A calendar must still be given `date_property`; a board must still be given `group_by`.
- The key is derived from the name; a collision is `409` naming the existing view. `kind` is not
  editable later.

`PATCH` body is the mutable subset: `name`, `filter`, `sorts`, `columns`, `widths`, `group_by`,
`cover` (with `null` clearing it), `date_property`. Omitted fields are left alone; collection fields
are replaced whole. `kind` and `key` are not accepted.

`DELETE`:

- refuses the last view with `409` and `{"reason":"a type needs at least one view"}`;
- promotes the next view in file order when the deleted one was the default, else the first;
- returns the updated type detail.

`POST .../default` sets `default_view` to the named view and is idempotent.

### 6.3 Object list: select the view and project its values

```
GET /api/spaces/{space}/objects?type=<key>&view=<view-key>
    &filter=<json>&sorts=<json>&q=<text>&limit=50&offset=0
```

- `view` is optional and defaults to `def.default_view`. An unknown key is `422 validation_failed`
  on `view`; the default is guaranteed to exist by parsing.
- `filter` and `sorts` remain optional previews over the chosen view, as today. They do not alter
  the view on disk.
- The response gains `"view": "<view-key>"`.
- Row `values` are projected from the selected view, not from a table-only column list:
  `columns`, then `group_by`, `cover` and `date_property`, minus `title`, deduplicated. This is what
  lets a board lane, a gallery cover and a calendar chip read their own field without a second
  request. A calendar view therefore returns `date_property` values even though its `columns` is
  empty.
- `Projection::summary_json` takes the resolved `ViewDef` as an argument; `value_columns` moves from
  `def.view` to that view. Everything else about labels, schedules and missing relations is
  unchanged.
- The relation picker continues to call the list with an empty filter and no `view`; it only reads
  `id`, `title` and `type`, so a calendar default cannot break it.

### 6.4 Type, property and schedule interactions

A view may name a property; removing that property must not leave a dangling reference or silently
delete a saved view.

- **Type patch removing a member.** Before stripping references, call
  `validate::dependent_views`. If a board's `group_by` or a calendar's `date_property` names the
  member, return `422 validation_failed` on `views.<view>.group_by` / `.date_property` with a
  message naming the member and telling the user to change the view first. Otherwise strip the key
  from columns, widths, sorts, filters and cover with `remove_property_from_type`, then validate the
  whole type.
- **Property deletion** (`DELETE /properties/{key}?force=true`). The same dependency check runs
  first and returns `409 conflict` with
  `{"reason":"views use property","views":[{"type":"chore","view":"by_room","field":"group_by"}]}`.
  After that check the existing forced removal proceeds; ordinary column/sort/filter references are
  stripped.
- **Rename** needs no guard: `rename_property_in_type` updates every view reference in the same
  write.
- **Enabling scheduling.** Append `due_date` to the default view's columns when the default kind is
  `table`, `board` or `gallery` and the column is absent. Do not add it to every view, and do not
  touch a calendar default.
- **Disabling scheduling.** Extend the existing disable guard: refuse with `409` while any view
  names a schedule key in `group_by` or `date_property`
  (`{"reason":"views use schedule properties","views":[...]}`); otherwise strip the schedule keys
  from columns, widths, sorts, filters and cover in every view before writing. The existing object
  guard is unchanged and still runs first.
- **Type deletion** deletes its views with the file. No separate cleanup.

### 6.5 Events and health

- `type.updated` remains the event; the payload gains the view key for diagnostics. The client
  invalidates the whole space prefix as it already does.
- `/spaces/{space}/health` gains `view_problems` (§5.5). No new endpoint.

## 7. Web changes

### 7.1 API types and hooks

`web/src/api/types.ts`:

- `ViewKind = "table" | "board" | "gallery" | "calendar"`.
- `ViewDef` mirrors §4.1: `key`, `name`, `kind`, `filter`, `sorts`, `columns`,
  `widths?: Record<string, number>`, `group_by?`, `cover?`, `date_property?`.
- `TypeDef` replaces `view` with `views: ViewDef[]` and `default_view: string`.
- `UpdateType` loses `view`.
- `ObjectsQuery` gains `view?: string`; `ObjectList` gains `view: string`.
- `CreateView` is `{name, kind} & Partial<ViewDef>`; `UpdateView` is the mutable subset with
  `cover?: string | null`.

`web/src/api/queries.ts`:

- `useCreateView(spaceId, typeKey)`, `useUpdateView(spaceId, typeKey, viewKey)`,
  `useDeleteView(...)`, `useSetDefaultView(...)`, each posting/patching the routes in §6.2 and
  invalidating the space prefix.
- `objectsPath` adds `view` when present. The query key already includes the whole query object, so
  switching views fetches a different list.
- Keep every other hook; the layout writes reuse `useUpdateView`.

### 7.2 Pure view helpers

New `web/src/lib/views.ts`, tested without React:

```ts
selectedView(type, key?): { view: ViewDef; unknown: boolean }
effectiveQuery(view, params): { filter: Filter; sorts: Sort[] }
queryIsDirty(view, filter, sorts): boolean
defaultWidth(view, key): number
clampWidth(width): number
withWidth(view, key, width): { columns: string[]; widths: Record<string, number> }
withoutColumn(view, key): { columns: string[]; widths: Record<string, number> }
withColumn(view, key, include): { columns: string[]; widths: Record<string, number> }
moveViewColumn(view, key, delta): string[]
groupRows(rows, property, type): BoardLane[]
recordsByDate(rows, property): Map<string, ObjectSummary[]>
monthGrid(year, month): { date: string; inMonth: boolean }[][]  // Monday-first
addMonths(month: string, delta: number): string
monthOf(date: string): string
```

Rules:

- `selectedView` falls back to `type.default_view`; `unknown` is true only when the URL named a key
  that is gone, so the page can replace the URL instead of spinning.
- `effectiveQuery` keeps the M1/M2 URL override semantics: a URL filter/sorts wins; absent means the
  saved view's.
- `withColumn`/`moveViewColumn` keep `title` first and prune widths for removed columns.
- `groupRows` follows the select property's option order, then values whose option was removed (in
  key order, label from the row), then a final `No value` lane only when records lack the value.
- `monthGrid` and `addMonths` build the grid from date strings and `Date.UTC`; no user date is
  parsed through the local timezone, so a `YYYY-MM-DD` never shifts a day.
- `web/src/lib/timezone.ts` gains `todayIn(timeZone, now = new Date()): string`, returning
  `YYYY-MM-DD` through `Intl.DateTimeFormat(..., {timeZone}).formatToParts`, so the calendar's
  "today" follows the space zone like the server's due rules.

`web/src/lib/filter.ts`: `effectiveView` is replaced by `selectedView` + `effectiveQuery`; the
existing condition, sort and URL-param helpers stay. The table's URL still carries `filter` and
`sorts` as JSON.

### 7.3 The type page and view switcher

`pages/type-table.tsx` keeps the same route and passes the type, properties and selected view.

Layout:

- View tabs directly under the type header: one button per view in file order, with its kind icon,
  name, and a mono `DEFAULT` marker on the default. The selected tab is visibly selected and uses
  `aria-pressed`; the tab row scrolls horizontally on narrow screens rather than wrapping into a
  wall.
- `+ New view` sits at the end of the tab row for editors. It opens an **inline** form below the row
  (no modal): a name field, a kind choice, and the kind's required property picker. Board offers
  only `select` properties; calendar offers only `date` properties and preselects `due_date` when
  the type is scheduled and has it; gallery offers an optional cover property (any property). If
  the required format does not exist, the form says which schema change is needed and disables
  Create. Creating switches to the new view.
- On the right of the toolbar: `Save view` (enabled only when the URL filter/sorts differ from the
  saved view), `Reset` (clears the URL overrides), and `View settings` for editors.
- `View settings` is an inline panel: rename, make default (or a `DEFAULT` note), kind shown
  read-only with the sentence "Kind is fixed; create a view to show these records another way",
  and delete with an inline confirm. Deleting the last view is impossible in the UI because the
  server refuses it; show the server's message if it happens.
- Viewers see the tabs and any saved layout, with edit controls absent or disabled. They can still
  filter and sort in the URL; `Save view` is hidden.

URL state:

- `?view=<key>` selects a view. Missing means the type's default. Unknown replaces the URL with the
  default and keeps rendering.
- Switching views clears `filter` and `sorts` overrides and `month`, keeps `q`.
- `q` remains an ephemeral search, never saved in a view.
- `?month=YYYY-MM` exists only for a calendar and defaults to the space's current month.

Layout persistence:

- Column visibility, column order and table widths PATCH the view as soon as the control commits
  (toggle, move button, resize release). A failed write shows the toast and invalidates the type so
  the UI returns to disk truth.
- Filter and sort changes stay in the URL. `Save view` PATCHes them and then removes the URL
  overrides so the saved view is the canonical source.
- Do not persist a half-typed filter condition; Save is explicit.

### 7.4 Renderers

Extract the current table into `web/src/components/views/table-view.tsx`, keeping its header, row
count, `New record`, inline title editing and cell commits unchanged.

- `table`: `<colgroup>` carries the saved widths; the title column defaults to 240px and others to
  140px. A resize handle on each header is a keyboard-focusable separator (`aria-orientation`,
  `aria-label="Resize <name>"`); arrow keys change width by 16px (Shift: 64px), pointer drag
  changes it continuously and commits on release. Widths clamp to `80..=800`. Coarse pointers get
  larger handles but the same widths.
- `board`: horizontal lanes in option order plus `No value`; each lane header shows the option name
  and count. Cards show the title and the view's card columns as mono key + value; no drag between
  lanes and no per-lane create in M3.
- `gallery`: responsive grid (2 / 3 / 4 columns by breakpoint). The cover tile is typographic:
  the cover property's label on a `surface` panel with a hairline, or the type icon when the value
  is empty; no image is invented. Cards show title and card columns. M6 replaces this tile with
  image covers.
- `calendar`: Monday-first month grid with the month name, `Today`, previous/next, and a cell per
  day. Chips are links to objects, ordered by the view's sorts within a day, at most three per cell
  with a `+N more` line. `today` comes from `todayIn(space.timezone)`. The footer names how many
  records in the filtered set have no value for `date_property`.
- All four read the same `useObjects` result and the same row count. Search, filter bar and save
  controls sit in a shared toolbar above the renderer; Sort is hidden for calendar (sorts still
  apply to chips).
- Empty states name the next action: no records in the view, no date property for a calendar, or no
  select property for a board.

### 7.5 Schema editor

`components/schema/type-editor.tsx`:

- Remove the column list and its `view` payload. Views are edited on the type page from now on; the
  editor keeps names, icon, description, schedule, schedule labels and type membership.
- Adding a member no longer edits any view. Removing a member sends the reduced list; the server
  enforces §6.4 and returns the dependency error inline if a view still needs it.
- The schedule toggle no longer manipulates columns in the client; the server's enable/disable
  rules (§6.4) own that. The UI already surfaces the server's `409` inline.
- Add one line near the membership list: "Columns, grouping and calendar layout are per view on the
  type page." with a link to `/s/<space>/t/<type>` (when an editor is looking at a saved type).

### 7.6 Visual direction

Stay inside the M1/M2 world: dark-first, hairline rules, mono keys and counts, one lichen accent for
selection and primary action. View tabs use text and a bottom rule for selection, not filled chips;
the board and gallery are ruled surfaces, not cards with shadows. Option colours come from user
data and remain the only multi-colour element; the calendar's `today` is a hairline and a mono
label, not a filled accent block. Every state that uses colour also reads as text (`DEFAULT`,
`No value`, `+3 more`). At 375px the tab row scrolls, lanes scroll horizontally, the calendar grid
stays legible, and controls keep the 44px coarse-pointer target.

## 8. Build order

Each numbered item is one checkpoint and one turn. Stop and report after each, per the ROADMAP
protocol. Do not run two in one turn.

1. **Format 3 and saved-view model.** Bump `FORMAT_VERSION` to 3 with the `1..=3` reader; add
   `ViewKind`, the extended `ViewDef`, `TypeDef.views`/`default_view` and the two helpers. Teach
   `markdown::parse_type` the legacy `view` shape and make the writer emit schema 3. Rename/add the
   fixtures from §5.2. Update `rename_property_in_type` and `remove_property_from_type` to walk
   views; change `query::apply` to `(filter, sorts, ...)`. Update every struct literal in core,
   server and tests. Verify: `cargo build --workspace && cargo test --workspace`, including
   byte-for-byte schema-3 round trips, schema-1/2 normalization, and rename/remove across all four
   views. Full Rust gate.
2. **View validation and health.** `validate_views` with every §4.2–§4.3 rule, `dependent_views`,
   parse-level key/name/default checks, `Problems.view_problems` and the health JSON. Unit tests:
   duplicate keys; duplicate names case-insensitively; missing default; 51 views; empty columns;
   duplicate columns; a width for a hidden column; width 79 and 801; board without `group_by`; board
   grouping by a text property; gallery cover on `title`; calendar on a `datetime`; calendar with a
   nonempty column list; a valid view of each kind; `dependent_views` for board and calendar; a
   hand-edited invalid view appears in `problems()` while the type still loads. Verify: core tests.
   Full Rust gate.
3. **Server type and view routes.** `TypeDetail` with `views`/`default_view`; create-one-default on
   `POST /types`; remove `view` from type PATCH; add `routes/views.rs` with create, patch, delete and
   default; implement §6.4 for member removal, property deletion, rename, schedule enable/disable
   and type creation; extend the property and schedule tests. Verify with the Rust gate plus a
   curl pass: create a type and see `all` in `types/<key>.yml`; create a board, gallery and
   calendar view and read them back from the file; patch a name and see the key unchanged; create a
   duplicate name → `409`; delete the default and see the next view promoted; delete the last view
   → `409`; remove a member used by a board's `group_by` → `422`; rename that property and see every
   view follow; disable scheduling with a calendar on `due_date` → `409`; delete the calendar, then
   disable successfully.
4. **Server list by view.** Resolve `view` (default and explicit), validate filter/sorts, return
   `view`, and project `columns` + `group_by` + `cover` + `date_property` through `summary_json`.
   Tests: each kind's projection; calendar with empty columns still returns the date value; unknown
   view → `422`; URL filter/sort overrides; relation-picker list with no view still works against a
   calendar default. Verify: Rust gate and curl each kind's `GET /objects?view=...`.
5. **Web data layer and view state.** DTOs, hooks, `lib/views.ts` and `lib/timezone.ts` additions
   with tests, `objectsPath` `view`, type page URL selection, and the schema editor's removal of
   `view`. Update existing `filter.test.ts`/`schema.test.ts` expectations. Verify:
   `npm run test:run && npm run lint && npm run typecheck`; a browser pass that switches views and
   sees a different request (`view=` in the network panel) before the renderers are complete.
6. **Table views.** Extract `table-view.tsx`, add the view tab row, toolbar, `Save view`/`Reset`,
   inline new-view form, view settings, column panel with reorder and widths, and the immediate
   layout PATCHes. Keep inline cell editing, Complete and `New record` behavior. Verify: web gate
   plus browser: create a table view, hide/reorder/resize columns, reload and see the layout, edit a
   filter, save it, reload and see it, switch views and confirm unsaved filters are cleared, and a
   viewer cannot save or resize.
7. **Board, gallery and calendar.** Pure `groupRows`, `recordsByDate` and `monthGrid` helpers with
   tests; the three renderers; kind pickers in the new-view form; empty states. Verify: web gate plus
   browser: group the Garden chores by `room`, check the `No value` lane and unknown-option label;
   set a cover and confirm the typographic tile; navigate months and confirm the due-date chips and
   `today`; change the space timezone and confirm the calendar's today follows it; check 375px.
8. **Seed, docs and end-to-end.** Bump the workspace and `web/package.json` to `0.3.0`. Update
   `scripts/seed.sh` to patch the default view through `/types/{key}/views/all`, add a `By room`
   board and a `Watering` calendar to Plant, and keep the relative due dates. Update
   `docs/ROADMAP.md` (M3 landed, plan link, checkpoints), `AGENTS.md` (current state, view invariants,
   critical files), `README.md` (feature list) and `DESIGN.md` (view switcher, board, gallery,
   calendar rules). Run the full verification in §10, including the container build only if the
   Dockerfile changed (it should not). Report the final type-file bytes.

## 9. Critical files and anchors

- `crates/core/src/model.rs` — `ViewDef`, `ViewKind`, `TypeDef.views`/`default_view` define the
  frontmatter and JSON contract for every view surface. One shape, one spelling.
- `crates/core/src/markdown.rs` — the version gate and the only place a legacy `view` is
  normalized. The writer always produces schema 3.
- `crates/core/src/validate.rs` — `validate_views` is the single authority for what a view may name
  and which fields belong to which kind; routes and `/health` both call it.
- `crates/core/src/store/mod.rs` — property rename/removal must walk every view; missing a
  `group_by` or `date_property` here leaves a saved query pointing at a dead property.
- `crates/server/src/routes/views.rs` — create, patch, delete and default; keys are minted once and
  the last view is protected.
- `crates/server/src/routes/objects.rs` — resolving `view` and projecting its fields is what makes
  board, gallery and calendar possible without per-kind endpoints.
- `crates/server/src/routes/values.rs` — one `Projection` feeds all four renderers; labels and
  schedule state must not diverge by kind.
- `web/src/lib/views.ts` — pure selection, grouping, width and calendar-grid logic; the only place
  the client decides a lane, a cover fallback or a month cell.
- `web/src/components/views/` — the four renderers read the same rows and differ only in layout.
  Do not fork data fetching per kind.
- `web/src/components/schema/type-editor.tsx` — must stop editing `view`; the server owns schedule
  column changes after M3.

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

1. `scripts/seed.sh` completes. The Plant and Chore type files contain `schema: 3`, a `views:` list,
   and `default_view: all`.
2. Plant has four views: `all` (table), `by_room` (board, `group_by: room`), `gallery` (gallery,
   `cover: room`), `watering` (calendar, `date_property: due_date`). The calendar's `columns` is
   empty and every view's key differs from its display name only where the name says so.
3. `GET /objects?type=plant&view=by_room` returns `"view":"by_room"` and each row's `values`
   includes `room` even when `room` is not in the view's `columns`.
4. `GET /objects?type=plant&view=watering` returns `"view":"watering"` and each dated row's `values`
   includes `due_date`.
5. `GET /objects?type=plant&view=nope` → `422 validation_failed`, field `view`. Omitting `view`
   returns the default's key.
6. `POST /types/plant/views` with name `By room` again → `409`; with name `By room 2`,
   `kind: board`, no `group_by` → `422`; with a text property → `422`.
7. `PATCH /types/plant/views/by_room` with a new name leaves the key `by_room`. A `kind` field in
   the body is refused.
8. `DELETE /types/plant/views/all` when `all` is default returns the type with `by_room` promoted
   if it follows, else the first remaining view. Deleting the last view → `409`.
9. `PATCH /types/plant` removing `room` while `by_room` groups by it → `422`; after
   `PATCH .../views/by_room` to group by another select property (or delete the view), the member
   removal succeeds and the key disappears from every view. `DELETE /properties/room?force=true`
   under the same dependency → `409` with `details.views`.
10. `PATCH /types/plant` `schedule: false` with the `watering` calendar still naming `due_date` →
    `409` with the view named. Delete that view, then disable: the three schedule keys disappear
    from every view's columns, widths, sorts and filters.
11. Copy `crates/core/tests/fixtures/type_chore_v2.yml` into the live space as a new type file,
    wait for the watcher, then `GET /types/chore` → one view `all`. `PATCH /types/chore` a name;
    read the file: it is schema 3 with `views`.
12. `GET /spaces/<id>/health` includes `view_problems`. Hand-edit a copy of a type's `group_by` to
    a missing key, wait, and see the problem while the table view still lists.
13. Restart the server: every view, width, default and layout is identical; history and objects are
    untouched.

UI pass (server on 8080, `npm run dev` in `web/`):

- Switch among the four views from the tab row; the URL carries `?view=` and the record count and
  rows update.
- In the table: hide a column, move one, resize one; reload and see the same layout. The list
  request after a layout write returns the new values. A viewer can scroll, filter, sort and open
  records but cannot save or resize.
- Edit a filter and sort in the table, see `Save view` enable, save, clear the URL overrides, and
  reload to the saved query. `Reset` restores the saved query. Switching views discards an unsaved
  filter.
- Board: lanes follow the select options, unknown option values keep a labelled lane, `No value` is
  last, cards show the chosen fields, and opening a card reaches the object.
- Gallery: the chosen cover property's label fills the tile; an empty value falls back to the type
  icon; resizing to 375px shows two columns and no clipped controls.
- Calendar: chips land on `due_date`, the month navigation works, `?month=` survives reload,
  "today" matches the space timezone (change it in settings and reload), and the footer counts
  records with no date.
- Two windows: edit a record in one; the open view in the other updates its row, board card,
  gallery tile or calendar chip without a refresh, through the existing `type.updated`/object
  events.

## 11. Assumptions and contingencies

- Views are shared with the space because they live in the type file. Per-user views would need an
  account-side store, which this milestone deliberately does not add.
- Widths are CSS pixels per view, not per viewport. A narrow screen scrolls the table rather than
  reflowing to different saved widths.
- Column visibility, order and width write immediately; filters and sorts are explicit saves.
  A half-built filter is never written. This is the one place the plan splits "configuration" from
  "query".
- The board has no drag-and-drop and the calendar has no drag-to-reschedule in M3. Both are writes
  to a property from a new surface, not view rendering; they can be added without changing the file
  format.
- The gallery cover is typographic until M6 introduces image/file properties. No placeholder image,
  gradient or generated art is added.
- The calendar shows a record on its current date only. A recurring record's future occurrences are
  not projected; that would be a new query engine, not a renderer.
- The view kind is immutable. This avoids lossy remapping of filters, widths and group fields, and
  creating a view is cheap.
- `q` is search, not view state. It stays in the URL and is not written to the type file.
- A schema-3 file is one-way for a v0.2 binary, as with the M2 bump. Downgrading means restoring the
  data directory from backup.
- Two editors saving the same view are last-write-wins, guarded only by the store fingerprint against
  external file edits. Type files have no revision counter; adding one would be a separate format
  decision, not a hidden part of views.
- The live index keeps a semantically invalid view (for example a hand-edited `group_by`) and
  reports it in `/health`; it does not drop the type or the other views. The selected invalid view
  fails the same way any invalid filter fails, with `422`, and the rest of the type remains usable.
