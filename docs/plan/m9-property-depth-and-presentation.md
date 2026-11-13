# M9 — Property depth and presentation, v0.9.0

Target: workspace `0.9.0`, on-disk `schema: 8`. Thirteen checkpoints: **presentation** (1–6,
decided here in full, released as `0.9.0` at checkpoint 6), then **property depth** (7–12, the
roadmap's existing M9 list, decisions locked here, per-checkpoint work confirmed when that half
starts) and its own release pass at `0.9.1` (checkpoint 13).

**Status: checkpoints 1–5 landed in the working tree; checkpoint 6 (the `0.9.0` release) is next.**
The milestone opens only after M8.1's checkpoint 5 lands the `0.8.1` release. Merged 2026-11-11: table presentation was requested as its own milestone at
`0.9.0`; the roadmap already held that version for property model depth, so both live here, on one
schema bump, rather than renumbering M10–M14. The merge is recorded in `docs/ROADMAP.md`.

## Working agreement — AGENTS.md is binding

Read `AGENTS.md` in full before the first action and again before every checkpoint. This section
restates only what a format-moving milestone is most likely to break; `AGENTS.md` wins where they
differ, and a conflict stops the turn for a question rather than a quiet choice.

- **One checkpoint per turn.** Do the checkpoint, run its gate, report, stop.
- **The user commits; the agent never does.** No `git add`, `commit`, `tag`, `push`, `stash`,
  `reset`, `checkout -- .` or history rewrite. Leave the tree uncommitted. Read-only git is fine.
- **Never touch the dev account or the data.** `a@b.c` / `devpass123` stays fixed; never reseed,
  rotate a password, write sessions into `data/accounts.sqlite`, or delete `./data`. Fixtures live
  in `tempfile::TempDir` or `scripts/seed.sh`, never in the repo's `data/`.
- **Both gates, every checkpoint that touches both sides.** Rust:
  `cargo build --workspace && cargo test --workspace && cargo fmt --all --check &&
  cargo clippy --workspace --all-targets -- -D warnings`. Web: `npm run test:run && npm run lint &&
  npm run typecheck && npm run build` from `web/`. A checkpoint that changes only one side runs only
  that side's gate and says so.
- **Schema 8 is a one-way door.** `FORMAT_VERSION` moves once, in checkpoint 1, and a file written
  by this milestone is refused by every earlier binary. The upgrade is read-only until the space's
  next write, exactly as schema 6→7 worked.
- **No new dependency.** Currency, alignment and formatting are the platform's `Intl` plus plain
  code. No number-formatting package, no currency table.
- **Delete nothing you did not add.** Existing behaviours (paging, selection, bulk bar, widths,
  editing, the phone table, handedness, the ephemeral footer) are in scope to preserve.
- **Changelog in the same tree.** Every checkpoint extends the open `Unreleased` entry in
  `web/src/content/changelog.ts`; checkpoint 6 turns it into `0.9.0`.
- **Report shape.** **Built**, **Concepts**, **Decisions taken**, **Verified**, **Test it**,
  **Inspect**, **Proposed commit**, as `AGENTS.md` and the delivery protocol describe.

## Context

The table is a ledger that cannot be told what the numbers mean. Every number renders through the
server's plain label, every column sits left-aligned, and the summary band from M8.1 is always on and
always in the reader's locale. Three consequences:

- **Money reads as a bare number.** `1204` could be dollars, kilos or units; a reader has to
  remember which column meant what, and the summary band cannot say `Σ $1,204.00`.
- **A column cannot be arranged.** Ledger practice puts numbers at the right edge against their
  digits; a code-like text column (`A-1042`) often wants the same, and today nothing can move.
- **The band cannot be turned off.** A table whose last three columns are notes carries three
  `—` or `9 distinct` cells nobody asked for, and M8.1's decision 9 makes that permanent by
  refusing to store the reader's preference.

M9 fixes all three by storing **how to display** a value, never what it stores. Supersedes M8.1
decision 9: the summary band gains a stored switch. M8.1 decision 12 (no new visual token) still
holds — alignment and currency reuse the ledger's existing typography.

## Locked decisions

1. **Schema 8, workspace `0.9.0`. No new route.** A property gains an optional `display` block; a
   table view gains `footer` and `footer_hidden`. Every other byte of the format is unchanged, and
   every write still goes through the existing property and view PATCH routes.
2. **Display is property-level, the footer switch is view-level.** Currency, decimals, grouping and
   alignment describe what a value *is*, so every view agrees; the summary band is a layout choice
   per view, so each table decides. The two never overlap.
3. **Display never changes a stored value, a sort, a filter or an export.** `value` stays the raw
   JSON number; CSV writes that number; sorting and filtering read it; `label` stays the server's
   plain text. The display is applied by the web when it turns a value into text.
4. **One number grammar in the web.** `web/src/lib/presentation.ts` owns `numberText`, and every
   surface that shows a number uses it — table cell, record field, applied display in the summary
   band. The server keeps emitting the plain label; the client re-derives only when a property
   carries `display`.
5. **Currency is an ISO 4217 code, not a free-form symbol.** `currency: USD` renders `$1,204.00` in
   `en-US` and `1.204,00 $` in `de-DE`; `"$"` as a prefix string would be a second spelling of the
   same concept and would put the symbol on the wrong side in half the world. A code is validated by
   shape (`^[A-Z]{3}$`) on the server and offered as a searchable list from
   `Intl.supportedValuesOf("currency")` in the editor, so a typo cannot be typed.
6. **A currency with no `decimals` shows the currency's minor units.** `USD` renders `$3.00`, not
   `$3`; `decimals` overrides with exactly that many fraction digits (`min = max = decimals`).
   `JPY` shows no minor units because `Intl` knows it has none.
7. **No `decimals`, no currency: the digits are the value's own.** Cells render with
   `maximumFractionDigits: 20`, so `4.7531` never quietly becomes `4.753`.
8. **`align` is `auto | left | right`, and `auto` right-aligns numbers.** Every other format is
   left. This makes an existing number column right-align the moment the milestone lands — a visible
   change, named in the `0.9.0` release notes, and the reason a column can be pinned left instead.
   Alignment applies to table data cells only; the record page, board and gallery keep their own
   layout.
9. **The summary band's switches are a denylist.** `footer` turns the band off for the view;
   `footer_hidden` names columns whose cell is blank. Absent means shown and summarised, so every
   existing view renders exactly as it did at `0.8.1`, and a property added later is summarised
   without another write. **Revised 2026-11-12:** each column can also name the measure it prints
   (`footer_summary`), because all-or-none and one fixed line per format cannot express “show the
   highest, not the sum”. An absent key keeps the format's default.
10. **The band honours the display.** A number column's `Σ`, average, lowest and highest go through
    `numberText` (currency, decimals, grouping); its `filled`/`total` counts do not. A text column's
    distinct count is unchanged.
11. **Authoring is the existing schema editor, column panel and view settings.** No new dialog and
    no new sheet: a display disclosure beside the property's format, a Summaries switch in the
    view's settings with the per-column list under it. **Revised 2026-11-12:** the
    toolbar's Columns button, Sort button, kebab and the separate settings/CSV dialogs collapse
    into one **View** sheet whose tabs are Columns, Sort, Settings, Save as view and Data. The
    panels themselves are unchanged; only their doors are one, so a setting is one tap from the
    view it edits instead of a popover chain.
12. **The depth half keeps the roadmap's order.** Validation, create-time defaults, rollup filters,
    the member format, relation target filters and one-to-one, formula additions, then the shared
    daily type — because each later item is built on the earlier ones.

## The format (schema 8)

### A property's `display`

`properties/<key>.yml` gains one optional block:

```yaml
schema: 8
key: amount
name: Amount
format: number
display:
  align: right      # auto | left | right; absent means auto
  currency: USD     # three uppercase letters; number only
  decimals: 2       # 0–4; number only; absent means the value's own digits
  grouping: false   # number only; absent means the locale's separators
```

| Field | Formats | Values | Absent means |
|---|---|---|---|
| `align` | every format | `auto`, `left`, `right` | `auto` |
| `currency` | `number` | `^[A-Z]{3}$` | no symbol |
| `decimals` | `number` | `0`–`4` | the value's own digits, or the currency's minor units |
| `grouping` | `number` | `true`/`false` | the reader's separators |

Validation, all refused with the property key and field in the message:

- `currency`, `decimals` or `grouping` on a format other than `number` — `display.currency belongs to
  number properties only`.
- `decimals > 4`, a malformed `currency`, an unknown `align` — `deny_unknown_fields` already refuses
  a misspelled key.
- An empty `display` block is written as no block; `align: auto` is written as absent so one state
  has one spelling.

### A table view's summary band

```yaml
views:
  - key: all
    name: All
    kind: table
    columns: [title, amount, notes]
    footer: false
    footer_hidden: [notes]
    footer_summary:
      amount: highest
      notes: distinct
```

- `footer: bool`, absent or `true` means shown.
- `footer_hidden: [key…]`, absent or `[]` means every column is summarised. Entries must be
  members of `columns`; a duplicate is refused; `title` is allowed (hiding the row count for a
  narrow table).
- `footer_summary: {key: measure}`, absent means each column keeps its format's default line. Keys
  must be members of `columns`. Measures are validated against the column's format: a number takes
  `filled`, `sum`, `average`, `lowest` or `highest`; a checkbox `filled` or `checked`; a date or
  datetime `filled`, `earliest` or `latest`; text-like formats `filled` or `distinct`; a counted
  format only `filled`; `title` only `rows`. A measure that does not fit is refused with
  `does not fit this column's format`.
- All three fields are refused on `board`, `gallery` and `calendar` (`belongs to table views
  only`), the same rule `widths` already carries.
- `footer: false` wins at render; `footer_hidden` is kept as written, because the two switches are
  edited independently and turning the band back on must restore the reader's denylist.

### Upgrade path

- A schema-7 file parses unchanged: both blocks are optional and absent, so the space reads exactly
  as it did at `0.8.0`.
- The first write emits `schema: 8`; `display` and the two view fields appear only when set.
- A schema-8 file is **refused** by an `0.8.x` binary through the existing version guard, with the
  same sentence it gives any future schema.
- `crates/core/tests/fixtures/` moves wholesale to `schema: 8` in checkpoint 1, and gains one
  property fixture with a full `display` block and one type fixture whose table view carries
  `footer: false` and `footer_hidden`.

## The presentation grammar

### Numbers

`numberText(value, display)` — the only function that turns a number into text for display:

| display | `1204` | `4.7531` | `3` |
|---|---|---|---|
| absent | `1204` (server label) | `4.7531` | `3` |
| `currency: USD` | `$1,204.00` | `$4.75` | `$3.00` |
| `currency: USD, decimals: 0` | `$1,204` | `$5` | `$3` |
| `decimals: 1` | `1,204.0` | `4.8` | `3.0` |
| `grouping: false` | `1204` | `4.7531` | `3` |
| `grouping: false, decimals: 2` | `1204.00` | `4.75` | `3.00` |

- One `Intl.NumberFormat(undefined, …)` per property definition per render, built from `currency`,
  `decimals` and `grouping`; no caching keyed by anything mutable.
- `currency` set and `decimals` absent: `style: "currency"` with the formatter's own minor units.
- `decimals` set: `minimumFractionDigits = maximumFractionDigits = decimals`.
- Neither: `maximumFractionDigits: 20`, `minimumFractionDigits: 0`.
- An unknown-but-well-formed code raises in `Intl`; the cell falls back to the plain label rather
  than guessing.
- A non-finite number never reaches the formatter; it renders as it does today.

### Alignment

`alignOf(format, display)` returns `left` or `right`:

- `display.align` when set (`auto` is not stored, so only `left`/`right` can arrive).
- otherwise `right` for `number`, `left` for every other format.

The table's data `<td>` carries it; the title column stays left; the header keeps its existing
alignment so the band does not move. The summary band follows its column so totals sit over their
digits.

## Checkpoints

### Checkpoint 1 — Schema 8 in the core

- `crates/core/src/model.rs`: `DisplayDef { align: Option<Align>, currency: Option<String>,
  decimals: Option<u8>, grouping: Option<bool> }`, `Align { Auto, Left, Right }`; `PropertyDef.display:
  Option<DisplayDef>` with `skip_serializing_if`; `ViewDef.footer: Option<bool>` and
  `ViewDef.footer_hidden: Vec<String>` with `skip_serializing_if = "Vec::is_empty"`.
  `PropertyDef::display()` returning a defaulted view is **not** added — callers read the `Option`.
- `crates/core/src/lib.rs`: `FORMAT_VERSION = 8`, the const test updated.
- `crates/core/src/validate.rs`: `validate_display(property)` called from wherever a property is
  validated today, and the two view rules inside `validate_view`'s `widths` branch.
- Fixtures: every fixture's `schema` line becomes `8`; `properties/amount.yml` gains a `display`
  block; one type fixture's table view gains `footer: false` and `footer_hidden`; `invalid/` gains a
  text property carrying `currency` and a calendar view carrying `footer`.
- Tests: `validate.rs` inline cases for each refusal; `roundtrip.rs` for the two new fixtures;
  a parse test proving a schema-7 property and type still load with no display and no footer.

**Acceptance:** `cargo test --workspace` green at schema 8; a schema-7 space on disk reads and
serves unchanged; the invalid fixtures are refused with their field named.

**Gate:** the Rust gate.

**Files:** `model.rs`, `validate.rs`, `lib.rs`, `tests/fixtures/**`, `tests/roundtrip.rs`.

### Checkpoint 2 — The server accepts and reports it

- `crates/server/src/routes/properties.rs` and `routes/types.rs` already serialize the definitions,
  so the work is the write path: an invalid `display` is a `422` naming `display.<field>`, and an
  invalid view field is refused by `validate_views` and reported by `/health`'s `view_problems`
  without taking the space offline.
- `routes/values.rs` **does not change**: the label stays plain, per decision 3.
- Tests: a property PATCH with `display: {currency: "USD"}` echoes it; the same on a `text` property
  is a `422`; a view PATCH with `footer: false` echoes it and one on a board is a `422`; a hand-edited
  type file with `footer_hidden: [ghost]` shows up in `view_problems`.
- Changelog: not yet — nothing user-visible ships until checkpoint 4.

**Acceptance:** the two blocks round-trip through the API untouched, and every refusal names its
field.

**Gate:** the Rust gate.

**Files:** `routes/properties.rs`, `routes/types.rs`, their inline tests.

### Checkpoint 3 — The web's one number grammar

- `web/src/api/types.ts`: `PropertyDisplay`, `Align`, `PropertyDef.display?`, `ViewDef.footer?`,
  `ViewDef.footer_hidden?`.
- `web/src/lib/presentation.ts` (new, pure): `numberText(value, display, locale?)`,
  `displayLabel(property, format, value, serverLabel)`, `alignOf(format, display)`. `numberText`
  returns `null` when the display asks for nothing this module can honour (no display, or an unknown
  currency code) and the caller keeps the server's label.
- `web/src/lib/grid.ts`: `GridColumn` gains `display?: PropertyDisplay`; `cellText` uses
  `displayLabel` so a copied cell and a shown cell cannot disagree.
- `web/src/lib/aggregate.ts`: number summaries format through `numberText`; when a display hides the
  grouping or fixes the decimals, `Σ`/average/lowest/highest follow it; without a display the text is
  byte-identical to `0.8.1`.
- Tests: `presentation.test.ts` for the whole table above, including a `de-DE` locale passed
  explicitly, an unknown code, `decimals: 0` rounding, and `grouping: false`; `aggregate.test.ts`
  gains a currency column and a `decimals` column, still asserting through the same `Intl` options
  the module uses; the existing aggregate expectations stay unchanged.

**Acceptance:** one function decides every number's text, and no existing expectation moves.

**Gate:** the web gate.

**Files:** `api/types.ts`, `lib/presentation.ts`, `lib/presentation.test.ts`, `lib/grid.ts`,
`lib/grid.test.ts`, `lib/aggregate.ts`, `lib/aggregate.test.ts`.

### Checkpoint 4 — The table shows it

- `components/views/table-view.tsx`: build `GridColumn.display` from the property; every data cell's
  number text comes from `displayLabel`; the `<td>` carries `alignOf`; the summary band renders from
  `summaries` filtered by `view.footer` / `view.footer_hidden`, and each cell's alignment follows its
  column.
- The footer's scope line is unchanged; when the band is off it does not render at all, so the line
  goes with it.
- Tests: a currency column renders `$1,204.00` in the cell and `Σ $3.00 · avg $1.50` in the band; a
  `footer: false` view renders no `<tfoot>` and no scope line; a `footer_hidden: [notes]` view renders
  a blank cell for that column only; a number column right-aligns and a text column does not; an
  `align: left` number column does not; a copied cell carries the same text the cell shows.
- Changelog: three sentences — the currency and decimals, the right-aligned numbers, the band switch.

**Acceptance:** a money column reads as money in the cell and in its total, and a table can drop the
band or one column's cell.

**Gate:** the web gate.

**Files:** `components/views/table-view.tsx`, `components/views/table-view.test.tsx`,
`content/changelog.ts`.

### Checkpoint 5 — Authoring

- `components/schema/display-fields.tsx` (new): the shared sub-form — **Align** segmented control,
  and for a `number` property **Currency** (searchable list from
  `Intl.supportedValuesOf("currency")`, plus None), **Decimals** (Auto, 0–4) and **Thousands** (on by
  default). Mounted by `components/schema/property-editor.tsx` and by the add-property sheet so the
  two cannot drift.
- `components/views/view-settings.tsx`: a **Summary band** switch that PATCHes `footer`, and the
  band's own list is where a single column's cell is switched off (`footer_hidden`) — one place for
  the band, beside its switch, so the column panel's row menu carries only the property's actions.
  **Revised 2026-11-12:** the row-menu switch and the Title row's copy of it were removed on
  request; the sheet's General panel is the one door.
- All of it writes through the existing property and view mutations; no optimistic state of its own.
- Tests: the display form refuses to offer currency on a text property; saving a currency PATCHes
  `display` and keeps the rest of the property; a column's checkbox adds and removes a key from
  `footer_hidden`; the band's switch PATCHes `footer`; the band hides its list while it is off; both
  survive an unrelated view PATCH.

**Acceptance:** every setting in checkpoints 1–4 is reachable without editing a file.

**Gate:** the web gate.

**Files:** `components/schema/display-fields.tsx` (+ test), `components/schema/property-editor.tsx`,
`components/add-property.tsx`, `components/views/column-panel.tsx` (+ test),
`components/views/view-settings.tsx`, `content/changelog.ts`.

### Checkpoint 6 — Version, docs and the `0.9.0` release

- `Cargo.toml`, `web/package.json`, `web/package-lock.json` → `0.9.0`.
- `web/src/content/changelog.ts`: the open `Unreleased` entry becomes `0.9.0`, "Numbers that read",
  grouped into **Say what the number is** (currency, decimals, thousands), **Line up** (right-aligned
  numbers, a pinned alignment) and **The band, on your terms** (the view switch, the per-column
  hide). One sentence per item; the right-alignment change is named plainly as a visible change.
- `docs/ROADMAP.md`: M9 already points at this file and M10 already yields "persisted
  aggregations" (recorded 2026-11-11); this checkpoint records checkpoints 1–6 as landed at
  `0.9.0`, schema 8.
- `AGENTS.md`: the current-state paragraph gains M9 and `0.9.0` and the test count is corrected to
  the measured total; the plan table's row for this file was added when the milestone was merged.
- `README.md`: the table bullet gains the currency/alignment clause.
- `DESIGN.md`: a short **Numbers and their column** passage — the right edge, the tabular voice, the
  money prefix, and what the band's voice does with both. No token changes, so `.impeccable/design.json`
  stays as it is.
- `scripts/seed.sh`: the Garden space's Plant type gains a `price` number property with
  `currency: USD`, `decimals: 2`, and one table view hides its Nursery summary — the seed is the demo
  of the feature, not a data migration.
- Release QA: a contact sheet at 390 / 768 / 1024 / 1440 in both schemes over a currency column, an
  aligned text column, a band with a hidden column and a band switched off, stored as
  `.impeccable/critique/<timestamp>__v0.9.0-release-qa.md`, with a reduced-motion and keyboard-only
  pass, and plainly no physical touch device attached.

**Acceptance:** both gates green; the changelog's newest entry is `0.9.0`; no footer cell, currency
prefix or ring clips at any width.

**Gate:** both.

**Files:** version files, changelog, `docs/ROADMAP.md`, `AGENTS.md`, `README.md`, `DESIGN.md`,
`scripts/seed.sh`, `.impeccable/critique/`.

**Note:** `0.9.0` records presentation as landed; the depth half's checkpoint 13 records 7–12.

## The depth half — checkpoints 7–13

Locked decisions are recorded here so the format does not move twice; each checkpoint's work list,
tests and manual walkthrough are confirmed in its own turn, the way M9's presentation half was.

7. **Validation.** A property gains `validation: { min, max, pattern, unique }`; `min`/`max` on
   `number` and `date`, `pattern` on `text`/`url`/`email`, `unique` on any stored format. `required`
   stays on the type membership where it already lives. Enforced in `validate_object` with the
   property key in the message; CSV import refuses a row that breaks a rule; `unique` is a `409`
   naming the holder, checked over live records; `unique` is refused on a calculated property.
8. **Create-time defaults.** A membership gains `default: <value>`, validated against its property
   and refused on a required-plus-calculated pair. Applied by New record and Quick capture only,
   written into the object at creation, never by a bulk create and never over an existing value.
9. **Rollup filters.** `compute` gains an optional `filter` over the target type, reusing the stored
   `Filter`; validated in `compute.rs` against the target's own properties; the evaluator applies it
   before aggregating; the footer and every read see the filtered value.
10. **The member format.** `format: member`, one or many account ids in the same list shape a
    relation uses; labels resolve from `space.yml`; an id that no longer belongs to the space is kept
    and reported like a dangling relation; the record page offers the space's members and never an
    email address it does not already show.
11. **Relation filters and one-to-one.** A relation property gains `target_filter: Filter` over the
    target type and `one_to_one: true`, which refuses a second source naming the same target. Both
    validated, both refused on a rollup's relation.
12. **Formula additions and the daily type.** `coalesce`, `contains`, `length`, `replace`,
    `date_add` and `format_date` join the function set with arity and type checks and their own
    tests; `space.yml` gains `daily_type: <type key>` and a `/s/<space>/daily` route that opens or
    creates today's record of that type by its `YYYY-MM-DD` title in the space's zone.

### Checkpoint 13 — The depth release pass

- `Cargo.toml`, `web/package.json`, `web/package-lock.json` → `0.9.1`.
- `web/src/content/changelog.ts`: the open `Unreleased` entry becomes `0.9.1`, one section per
  landed feature group, in the order the checkpoints landed; the `0.9.0` entry stays untouched.
- `docs/ROADMAP.md`, `AGENTS.md`, `README.md`, `DESIGN.md` record checkpoints 7–12 as landed at
  `0.9.1`, schema 8, with no format change beyond checkpoint 1's.
- Release QA: one contact sheet over the validation error, a default-filled record, a filtered
  rollup, the member field, the relation filter and the daily note, at 390 and 1440 in both schemes.

## Critical files & anchors

| File | Role |
|---|---|
| `crates/core/src/model.rs` | `PropertyDef.display`, `DisplayDef`, `Align`, `ViewDef.footer`, `ViewDef.footer_hidden` |
| `crates/core/src/validate.rs` | `validate_display`, the table-only view rules; the depth half's object rules |
| `crates/core/src/markdown.rs` | Schema 8 parse/serialize; the upgrade guard already lives at the top |
| `crates/core/tests/fixtures/` | Every fixture at `schema: 8`, plus a display property and a footer-bearing view |
| `web/src/lib/presentation.ts` | `numberText`, `displayLabel`, `alignOf` — the one number grammar |
| `web/src/lib/aggregate.ts` | Summaries formatted through `numberText` |
| `web/src/lib/grid.ts` | `GridColumn.display`, so a copied cell equals a shown cell |
| `web/src/components/views/table-view.tsx` | Cell alignment, display-aware labels, the band's switches |
| `web/src/components/schema/display-fields.tsx` | The one authoring form for `display` |
| `web/src/components/views/column-panel.tsx`, `view-settings.tsx` | Per-column and whole-band switches |
| `DESIGN.md` | Numbers and their column; no token changes |

## Ordering

M8.1 checkpoint 5 (the `0.8.1` release) runs first. Then checkpoints 1–6 ship `0.9.0` on schema 8 —
presentation is the user's priority, so it does not wait for the depth half. Checkpoints 7–12 follow
in the order above, one checkpoint per turn, and checkpoint 13 releases them as `0.9.1`. Each
release pass owns its own version bump, so a milestone that ships in two halves never leaves the
tree claiming a version it has not got.
