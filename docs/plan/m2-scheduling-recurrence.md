# Milestone 2 — scheduling and recurrence

Everything below is the M2 execution spec. Implement top-to-bottom, one checkpoint per turn, under
the delivery protocol in [`docs/ROADMAP.md`](../ROADMAP.md). Read `docs/ROADMAP.md` first, then this
file; M1 is landed as `v0.1.0` and nothing here re-opens an M1 decision.

## 1. Scope

M2 makes a type able to track **when a record is due** and **how it repeats**, without adding a
second kind of object and without a background notifier.

In scope:

- A type may declare `schedule: true`. That adds three properties the type does not own in
  `properties/`: `due_date`, `recurrence`, `last_completed_at`.
- A **Complete** action on any scheduled record. It records the completion, advances a recurring
  due date, and leaves an audit revision.
- Due/overdue as **calendar days in the space's IANA timezone**, never elapsed hours.
- In-app reminders only: a due badge on rows, a Schedule page with Overdue / Today / Upcoming
  sections, and an overdue count in the space rail.
- A timezone picker on space creation and space settings, because the calendar-day rule is only
  correct when the space names its zone.

Out of scope, deliberately: email digests, push notifications, background jobs, webhooks,
per-record reminders, reminders at a time of day, timezones per member, recurrence exceptions,
"skip this occurrence", undo/restore of a completion (M10 owns history replay), and calendar views
(M3).

Success is a Chore type whose record is due yesterday, appears under Overdue, survives a server
restart, and advances by its recurrence when completed — with the `.md` file and history line on
disk proving it.

## 2. Starting state

What M2 builds on, so a new session does not re-derive it:

- `thing-core`: `model`, `error`, `slug`, `value`, `markdown`, `store` (`SpaceStore` +
  `FsSpaceStore`), `validate`, `filter`, `query`, `index` (`SpaceIndex`), over `FORMAT_VERSION = 1`.
- `thing-server`: config, CLI, auth/membership, schema and object routes, the single object write
  path, the watcher, per-space broadcast events, and `/api/spaces/{space}/health`.
- `web/`: auth, space list, schema editor, live table with inline edits and URL filters, object
  panel, history, trash, event invalidation.
- `scripts/seed.sh` builds the Garden space; `.github/workflows/ci.yml` runs both gates plus Semgrep.

Anchors that M2 changes: `crates/core/src/model.rs`, `value.rs`, `markdown.rs`, `validate.rs`,
`index.rs`, `crates/server/src/routes/{types,properties,objects,values,spaces}.rs`,
`crates/server/src/events.rs`, `web/src/api/{types,queries}.ts`, `web/src/lib/{format,filter,schema}.ts`,
`web/src/components/{type-table,property-cell,property-input,object-panel,space-nav}.tsx`,
`web/src/components/schema/type-editor.tsx`.

## 3. Dependency and format version

Add to root `Cargo.toml` `[workspace.dependencies]` and to `thing-core` only:

```toml
jiff = { version = "0.2.38", default-features = false, features = ["std", "tzdb-bundle-always"] }
```

`jiff` owns IANA timezone lookup and civil-date arithmetic. It is used through one module,
`crates/core/src/schedule.rs`; `time` remains the timestamp type everywhere else. Convert at the
boundary with `OffsetDateTime::unix_timestamp_nanos()` → `jiff::Timestamp`, never by string
round-tripping. `tzdb-bundle-always` keeps the container correct even if the slim runtime has no
`/usr/share/zoneinfo`.

`FORMAT_VERSION` becomes **2**. This is an honest bump, not a reset:

- `check_schema` accepts `1..=2`; `MIN_FORMAT_VERSION = 1` is a named constant.
- The writer writes `schema: 2` in every file it rewrites. Files are upgraded lazily on their next
  write; there is no migration pass.
- A schema-1 file stays readable forever. A v0.1 binary refuses a schema-2 file loudly rather than
  guessing, which is the existing policy and the desired failure mode.
- Existing fixtures stay at `schema: 1` and become the backwards-compatibility test. New fixtures
  use `schema: 2`.

No other dependency changes. No `package.json` dependency changes; `Intl` supplies the timezone list.

## 4. On-disk format

### 4.1 Type files

`types/<key>.yml` gains one optional field, omitted when false:

```yaml
schema: 2
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
view:
  sorts: []
  filter:
    op: and
    conditions: []
  columns: [title, due_date, room]
```

`TypeDef.schedule: bool` with `#[serde(default, skip_serializing_if = "is_false")]`. The field sits
between `description` and `properties` in the struct so it serializes there.

### 4.2 Implicit properties

The three schedule properties are defined once in core and never written to `properties/`:

| key | name | format | notes |
|---|---|---|---|
| `due_date` | Due | `date` | `YYYY-MM-DD`; a calendar day in the space timezone |
| `recurrence` | Repeats | `recurrence` | structured value below; absent on a one-off |
| `last_completed_at` | Last completed | `datetime` | RFC 3339 UTC, written by Complete (or PATCH) |

Rules:

- `due_date`, `recurrence` and `last_completed_at` are **reserved property keys in every space**.
  A user-defined property may never use one, whether or not any type is scheduled, so enabling
  scheduling later cannot collide. `POST /properties` and key rename reject them with
  `422 validation_failed`.
- A type's `properties` list never names an implicit property. Listing one is a validation error;
  `union` is not a supported spelling.
- A type exposes the three as members only while `schedule: true`. `TypeDef::has_property(key)`
  returns true for a declared member, plus the three implicit keys when scheduled. Every membership
  check in `validate` and the type route uses it instead of scanning `properties`.
- `SpaceIndex` owns a generated `BTreeMap<String, PropertyDef>` of the three definitions.
  `SpaceIndex::property_def` and `Schema::property` resolve declared properties first and the
  generated map second. `GET /properties` keeps returning declared properties only; the type detail
  carries the implicit definitions to the client.
- The generated members are `required: false`, `featured: true`. Complete, not a form rule, is what
  sets `last_completed_at`.
- Enabling scheduling appends `due_date` to `view.columns` when it is absent. Enabling does not add
  `recurrence` or `last_completed_at` to the table; they are visible in the object panel and can be
  added by the user.
- Disabling scheduling is refused with `409 conflict` while any live or trashed object of the type
  has any of the three keys. The detail is
  `{"reason":"scheduled objects exist","objects":<n>}`. Turning scheduling off is not a data-losing
  migration; the user removes the values first.
- Enabling is refused with `422` if a declared property of the space already uses a schedule key
  (possible only in a hand-edited file). `SpaceIndex::problems()` also reports such a conflict and
  an invalid timezone.

### 4.3 Recurrence value

`recurrence` is a mapping, not a string, so a hand-edited file says what it means:

```yaml
recurrence:
  kind: days
  every: 3
```

```yaml
recurrence:
  kind: weekly
  every: 2
  weekday: 1
```

```yaml
recurrence:
  kind: monthly
  every: 1
  day: 31
```

JSON form is the same object. `weekday` is `0`=Sunday through `6`=Saturday. `every` is an integer
`1..=1000` for all three kinds: days between completions, weeks between occurrences, or months
between occurrences. Rules:

- `days`: `weekday` and `day` MUST be absent.
- `weekly`: `weekday` is required, `day` MUST be absent.
- `monthly`: `day` is `1..=31` and required, `weekday` MUST be absent.
- Unknown keys are rejected. A malformed recurrence is a validation failure, never a silently
  ignored value.
- `Recurrence` is a core struct with `kind`, `every`, optional `weekday`, optional `day`, all
  serialized with `serde` and `deny_unknown_fields`.
- `Value` gains `Recurrence(Recurrence)`. This is the only new variant. All exhaustive matches in
  `value.rs`, `validate.rs`, `filter.rs` and the server's `values.rs` must handle it; the compiler
  is the checklist.

Frontmatter example for a complete scheduled record:

```markdown
---
schema: 2
id: 0199f2c1-8f3a-7c2e-9b1d-2a4f6e8c0a1b
type: chore
title: Water the monstera
rev: 4
created_at: 2026-10-17T12:00:00Z
updated_at: 2026-10-21T07:12:00Z
created_by: 0199f2c1-1111-7c2e-9b1d-2a4f6e8c0a1b
updated_by: 0199f2c1-1111-7c2e-9b1d-2a4f6e8c0a1b
properties:
  due_date: 2026-10-24
  recurrence:
    kind: days
    every: 3
  last_completed_at: 2026-10-21T07:12:00Z
---

Watered today, new leaf unfurling.
```

### 4.4 Due rules

All day arithmetic is on `jiff::civil::Date`; no rule adds 24 hours to a timestamp.

- `today` is the civil date of `now` in the space's IANA timezone. A space whose zone cannot be
  resolved behaves as UTC and reports the problem through `/health`.
- `days_until_due = due_date − today`, as whole civil days. Negative is overdue, `0` is due today,
  positive is upcoming.
- Status is derived, never stored:
  - no `due_date`, no `last_completed_at` → `unscheduled`
  - no `due_date`, `last_completed_at` present → `done`
  - `due_date < today` → `overdue`
  - `due_date == today` → `today`
  - `due_date > today` → `upcoming`
- Complete on a record with **no recurrence** removes `due_date` and sets
  `last_completed_at = now`. The old due date remains in the revision snapshot, so nothing is lost
  from history. The record is `done`.
- Complete on a recurring record sets `last_completed_at = now` and advances `due_date`:
  - `base = max(due_date, today)` when a due date exists, otherwise `today`.
  - days: `base + every days`.
  - weekly: the next `weekday` strictly after `base` (`delta = (weekday − base.weekday + 7) % 7`,
    `delta == 0` means 7), then plus `7 × (every − 1)` days.
  - monthly: walk months in increments of `every`, starting from `base`'s month, and take
    `min(day, days_in_month(target))`; return the first candidate strictly after `base`. February
    clamps 31 to 28 or 29; no candidate is ever rolled into the next month.
  - A late completion therefore re-phases from the day it happened; an early completion preserves
    the planned cadence by advancing from the existing due date.
- Completing twice is protected by the required `rev`, like every other write. The second request
  with the old revision gets `409`.
- No scheduler, timer or background task exists. Status is computed on read.

## 5. Core changes

New module `crates/core/src/schedule.rs`; add it to `lib.rs`.

```rust
pub const DUE_DATE_KEY: &str = "due_date";
pub const RECURRENCE_KEY: &str = "recurrence";
pub const LAST_COMPLETED_KEY: &str = "last_completed_at";

pub enum DueStatus { Unscheduled, Done, Overdue, Today, Upcoming }

pub struct ScheduleState {
    pub due_date: Option<jiff::civil::Date>,
    pub status: DueStatus,
    pub days_until_due: Option<i64>,
    pub last_completed_at: Option<OffsetDateTime>,
}

pub fn is_schedule_key(key: &str) -> bool;
pub fn schedule_property_defs() -> BTreeMap<String, PropertyDef>;
pub fn validate_recurrence(recurrence: &Recurrence) -> Result<(), CoreError>;
pub fn resolve_timezone(name: &str) -> Result<TimeZone, CoreError>; // TimeZone::get
pub fn today_in(timezone: &TimeZone, now: OffsetDateTime) -> jiff::civil::Date;
pub fn advance(base: jiff::civil::Date, recurrence: &Recurrence) -> jiff::civil::Date;
pub fn state(def: &TypeDef, doc: &ObjectDoc, timezone: &TimeZone, now: OffsetDateTime) -> Option<ScheduleState>;
pub fn complete(def: &TypeDef, doc: &ObjectDoc, timezone: &TimeZone, now: OffsetDateTime)
    -> Result<ObjectDoc, CoreError>;
```

`state` returns `None` for an unscheduled type. `complete` mutates only `properties` (and returns a
clone); the server owns `rev`, `updated_at`, `updated_by`, the file path and the revision append.
It errors with `ValidationFailed { field: "schedule", .. }` for an unscheduled type.

`value.rs`:

- `parse_value(Recurrence, key, raw)` accepts a YAML mapping and rejects anything else with the
  format's expected-kind message.
- `to_yaml`, `to_json`, `from_json`, `is_empty`, `compare`, `equals` and `expected` handle the new
  variant. `compare` orders by kind (`days < weekly < monthly`), then `every`, then `weekday`, then
  `day`; `equals` compares the struct.
- `recurrence_label(&Recurrence) -> String` produces `Every 3 days`, `Every 2 weeks on Monday`,
  `Every month on day 31`; the API uses it for `label`.

`validate.rs`:

- `variant_matches`: `PropertyFormat::Recurrence` ↔ `Value::Recurrence`.
- `validate_value` calls `schedule::validate_recurrence`.
- `column()` and object membership use `TypeDef::has_property`.
- `value_is_scalar` includes `Value::Recurrence`, so equality filters work. `contains` remains
  text-only and returns false for recurrence.

`filter.rs` needs no new operator; `Row::value` already carries any `Value`. `query.rs` sorts a
recurrence column through `value::compare`.

`index.rs`:

- Own the generated schedule property definitions and use them in `property_def` and `schema()`.
- `Schema` gains `schedule_properties: &BTreeMap<String, PropertyDef>`; update its three test
  constructors.
- `Problems` gains `invalid_timezone: Option<String>` and `schedule_key_conflicts: Vec<String>`.
  `problems()` resolves `meta.timezone` and checks declared property keys against
  `is_schedule_key`.

`model.rs`:

- `TypeDef.schedule` and `TypeDef::has_property`.
- `Recurrence`, `RecurrenceKind`; add the `Value` variant.
- Keep `RESERVED_KEYS` for frontmatter and add a separate property-key reservation check; the
  schedule keys are not frontmatter keys, they are ordinary properties with generated definitions.

## 6. Server changes

### 6.1 Type and property routes

`POST /types` and `PATCH /types/{key}` accept `schedule?: bool`.

- `PATCH` with `schedule: true` sets the flag, appends `due_date` to `view.columns` when missing,
  validates the resulting view and writes the type file.
- `PATCH` with `schedule: false` runs the disable guard (live + trash objects carrying any schedule
  key) before writing and returns the `409` described in §4.2. Once the guard passes, it drops the
  three schedule keys from `view.columns`, `view.sorts` and every filter condition in the same
  write, because a view may not name a property the type no longer has. Do this in the type patch,
  not as a follow-up request.
- `check_members` rejects schedule keys in `properties`.
- `check_view` accepts a schedule key only through `def.has_property`.
- `TypeSummary` gains `schedule: bool`; `property_count` is declared count plus 3 when scheduled.
- `GET /types/{key}`, and every response that returns a type, becomes a new `TypeDetail` shape:
  the existing fields plus `"schedule": bool` and `"implicit_properties": [PropertyDef]` (omitted
  when empty). Create and patch return the same shape so the client never refetches to learn the
  generated keys.
- `POST /properties` and `POST /properties/{key}/rename` reject the three schedule keys.

### 6.2 Schedule state in object responses

`crates/server/src/routes/values.rs`:

- Resolve the space timezone once per request (list, detail, agenda), not once per row.
- `SummaryJson` and `ObjectJson` gain `schedule: Option<ScheduleJson>`:

```json
"schedule": {
  "due_date": "2026-10-20",
  "status": "overdue",
  "days_until_due": -1,
  "completed_at": "2026-10-17T08:00:00Z"
}
```

`due_date` and `completed_at` are omitted when absent; `days_until_due` is omitted for
`unscheduled` and `done`. `status` is one of `unscheduled`, `done`, `overdue`, `today`, `upcoming`.
Only scheduled types get the field.

- `value_json` resolves `recurrence` through the generated definition and labels it with
  `recurrence_label`.
- `ordered_keys` puts the implicit keys after declared members, in `due_date`, `recurrence`,
  `last_completed_at` order, when the doc holds them.

### 6.3 Complete

```
POST /api/spaces/{space}/objects/{object}/complete   {rev}   [editor] -> full object
```

Refactor the existing `update` handler into one private `commit` helper first, with no behavior
change: take the space write mutex, load the object, check `rev`, apply a closure, increment `rev`,
validate, save through the store's fingerprint guard, append the revision, reload the index, and
broadcast. Title changes keep their write-new-then-remove-old path. `update` and `complete` both use
it.

Complete specifics:

- Reject a trashed or missing object with `404`, an unscheduled type with `422`.
- Call `schedule::complete` inside the closure. Complete never accepts a title or body.
- Append `RevisionAction::Complete`, serialized as `"complete"`. The snapshot is the full new
  property map; `body` is absent because Complete never changes it.
- Broadcast `object.completed` with `{"id","type","rev","due_date"}` after the index reload.
- Return the same full object shape as `PATCH`, including the new `schedule`.

`RevisionAction` gains `Complete`; `/history` responses and the web history label handle it.

### 6.4 Agenda

```
GET /api/spaces/{space}/agenda?days=14   [viewer]
```

`days` is `1..=90`, default 14. One pass over live objects of scheduled types:

```json
{
  "today": "2026-10-21",
  "timezone": "Europe/Berlin",
  "overdue": [
    {"id":"<uuid>","type":"chore","type_name":"Chore","type_icon":"🧹",
     "title":"Water the monstera","rev":3,"due_date":"2026-10-20",
     "status":"overdue","days_until_due":-1,"recurrence":"Every 3 days",
     "last_completed_at":"2026-10-17T08:00:00Z"}
  ],
  "today": [],
  "upcoming": [],
  "later_count": 2
}
```

- `overdue` is every due date before today, oldest first.
- `today` is due today.
- `upcoming` is due after today and at most `days` away.
- `later_count` counts records due after the horizon.
- Rows are sorted by `due_date` then `title`; within sections the same order.
- `done` and `unscheduled` records are not in any section and not counted.
- `recurrence` and `last_completed_at` are omitted when absent.
- The timezone is resolved once; an invalid zone falls back to UTC and is reported by `/health`.

### 6.5 Space timezone and health

- `POST /spaces` and `PATCH /spaces/{space}` validate `timezone` with
  `schedule::resolve_timezone` and return `422 validation_failed` naming the field for an unknown
  zone. Trimming and the empty-string-means-UTC rule stay as they are.
- `GET /spaces/{space}/health` adds `invalid_timezone` (null or the string) and
  `schedule_key_conflicts` (array of keys) to `problems`.
- `/api/health` is unchanged.

### 6.6 Events

Add `object.completed` to the event vocabulary in `events.rs` and its docs. Payload carries identity,
type, revision and the new `due_date` only; the client invalidates the whole space prefix as it
already does.

## 7. Web changes

### 7.1 Types and data layer

`web/src/api/types.ts`:

- Add `"recurrence"` to `PropertyFormat`.
- `RecurrenceValue { kind: "days"|"weekly"|"monthly"; every: number; weekday?: number; day?: number }`.
- `ScheduleStatus` and `ScheduleState` from §6.2.
- `TypeDef` gains `schedule: boolean` and `implicit_properties?: PropertyDef[]`.
- `TypeSummary` gains `schedule: boolean`.
- `ObjectSummary` and `ObjectDetail` gain `schedule?: ScheduleState`.
- `AgendaRow` and `Agenda` mirror §6.4.
- `RevisionAction` gains `"complete"`.

`web/src/api/queries.ts`:

- `queryKeys.agenda(spaceId)` under the `["space", id]` prefix so the existing WebSocket
  invalidation covers it.
- `useAgenda(spaceId, days = 14)`.
- `useCompleteObject(spaceId)` posting `{rev}` to the complete route, invalidating the space prefix.
- `useUpdateSpace(spaceId)` patching name/icon/timezone for the settings picker.

`web/src/lib/schema.ts`:

- `effectiveProperties(type, declared)` returns declared properties plus
  `type.implicit_properties`. Every page passes the merged list to the table, filter bar, object
  panel and type editor.
- `effectiveMembers(type)` returns declared members plus `{key, required:false, featured:true}` for
  each implicit key when scheduled.

`web/src/lib/format.ts`:

- `recurrenceLabel(value)` and `recurrenceEquals`.
- `parseCellText` refuses recurrence text; recurrence is edited by its own control.
- `valueLabel` handles recurrence through `recurrenceLabel`.

`web/src/lib/filter.ts`:

- `columnChoices` walks `effectiveMembers`, so scheduled keys are filter/sort/column choices.
- `operatorsFor("recurrence")` is `equal`, `not_equal`, `is_empty`, `is_not_empty`.
- The filter value editor uses the same `RecurrenceInput`; an equality value is a
  `RecurrenceValue`.

`web/src/lib/schedule.ts` (new, pure, tested):

- `recurrenceSummary(value): string`
- `weekdayName(index): string`
- `recurrenceDraft(value)` and `normalizeRecurrence(draft)` for the editor; the latter enforces
  §4.3's field applicability and `1..=1000`, and returns an error message instead of a value.
- `dueTone(status)` mapping to the accent/danger classes; no date math is duplicated here — the
  server owns `days_until_due`.

### 7.2 Scheduling controls

`web/src/components/property-input.tsx`:

- `case "recurrence": <RecurrenceInput … />`. It renders kind (`Days`/`Weeks`/`Months`), an
  interval number, and either a weekday select (Sunday…Saturday) or a day-of-month number.
  It commits with explicit Apply and Cancel, not Enter alone, because it is several controls.
  Empty clears the property. The commit label is `recurrenceLabel`.
- `PropertyField` uses the same component in the object panel.
- `PropertyCell` passes the row's `schedule` to `CellValue`; a `due_date` cell renders
  `Overdue 3d`, `Today` or the date with the tone from `dueTone`. The recurrence cell opens the
  inline `RecurrenceInput` like every other format.

`web/src/components/schema/type-editor.tsx`:

- A `Schedule` checkbox, included in the PATCH payload.
- When on, a read-only "From scheduling" list shows Due / Repeats / Last completed, each with its
  format and key, and explains that values live on records and Complete writes the last one.
- Toggling on adds `due_date` to the column draft if absent. Toggling off is allowed by the UI and
  surfaces the server's `409` inline, naming how many records must be cleared first.
- The `available` property picker excludes implicit keys; they are already members.

`web/src/components/schema/type-list.tsx` (create form): a `Schedule` checkbox and `POST` field, so
a Chore type can be born scheduled. Default off.

### 7.3 Object panel

- Show all effective members, declared first then implicit, with the existing per-format fields.
- `last_completed_at` is displayed disabled in edit mode with the hint "Set by Complete"; it is
  still rendered in read-only mode.
- A schedule strip under the title: status, due date, overdue days, recurrence label, completed
  date, and a `Complete` button for editors when status is not `done`.
- Complete sends the current `rev`; on `409` show the conflict toast and reload the object; on
  success replace the baseline with the returned object. Do not leave the dirty form in place over
  a completion.
- Due-date tone is visible in the panel too, not just the table.

### 7.4 Schedule page and navigation

New route `s/:spaceId/agenda` → `pages/agenda.tsx`, linked from `space-nav.tsx` as **Schedule**
between Types and Schema, with an overdue count badge from `useAgenda`. `SpaceNav` accepts an
optional `selected` value so the link gets `aria-current`.

Page structure:

- Header: `Schedule`, the space timezone (mono), `today` from the server, and a horizon selector
  7 / 14 / 30 days.
- Sections `Overdue`, `Today`, `Next N days`, each with a count and an empty state. An overdue row
  is the one accented thing on the page; do not accent every date.
- Each row: type icon and name, title link to the object, due date, `Overdue 3d`/`Today`/`In 2d`,
  recurrence label, and a Complete button for editors. Complete updates in place through the space
  invalidation; no optimistic rewrite of `due_date`.
- `later_count` renders as "N more due later" without loading them.
- Empty state when no type is scheduled names the action: "No type is scheduled — open Schema and
  turn on Schedule for a type." No independent schedule page in the rail when the space has no
  scheduled types? Keep the link; the empty state is the teaching surface.

### 7.5 Timezone surfaces

- Space creation form (`pages/spaces.tsx`): a timezone select defaulting to
  `Intl.DateTimeFormat().resolvedOptions().timeZone` when the browser names one the list contains,
  otherwise `UTC`. Send it with `POST /spaces`.
- Space settings: extend `pages/members.tsx` with an owner-only "Space timezone" select that
  `PATCH`es the space. Use `Intl.supportedValuesOf("timeZone")`; always include the current value
  even if the runtime omits it. Explain the rule in one sentence: "Due and overdue are calendar
  days in this zone."
- Invalid server responses show inline; a successful patch refreshes the space and agenda caches.

### 7.6 Visual direction

Stay inside the M1 world: Operate mode, dark-first, hairline rules, one accent for state. Overdue is
the accent/danger state; today uses the warning tone already in the token file; upcoming is muted.
Use tabular numerals for dates and day counts. No new card or shadow style. On coarse pointers the
Complete button and agenda rows meet the ≥44 px target, and the recurrence editor's inputs are 16 px
so iOS does not zoom.

## 8. Build order

Each numbered item is one checkpoint and one turn. Stop and report after each, per the ROADMAP
protocol. Do not run two in one turn.

1. **Format version and schedule model.** Add `jiff`; bump `FORMAT_VERSION` to 2 with
   `MIN_FORMAT_VERSION` and the `1..=2` reader; add `TypeDef.schedule`, `Recurrence`,
   `RecurrenceKind`, the `Value` variant, `schedule_property_defs`, `is_schedule_key`, and the
   recurrence mapping in `markdown`/`value`; update every exhaustive match; add schema-2 fixtures
   and keep the schema-1 fixtures parsing. Update the writer tests and any current docs outside the
   historical M1 plan that quote `schema: 1`.
   Verify: `cargo build --workspace && cargo test --workspace` (core round-trip and both schema
   versions). Full Rust gate.
2. **Schedule engine.** `schedule.rs`: timezone resolution, `today_in`, `advance`, `state`,
   `complete`, recurrence validation, labels. Unit tests: interval days; weekly same-day → next
   week, weekday selection and multi-week interval; monthly 31 → Feb 28 in 2026 and Feb 29 in 2028,
   and Jan 31 every 2 months → Mar 31 → May 31; late completion from today; early completion from
   the due date; completion with no recurrence clears the due date; timezone boundary where UTC is
   already tomorrow but the space is not (and the reverse); invalid timezone; DST spring-forward
   and fall-back dates do not shift a due day. Verify: `cargo test -p thing-core`. Full Rust gate.
3. **Index, schema and validation.** `SpaceIndex` generated definitions, `Schema` fallback,
   `TypeDef::has_property`, object/filter/sort membership, reserved property keys, `Problems`
   additions. Tests: due_date on a scheduled type validates and on an unscheduled type fails;
   listing an implicit key in `properties` fails; a filter/sort on due_date works only when
   scheduled; a hand-edited declared property named `due_date` is a reported problem; `schema()`
   resolves all three formats. Verify: core tests. Full Rust gate.
4. **Server type, property and timezone surface.** `TypeDetail` with `implicit_properties`,
   `TypeSummary.schedule`, schedule create/patch, disable guard, column append, property-key
   rejection, timezone validation, health fields. Tests in `routes/types.rs`, `routes/properties.rs`
   and `routes/spaces.rs`. Verify with the Rust gate plus curl: create a scheduled type, confirm
   `types/<key>.yml` has `schedule: true` and `due_date` in columns; create a `due_date` property →
   422; add a record with `due_date`, PATCH schedule off → 409; PATCH an invalid timezone → 422.
5. **Server complete, agenda and schedule JSON.** Extract `commit` with no behavior change, add the
   complete route, `RevisionAction::Complete`, `object.completed`, `ScheduleJson` on list/detail,
   agenda, recurrence labels. Tests for stale rev, unscheduled type, one-off and recurring
   completion, agenda buckets and horizon, and the event payload. Verify with the Rust gate and the
   §10 curl walkthrough through step 9. Read the written `.md` and `.ndjson` by hand.
6. **Web data layer and scheduling inputs.** DTOs, query hooks, `effectiveProperties`/
   `effectiveMembers`, `lib/schedule.ts` + tests, recurrence format in `format`/`filter`,
   `RecurrenceInput`, due-date cell tone, object-panel fields and Complete, type editor schedule
   surface, create form schedule toggle. Verify: `npm run test:run && npm run lint && npm run
   typecheck`; browser: create a scheduled type, add due/recurrence through the table and the panel,
   complete a record, confirm the table and panel update and the file shows the new values.
7. **Schedule page and timezone surfaces.** Agenda page, nav link and overdue badge, horizon
   selector, owner timezone select in members/settings, timezone select on space creation. Verify:
   the web gate plus a browser pass with two windows — complete a chore in one and watch the
   agenda/table/overdue badge update in the other without a refresh; change the timezone and see
   `today`/overdue recalculate. Check 375 px: rows tappable, recurrence inputs do not zoom.
8. **Seed, docs and end-to-end.** Bump the workspace and `web/package.json` version to `0.2.0`.
   Update `scripts/seed.sh` (Garden timezone `Europe/Berlin`, Chore scheduled, one overdue and one
   upcoming record), `docs/ROADMAP.md` (M2 landed plus the plan link), `AGENTS.md` (current state,
   new module, schedule invariants) and any README feature list.
   Run the full verification in §10, including the container build if the Dockerfile changes (it
   should not). Report the final file/history bytes.

## 9. Critical files and anchors

- `crates/core/src/schedule.rs` — the only place a due date is advanced or a completion mutates an
  object. Timezone identity, clamping and the early/late rule live here; the server must not
  reimplement them.
- `crates/core/src/model.rs` — `TypeDef.schedule` and the `Value::Recurrence` shape define the JSON
  and frontmatter contract for both the server and the SPA.
- `crates/core/src/markdown.rs` — the version gate; accepting 1 and writing 2 is the compatibility
  contract.
- `crates/server/src/routes/values.rs` — one schedule projection feeds the table, the panel and the
  agenda; labels and `days_until_due` must not diverge between them.
- `crates/server/src/routes/objects.rs` — the single write path. Complete joins `update` through
  `commit`, not a copy.
- `web/src/lib/schedule.ts` — pure recurrence editor helpers; the only place the client formats or
  validates a recurrence.
- `web/src/components/space-nav.tsx` — the overdue badge is the always-visible reminder; it must
  come from the same agenda query the page uses.

## 10. Verification

Prerequisites unchanged: `cargo 1.98`, Node 24, a free port 8080.

```
cargo build --workspace
cargo test --workspace
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cd web && npm ci && npm run test:run && npm run lint && npm run typecheck && npm run build
```

End-to-end smoke with `THING_DATA_DIR=./data cargo run -p thing-server` and a fresh seed:

1. `scripts/seed.sh` completes. Garden has `timezone: Europe/Berlin` and a `chore` type with
   `schedule: true`.
2. The scheduled type file contains `schedule: true` and `columns: [title, due_date, ...]`; the
   generated keys have no files under `properties/`.
3. A record with `due_date` set to yesterday and `recurrence: {kind: days, every: 3}` is listed as
   `"status":"overdue"` with `"days_until_due":-1`, and appears under `overdue` in
   `GET /agenda?days=14`.
4. `POST /objects/<id>/complete {"rev":<current>}` returns the object with a due date three days
   from today (the completion was late, so it re-phased from today), `rev` incremented by one, and
   `last_completed_at` set. The `.md` file shows the same frontmatter; `history/<uuid>.ndjson` has
   one more line with `"action":"complete"` and the new due date in its snapshot.
5. Repeat the same POST with the old revision → `409` with `current_rev`. POST on a record of an
   unscheduled type → `422`. POST on a trashed record → `404`.
6. Complete a one-off record (no recurrence): `due_date` disappears from the object and its file,
   `last_completed_at` remains, and the agenda no longer shows it.
7. Monthly clamp through the API: set `due_date: 2026-01-31` with
   `{kind: monthly, every: 1, day: 31}`, complete with a mocked "today" via the core unit test
   (not the live server) → `2026-02-28` for 2026; core test covers the 2028 leap year.
8. Timezone: PATCH the space to an invalid zone → `422`; `GET /spaces/<id>/health` reports
   `invalid_timezone` only for a hand-edited bad value. PATCH to `Pacific/Kiritimati`; the agenda's
   `today` matches that zone even when UTC is on the previous day (assert with the unit test's fixed
   clock; the live check is that `today`/`timezone` agree).
9. Live: a Node WebSocket listener sees `object.completed` with the new `due_date` while a `curl`
   complete runs. A second browser window's table, object panel and overdue badge update without a
   refresh.
10. Restart the server: the agenda sections are identical, and the completed record's file and
    history survive byte-for-byte.

UI pass (server on 8080, `npm run dev` in `web/`):

- Create a Chore type with Schedule on; confirm the three implicit properties appear read-only in
  the schema editor and the due column appears in the table.
- Create records with each recurrence kind, edit recurrence inline in the table, set a due date in
  the object panel, and complete one from each surface.
- Run the two-window check: complete in window A, watch window B's table row, object panel and
  Schedule link badge change.
- Set a due date in the past, confirm the Overdue section and the red due cell; set one today and
  one next week, confirm the buckets; change the horizon and confirm `later_count`.
- Change the space timezone in settings and confirm the agenda header and overdue classification
  follow it.
- At 375 px, confirm every Complete button and agenda row is tappable and the recurrence inputs keep
  the viewport from zooming.

## 11. Assumptions and contingencies

- `jiff` 0.2.38 with `tzdb-bundle-always` is the timezone source; no system `tzdata` package is
  added. If the bundled feature ever fails to resolve an IANA name that `Intl` offers, the server
  returns 422 and the plan's fallback is to add `tzdb-zoneinfo` for the container, not to build a
  second timezone table.
- A space with an invalid or missing timezone behaves as UTC and reports the problem. Do not block
  reads or writes because of it; otherwise a hand-edited `space.yml` would take the space offline.
- The format bump is one-way for a v0.1 binary reading a v0.2 file. That is accepted: M1 is
  deployed, and a downgrade must restore the data directory from backup anyway.
- Completing a recurring record twice in a row intentionally advances twice if both calls carry the
  fresh revision; there is no idempotency key and no cooldown. The UI sends the revision it holds
  and hides Complete for a `done` record, so the ordinary double click is a `409`, not a double
  advance.
- `last_completed_at` is editable through PATCH because it is an ordinary property; the UI disables
  it. Tightening it to Complete-only would need a read-only property concept, which is not in M2.
- The agenda is computed on read. At ten thousand scheduled records it is still one pass over the
  in-memory index; there is no cache and no background materialization. If that stops being true,
  the fix is an index-maintained list, not a database.
- Due dates are not enforced as required. A scheduled type without a due date is `unscheduled` and
  simply does not appear in reminders; Complete still works and schedules from today when a
  recurrence exists.
- No email, push, webhook or timer is added. If reminders return later, they get their own milestone
  with the slot-not-timer design recorded in the roadmap.
- Seed data uses `Europe/Berlin`, but no test depends on the host timezone; core tests pass a fixed
  `now` and an explicit zone.
