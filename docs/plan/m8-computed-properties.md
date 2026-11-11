# M8 — Computed properties, schema 7, v0.8.0

Target: workspace `0.8.0`, on-disk `schema: 7`. Eight checkpoints; one per turn under the AGENTS
delivery protocol.

**Status: checkpoints 1–8 landed at workspace `0.8.0`.** The milestone was labelled M7 until
2026-11-11, when the roadmap adopted the rule that a milestone's number equals its workspace
minor (`M8` = `0.8.0`). Computed values change the property model and every rendering surface, so
they land while the format still moves.

## Context

M6.1 left the property model at schema 6. A property stores exactly one value: the object's
frontmatter key is the value, and every read (table row, board card, filter, sort, CSV, history)
reads that stored value. The format has no notion of a value the app derives.

M6.2 will land first with the property picker, property sheet and schema tabs this milestone
extends; computed fields live in those surfaces rather than inventing a second editor.

M8 adds two derived kinds:

- **Formula** — an expression over the object's own stored properties, evaluated per record.
- **Rollup** — an aggregate over the targets of one of the object's relation properties
  (`count`, `sum`, `min`, `max`, `list`).

Both are read-only. No computed value is written to the object file, history snapshot, search index
or CSV import. The value is materialized on every read, which is what keeps a relation target's
change visible in its sources without an invalidation graph: the server invalidates the whole space
on every event already.

## Locked decisions

1. **A computed property is a property with a `compute` block, not a new `format`.** `format` stays
   the *result* type (`number`, `text`, `date`, `datetime`, `checkbox` or the new `list`). This is
   deliberate: a computed number must sort, filter, render, label and export exactly like a stored
   number, and the filter/sort/CSV/rendering code already branches on `format`. `compute` is the
   derivation flag; the interface still calls the two kinds *Formula* and *Rollup*.
2. **`list` is the one new format, and it is computed-only.** It holds `Value::List` of display
   labels produced by a `rollup` with `aggregate: list`. No stored property may use it. Reusing
   `multi_select` was rejected: multi-select values are option **keys**, and a rollup's labels are
   already display text.
3. **A schema bump is required.** `PropertyDef` gains `compute`, and a schema-6 binary's
   `deny_unknown_fields` reader refuses a schema-7 property file. `FORMAT_VERSION = 7`, workspace
   `0.8.0`, matching every prior format change (2→0.2.0 … 6→0.7.0).
4. **Computed values never reach disk.** They are absent from object frontmatter, history snapshots,
   the search index, `.md` bodies and file names. A stored value on a computed key is refused on
   write and ignored on read.
5. **No computed-on-computed.** A formula references only stored properties of its own type (and
   `title`); a rollup reads a stored relation and a stored target property (or `title`). There is no
   cycle detection because there are no cycles; the evaluator is one pass.
6. **Evaluation is request-scoped and timezone-aware.** One `today` is resolved from the space's
   zone for the whole request, so every row and every sort key agrees. `today()` and `days()` use
   that date, matching the schedule engine's calendar-day rule.
7. **The formula language is small, typed and statically checked.** Definition errors are `422`s;
   a runtime type mismatch or an unset operand produces an empty cell, never a panic or a wrong
   value. The full grammar and the static type rules are below.
8. **A rollup counts resolved targets, including trashed ones.** A target that was permanently
   purged is skipped and remains reported by the existing `missing_relations` read. `count` of no
   targets is `0`; `sum`/`min`/`max`/`list` of no targets is empty.
9. **Definition lifecycle is explicit.** A computed property's `kind` is fixed at creation, but its
   expression or rollup fields are editable. Renaming a referenced property rewrites the reference.
   Deleting a referenced property (or a rollup's target type) is refused, even with `force`.
10. **One spelling for computed labels.** A rollup `list` emits the same display text the server
    already returns in a value's `label` (option names, target titles, file basenames), so a list
    cell and a table cell never disagree.

## The model

### On disk

```yaml
schema: 7
key: days_since_watered
name: Days since watered
format: number
compute:
  kind: formula
  expression: "days(last_completed_at, today())"
```

```yaml
schema: 7
key: related_plants
name: Related plants
format: number
compute:
  kind: rollup
  relation: related_plant
  aggregate: count
```

```yaml
schema: 7
key: related_titles
name: Related titles
format: list
compute:
  kind: rollup
  relation: related_plant
  property: title
  aggregate: list
```

`PropertyDef.compute` is optional and serialized last, so every schema-6 property file keeps its
byte-for-byte shape until a computed definition is written. The Rust shape is flat rather than an
internally tagged enum, matching `target_type`/`multi` and keeping validation in one authority:

```rust
pub struct ComputeDef {
    pub kind: ComputeKind,                        // Formula | Rollup
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expression: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relation: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub property: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub aggregate: Option<Aggregate>,             // Count | Sum | Min | Max | List
}
```

`validate_definition` rejects every field that does not belong to the chosen kind, so the flat
shape never leaks a nonsensical definition to the evaluator.

### API

`PropertyDef` JSON gains:

```json
{
  "key": "days_since_watered",
  "name": "Days since watered",
  "format": "number",
  "compute": { "kind": "formula", "expression": "days(last_completed_at, today())" }
}
```

A table row's `values` carries computed values exactly like stored ones:

```json
{
  "days_since_watered": { "value": 3, "label": "3" },
  "related_plants": { "value": 1, "label": "1" },
  "related_titles": { "value": ["Monstera", "Fern"], "label": "Monstera, Fern" }
}
```

An object read merges every computed member of its type into `properties`; a computed value wins
over a hand-edited stored value for the same key, including when the computed value is empty (the
stored key is then dropped from the projection, never shown as a fallback). An empty computed value
is omitted, matching the unset-key invariant. `count` returning `0` is a present value.

## The formula language

Grammar, lowest precedence first:

```
expr       := or
or         := and ("or" and)*
and        := not ("and" not)*
not        := "not" not | comparison
comparison := additive (("=" | "!=" | "<" | "<=" | ">" | ">=") additive)?
additive   := multiplicative (("+" | "-") multiplicative)*
multiplicative := unary (("*" | "/" | "%") unary)*
unary      := "-" unary | primary
primary    := number | string | "true" | "false" | ident
            | ident "(" [expr ("," expr)*] ")"
            | "(" expr ")"
```

- **Literals:** decimal numbers (`1`, `2.5`; no exponents needed), double-quoted strings with `\"`
  and `\\` escapes, `true`, `false`. Single quotes are not a second spelling.
- **References:** a property key of the owning type, or `title`. Schedule keys (`due_date`,
  `last_completed_at`) are usable on a scheduled type. A reference to a multi-value property
  (`multi_select`, `attachments`, `relation`, `recurrence`, `list`) is a definition error.
  Keywords and function names (`and`, `or`, `not`, `true`, `false`, `today`, …) shadow a property
  key with the same spelling; such a key cannot be referenced. A reference reads the **stored**
  value: a select contributes its option key, and a file/image contributes its path. A formula
  that needs display text has to build it (for example `room + " / " + shelf`).
- **Operators:** `+ - * / %`, unary `-`, comparisons, `and`, `or`, `not`. `+` adds numbers and
  concatenates when either side is text; every other arithmetic operator is number-only.
- **Functions:** `if(cond, a, b)` (lazy), `round(x[, digits])`, `abs(x)`, `min(x, y, ...)`,
  `max(x, y, ...)`, `length(text)`, `lower(text)`, `upper(text)`, `days(a, b)` (whole calendar days
  from `a` to `b`, either side a date or datetime), `today()` (a date in the space's zone).
- **Limits:** expression at most 500 characters, 512 tokens and 32 nesting levels. Parsing is a
  hand-written lexer + Pratt parser; no `eval`, no dependency.
- **Types:** `text`, `number`, `checkbox`, `date`, `datetime`. The static checker maps each stored
  property's `format` to one of those, infers each operator and function result, and refuses a
  formula whose inferred type differs from the declared `format`. `if` requires both branches to
  infer the same type. A type mismatch is a definition error, not an all-empty column.
- **Runtime:** an unset operand, division by zero and a malformed stored date produce an empty
  result. `if` treats an empty condition as false. `and`/`or` treat empty as false. Text equality
  is case-insensitive, matching `value::text_equals`; ordering is the existing `value::compare`.
- **Formatting:** string concatenation renders a number without a trailing `.0`, a boolean as
  `true`/`false`, and a date/datetime exactly as stored.

## Rollup rules

- `relation` must name a **stored** `relation` property carried by the owning type. It may be
  single- or multi-valued.
- `property` names a property carried by the relation's target type, or `title`.
- `count` takes no `property`; every other aggregate requires one.
- `count` is a number; `sum` requires a number target; `min`/`max` require a number, date or
  datetime target; `list` produces the `list` format.
- `sum`, `min` and `max` require the relation to declare a `target_type`, so the target property's
  format is unambiguous. `count` and `list` may target any type; evaluation skips a target whose
  type does not carry the named property.
- Targets are de-duplicated by id, preserving relation order. Trashed targets resolve (consistent
  with relation labels); purged ids are skipped. `list` de-duplicates labels and preserves first
  occurrence.
- `list` accepts target formats that produce one label each: text, number, checkbox, date,
  datetime, select, url, email, file, image, relation and `title`. It refuses multi-select,
  attachments, recurrence and list because one target would contribute several or no meaningful
  labels. A `list` is a text list: `contains` and sorting compare labels as text, not as the
  target values' types.

## Checkpoints

The plan file is already written; checkpoint 1 starts with the model change.

### Checkpoint 1 — Schema 7: `compute`, `list`, and read-only enforcement

- `crates/core/src/lib.rs`: `FORMAT_VERSION = 7`; rename the version test to
  `format_version_is_seven_and_still_reads_one` and assert 7.
- `crates/core/src/model.rs`: `PropertyFormat::List` after `Attachments`; `ComputeKind`,
  `Aggregate`, `ComputeDef`; `PropertyDef.compute: Option<ComputeDef>` last, with
  `#[serde(default, skip_serializing_if = "Option::is_none")]`; a `PropertyDef::is_computed()`
  helper.
- `crates/core/src/value.rs`: `parse_value(List) = string_list`, `expected(List) = "a list of
  values"`, the generic list comparison already covers `List`, and `rank` is unchanged. Add a
  public `plain(&Value) -> String` and move the server's integral-number rendering here, so formula
  concatenation, rollup labels and `routes/values.rs` share one spelling.
- `crates/core/src/validate.rs`:
  - `variant_matches(List) => matches!(value, Value::List(_))`.
  - `validate_object` refuses any computed key present in `doc.properties` with
    `"is computed and read-only"` before the format check.
  - `validate_members` refuses a computed member with `required: true`:
    `"a calculated property cannot be required"`.
  - `validate_condition` allows only `contains`, `not_contains`, `is_empty` and `is_not_empty` for
    a `list` column; any other op is
    `invalid(key, "supports only contains, not_contains, is_empty and is_not_empty")`.
  - `takes_lists(List) = false`; `contains` expects a scalar text.
- `crates/core/src/csv.rs`: `parse_cell(List)` returns
  `Err("a list result is calculated and cannot be imported")`; the format match stays exhaustive.
- `crates/core/src/markdown.rs`: the property round-trip test gains `List` and a computed
  definition; the schema-6 literal becomes 7.
- Every `PropertyDef { ... }` literal in `crates/` gains `compute: None`; the compiler is the
  checklist.
- Fixtures: every `schema: 6` becomes `schema: 7`; `invalid/schema_7.md` becomes
  `invalid/schema_8.md` with `schema: 8`; add
  `property_days_since_watered.yml` (formula) and `property_related_titles.yml` (list rollup).
  `crates/core/tests/roundtrip.rs`: `current()` matches `"schema: 7"`, the expected fixture names
  include the two new files, and the schema-6 expectations move up by one.

**Acceptance:** a schema-6 space loads and rewrites as schema 7; both new property fixtures
round-trip byte for byte; `format: list` parses and serializes; a stored value on a computed key is
refused; a required computed member is refused; the filter validator refuses `equal` on a list.

**Tests:** value/validate/csv unit cases; roundtrip over the new and updated fixtures; a compiled
`PropertyDef` comparison still works.

**Files:** `lib.rs`, `model.rs`, `value.rs`, `validate.rs`, `csv.rs`, `markdown.rs`,
`crates/core/tests/fixtures/`, `crates/core/tests/roundtrip.rs`, plus `compute: None` in every
constructor.

### Checkpoint 2 — The formula language

- New `crates/core/src/formula.rs`:
  - `Lexer` with spans over the grammar above; identifiers are `[a-z][a-z0-9_]*`.
  - `Expr` AST with `Debug`, `Clone`, `PartialEq`.
  - `pub fn parse(expression: &str) -> Result<Expr, CoreError>`; every parse error is
    `ValidationFailed { field: "compute.expression", message: "… at character N" }`.
  - `pub enum ValueType { Text, Number, Checkbox, Date, DateTime }` and
    `pub fn infer(expr: &Expr, context: &TypeContext) -> Result<ValueType, CoreError>`, where
    `TypeContext` resolves a reference key to a `ValueType` or an error.
  - `pub struct EvalContext<'a> { properties, formats, title, today, timezone }` and
    `pub fn eval(expr: &Expr, context: &EvalContext) -> Option<Value>`; evaluation is non-panicking
    and returns `None` for every runtime mismatch.
  - `pub fn references(expr: &Expr) -> BTreeSet<&str>` and
    `pub fn rewrite(expression: &str, old: &str, new: &str) -> Option<String>`; rewrite replaces
    identifier tokens by span, preserving whitespace, quotes and every other token.
  - Constants `MAX_EXPRESSION_LEN = 500`, `MAX_TOKENS = 512`, `MAX_DEPTH = 32`.
- `crates/core/src/lib.rs`: `pub mod formula;`.
- Tests in `formula.rs`:
  - precedence (`1 + 2 * 3`, `not a and b`, `a < b or c < d`, unary minus);
  - string escapes, text concatenation and number/date rendering;
  - comparisons across text/date/datetime/checkbox/number;
  - `if` laziness and empty-condition behavior;
  - `round`/`abs`/`min`/`max`/`length`/`lower`/`upper`/`days`/`today`;
  - division by zero, unset operand, malformed stored date → `None`;
  - static type errors: unknown ref, list ref, wrong branch types, wrong result type, wrong arity;
  - `references` and `rewrite` (a key inside a string is not rewritten; a longer key is not
    partially rewritten).

**Acceptance:** the grammar evaluates exactly as specified; every static error names
`compute.expression`; a rewrite changes only the identifier tokens the parser saw.

**Tests:** the module's table-driven cases.

**Files:** `crates/core/src/formula.rs`, `crates/core/src/lib.rs`.

### Checkpoint 3 — The compute engine over the index

- New `crates/core/src/compute.rs`:
  - `pub fn validate_definition(def: &PropertyDef) -> Vec<CoreError>`: kind/field combinations,
    formula length and syntax, aggregate/`format` pairs, `list` computed-only, and the allowed
    result formats for each kind.
  - `pub fn validate_for_type(schema: &Schema, type_def: &TypeDef, property: &PropertyDef) ->
    Vec<CoreError>`: formula references must resolve to stored single-value members (or `title`);
    the inferred type must equal `property.format`; a rollup's relation must be a stored relation
    member; the target type/property and aggregate must agree. A `list` property is valid only as
    a rollup `list`.
  - `pub struct Evaluator<'a> { index: &'a SpaceIndex, today: Date, timezone: TimeZone }` with
    `new(index, timezone, now)`, `value(doc, def) -> Option<Value>`,
    `values(doc) -> BTreeMap<String, Value>` (every computed member of the type) and
    `summaries(type_key, needed: &BTreeSet<&str>) -> Vec<ObjectSummary>` (clones, removes any
    stored value for each named computed key, evaluates only those keys, and inserts the computed
    value when it is non-empty). It compiles each formula once per evaluator (one request), not
    once per row, and keeps no cache in the index.
  - Rollup helpers: relation ids, target de-duplication, aggregate, label rendering; `list` labels
    use option names, target titles and file basenames, never raw keys.
  - `pub struct ComputedProblem { property_key, type_key, field, message }` and a
    `rollup_targets(type_key)` / `referenced_keys()` scan used by the routes.
- `crates/core/src/index.rs`: `Problems.computed_problems: Vec<ComputedProblem>`; `problems()`
  fills it from `validate_definition` for every declared property and `validate_for_type` for every
  type member.
- `crates/core/src/validate.rs`: `validate_members` takes the whole `TypeDef` (not just the member
  slice) and appends `compute::validate_for_type` for every computed member. Update the one server
  call site and the core test.
- Tests:
  - formula over stored values, schedule keys and `title`;
  - rollup count/sum/min/max/list, single and multi relations, absent target property, trashed
    target, purged target, duplicate ids, empty set;
  - `summaries` evaluates only the requested keys, drops a stored value on a computed key, and
    leaves every stored key untouched;
  - `Problems.computed_problems` reports an unknown reference and a bad aggregate without taking
    the space offline.

**Acceptance:** an index over a temp space returns the specified values for a formula and each
aggregate; a rollup over a trashed target still counts it; a hand-edited invalid definition is a
problem and evaluates to empty, not a panic.

**Tests:** `compute.rs` unit tests plus index tests over `tempfile` spaces.

**Files:** `crates/core/src/compute.rs`, `lib.rs`, `index.rs`, `validate.rs`.

### Checkpoint 4 — Server: definitions, reads and write refusal

- `crates/server/src/routes/properties.rs`:
  - `CreatePropertyRequest` and `PatchPropertyRequest` gain `compute: Option<ComputeDef>`.
  - Create calls `compute::validate_definition` through `check_shape`; PATCH accepts `compute` only
    for an already-computed property and refuses a `kind` change with
    `"the calculation kind is fixed once the property exists"`.
  - PATCH revalidates the candidate against every type that carries the key with
    `compute::validate_for_type`; a single error refuses the write before the file changes.
  - `check_shape` also refuses `format: list` without a compute block and computed formats that
    cannot match the kind.
- `crates/server/src/routes/types.rs`: `check_type`/`check_members` pass the whole `TypeDef` so
  `validate_members` runs the computed-reference checks; type deletion refuses a rollup whose
  `target_type` is the deleted type with a `409` naming the property.
- `crates/server/src/routes/values.rs`:
  - `Projection` owns an `Evaluator` built from its `now` and the space zone.
  - `object_json` includes every computed member, computed value first; `ordered_keys` includes a
    computed member even when the file has no key.
  - `value_json` gains the `List` arm (labels joined with `", "`); `plain` delegates to
    `value::plain`.
- `crates/server/src/routes/objects.rs`: the list route resolves filters/sorts first, builds the
  needed set from `value_columns(view)` plus every filter/sort key, calls
  `Evaluator::summaries`, then runs the existing `query::apply` and pages. Create/update/duplicate
  validation already refuses computed keys through `validate_object`; add a route test that proves
  it. Detail reads use the extended `object_json`.
- `crates/server/src/routes/mod.rs`: `problems_json` adds `computed_problems` in the
  `{property, type, field, message}` shape.
- Tests beside the existing route tests: create a formula and a rollup; add both to a type; list
  returns their values; filter and sort by each; a viewer reads; an editor's PATCH to a computed
  key is `422`; a type that adds a formula with an unknown ref is `422`; a `list` label is the
  joined display text; the object read carries computed values.

**Acceptance:** the API examples above are the observed responses; a formula and every aggregate
survive the round trip from property creation to a sorted, filtered table read; a stored computed
value is refused.

**Files:** `routes/properties.rs`, `routes/types.rs`, `routes/values.rs`, `routes/objects.rs`,
`routes/mod.rs` (tests).

### Checkpoint 5 — Lifecycle: rename, delete and CSV

- `crates/core/src/store/fs.rs`:
  - `rename_property_key` adds a pass over `SpaceFileKind::Property` that rewrites every other
    property's `compute` with `formula::rewrite` and by direct equality on `relation`/`property`.
    It writes the definition first, then the consumers, then removes the old file, preserving the
    existing crash ordering.
  - `remove_property_key` gains no stripping logic: the route refuses first.
- `crates/server/src/routes/properties.rs`: removal scans every property whose formula references
  the key or whose rollup names it as `relation`/`property` and returns
  `409 { reason: "computed properties use property", properties: [...] }`; `force` does not
  override. The message names each holder.
- `crates/server/src/routes/csv.rs` and `crates/core/src/csv.rs`:
  - `codec::export` takes `&[ExportRow { doc, computed }]` and reads `computed` before the stored
    map; the route builds one row per live record with the evaluator.
  - Import accepts a computed header but a non-empty cell is a row problem
    `"is calculated and read-only"`; an empty computed column imports normally.
  - Export of a `list` remains a JSON array of labels; export of a `recurrence` is unchanged.
- Tests: renaming a stored property rewrites a formula and a rollup target in the property files;
  renaming a relation rewrites the rollup; deleting a referenced property is `409` with `force`;
  deleting a referenced target type is `409`; CSV export contains computed values; import refuses a
  non-empty computed cell and accepts an empty one.

**Acceptance:** a rename moves every reference in one write and the space rebuilds green; an
attempt to delete a reference leaves the file untouched and names the holder; export/import behave
as specified.

**Files:** `store/fs.rs`, `routes/properties.rs`, `routes/csv.rs`, `core/csv.rs`, route tests.

### Checkpoint 6 — Web: computed values on every read surface

- `web/src/api/types.ts`: `PropertyFormat` gains `"list"`; `ComputeKind`, `Aggregate`, `ComputeDef`;
  `PropertyDef.compute?: ComputeDef`.
- `web/src/lib/schema.ts`: `PROPERTY_FORMATS` gains `{ value: "list", label: "List" }`; export
  `STORED_FORMATS` (every format except `list`) and `RESULT_FORMATS` (text, number, checkbox, date,
  datetime, list) so the create form never offers `list` for a stored property. Add
  `isComputed(property)`, `writableProperties(properties)` (drops computed definitions),
  `computeDescription(property, properties)` and
  `rollupResultFormat(aggregate, targetFormat)` helpers. `captureFields` filters computed
  properties out, so quick capture never asks for a value the server will refuse.
- `web/src/components/quick-capture.tsx` and `web/src/components/bulk-bar.tsx`: both use the
  writable property set; a computed column is never a capture input or a bulk-edit target.
- `web/src/lib/format.ts`: `valueLabel` `list` arm joins with `", "`; `parseCellText` leaves list
  text as text; `plain` already handles arrays.
- `web/src/lib/filter.ts`: `operatorsFor("list") = ["contains", "not_contains", "is_empty",
  "is_not_empty"]`; make the switch exhaustive.
- `web/src/components/property-cell.tsx`: a computed property renders a read-only cell
  (`aria-readonly="true"`, no edit button, no pointer affordance) with `PropertyValue`; the cell's
  `title` carries `computeDescription`. `PropertyValue` gains a `list` arm (joined text). The type
  table's header shows a small `=`/sigma marker for a computed column, with
  `aria-label="Calculated column"`.
- `web/src/components/property-field.tsx`: a computed property renders a read-only field with the
  value and `computeDescription` beneath it; `canEdit` never turns it into an input.
  `web/src/components/property-input.tsx` returns a read-only note if it is ever handed a computed
  property (defensive, never reached).
- `web/src/components/views/board-view.tsx`, `gallery-view.tsx`: computed members already print
  through `values`; confirm list labels and number/date formatting. Calendar's `date_property` may
  name a computed date; no code change beyond the projection.
- Tests: a computed cell has no edit button and announces itself read-only; a list renders its
  labels; `valueLabel` list; `operatorsFor` list; filter/sort on a computed column reaches the
  server with the right key.

**Acceptance:** a table with a formula and a rollup column shows both, filters and sorts by them,
and the record page shows the same values with no input; a viewer sees the same values read-only.

**Files:** `api/types.ts`, `lib/schema.ts`, `lib/format.ts`, `lib/filter.ts`,
`components/property-cell.tsx`, `components/property-field.tsx`,
`components/property-input.tsx`, `components/views/table-view.tsx`,
`components/views/board-view.tsx`, `components/views/gallery-view.tsx`,
`components/type-table.tsx`, `components/quick-capture.tsx`, `components/bulk-bar.tsx`.

### Checkpoint 7 — Web: authoring formulas and rollups

- New `web/src/components/schema/computed-fields.tsx`:
  - A `Stored | Formula | Rollup` choice (the kind is hidden when editing an existing computed
    property), a result-type select, and the fields for the chosen kind. A formula offers text,
    number, checkbox, date and date-time; `list` appears only for a rollup with `aggregate: list`.
  - Formula: a mono textarea (max 500), a short grammar help disclosure, and examples
    (`days(last_completed_at, today())`, `price * quantity`, `if(stock > 0, "In stock", "Out")`).
  - Rollup: relation select (relation properties, narrowed to the type when one is supplied),
    aggregate select, target property select (title plus the property library; narrowed to the
    target type's members when that type is available; disabled for `count`), and a result-type
    select that follows the aggregate and target format.
  - Client checks only empty required fields and length; the server is the authority on syntax,
    references and type compatibility.
- `web/src/components/schema/property-list.tsx`: the create form uses `STORED_FORMATS` for a stored
  property and shows `ComputedFields` when the user chooses a calculated property; the create
  payload carries `format` and `compute`. The list shows a `Calculated` chip and the result format.
- `web/src/components/add-property.tsx`: the "new" mode gains the same `Stored | Formula | Rollup`
  choice; a formula/rollup is created with the type context, so the relation choices are the type's
  own relations. The stored-format select uses `STORED_FORMATS`. The existing three-stage resume is
  unchanged; a type-stage validation error leaves the property in the library for repair and offers
  a link to the schema page.
- `web/src/components/schema/property-editor.tsx`: a computed property shows `ComputedFields` in
  edit mode (kind fixed), saves through `useUpdateProperty` with `compute`, and hides the option
  editor. The Format row shows the result type. `web/src/pages/schema.tsx` passes the whole
  property library to the editor so the rollup selects can name a relation and its target
  property. A `409` removal refusal with `reason: "computed properties use property"` renders the
  named holder list and disables delete, instead of being mistaken for an unused property.
- `web/src/components/schema/type-editor.tsx`: the member chip reads the result format plus
  `Calculated`; adding an existing computed property that does not validate for this type surfaces
  the server's `422` in the existing error slot.
- `web/src/api/queries.ts`: `NewProperty` gains `compute?: ComputeDef`; `UpdateProperty` gains
  `compute?: ComputeDef`.
- Tests: create a formula from the add-property dialog; switch to rollup and derive the result
  type; edit an expression and see the saved definition; a server `422` is shown in the right
  stage; the property list never offers `list` for a stored property.

**Acceptance:** a user can create both kinds from the table add-property dialog, edit the
definition from the schema page, and see the new column on the type page without a reload.

**Files:** `components/schema/computed-fields.tsx`, `components/schema/property-list.tsx`,
`components/add-property.tsx`, `components/schema/property-editor.tsx`,
`components/schema/type-editor.tsx`, `pages/schema.tsx`, `api/queries.ts`.

### Checkpoint 8 — Version, docs, seed and release QA

- `Cargo.toml`, `web/package.json`, `web/package-lock.json` → `0.8.0`;
  `web/src/content/changelog.ts` gains a `0.8.0` entry "Calculated columns" with formulas,
  rollups, read-only cells, filter/sort/CSV behavior and the two seed examples.
- `docs/ROADMAP.md`: the M8 entry points at this plan, states schema 7 and `v0.8.0`, and records
  what landed.
- `README.md`: the property-format list, a short calculated-property section with the formula
  grammar and the rollup rules, the backup note (computed values are not files), `schema: 7`.
- `PRODUCT.md`: Type/Property/Object/Value still holds; a calculated column is a property whose
  value the app derives, never one it stores.
- `DESIGN.md`: the computed cell marker, read-only field treatment and list chips; one visual
  language for formula and rollup descriptions.
- `AGENTS.md`: current state through M8, the plan-table row for this file, `FORMAT_VERSION = 7`.
- `scripts/seed.sh`: add `days_since_watered` (formula number) and `related_plants` (rollup count)
  to the Plant type and its default view, after the type's relation property exists. Seed against a
  disposable space only; the fixed dev account and `./data` are untouched.
- Release QA: contact sheet at 390 / 768 / 1024 / 1440 in both schemes over the table's computed
  columns, the record panel, the schema create/edit form, the filter/sort panel and the CSV data
  panel; store it in `.impeccable/critique/` beside the release sheet.

**Acceptance:** `cargo test --workspace` and the web gate are green; the seed builds a space whose
Plant table shows both calculated columns; the contact sheet shows no clipped cells or labels.

**Files:** version files, changelog, `docs/ROADMAP.md`, `README.md`, `PRODUCT.md`, `DESIGN.md`,
`AGENTS.md`, `scripts/seed.sh`.

## Critical files & anchors

| File | Role |
|---|---|
| `crates/core/src/model.rs` | `PropertyDef.compute`, `ComputeDef`, `PropertyFormat::List` |
| `crates/core/src/formula.rs` | lexer, parser, static type checker, evaluator, reference rewrite |
| `crates/core/src/compute.rs` | definition validation, per-type validation, formula/rollup evaluation |
| `crates/core/src/value.rs` | `list` conversion, ordering and the one `plain` renderer |
| `crates/core/src/validate.rs` | computed-key refusal, required refusal, list filter ops, member checks |
| `crates/core/src/index.rs` | evaluated summaries, computed problems |
| `crates/core/src/csv.rs` | export rows with computed values, import refusal |
| `crates/core/src/store/fs.rs` | key rename rewrites compute references |
| `crates/server/src/routes/properties.rs` | definition create/patch, computed-holder refusal |
| `crates/server/src/routes/types.rs` | type membership validation, target-type deletion guard |
| `crates/server/src/routes/values.rs` | projection merges computed values |
| `crates/server/src/routes/objects.rs` | list augmentation before filter/sort/page |
| `web/src/components/property-cell.tsx` | read-only computed cell and list value |
| `web/src/components/schema/computed-fields.tsx` | shared formula/rollup authoring |
| `web/src/components/add-property.tsx` | create a calculated column from the table |

## Verification

Rust gate, from the repository root:

```sh
cargo build --workspace
cargo test --workspace
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
```

Web gate, from `web/`:

```sh
npm run test:run
npm run lint
npm run typecheck
npm run build
```

API smoke, when a server is running:

```sh
# A formula and a rollup appear in the list read with their labels.
curl -b cookies.txt 'http://127.0.0.1:8080/api/spaces/<space>/objects?type=plant&view=all' | jq '.objects[0].values'

# CSV export carries the computed columns; a non-empty imported cell is refused.
curl -b cookies.txt 'http://127.0.0.1:8080/api/spaces/<space>/csv/plant' | head -1
```

Browser QA: `/s/<space>/t/plant` (table, filter, sort), `/s/<space>/o/<id>` (record fields),
`/s/<space>/schema` (create and edit both kinds), the data panel's CSV preview, and a phone
viewport (390 × 844) for the read-only cell and the authoring form. Tests alone are not the gate.

## Assumptions & contingencies

- **No new dependency.** The lexer/parser is hand-written; the static checker is a small recursive
  pass. If a dependency looks tempting, stop and ask rather than changing a locked decision.
- **Per-request evaluation is the M8 design.** `Evaluator::summaries` evaluates only the computed
  keys the view, filter and sorts name. If a real space shows a hot spot, an index-side cache is a
  later optimisation, not a scope change; correctness first.
- **A formula's static type is checked at type membership, not at property creation.** A property
  can be created before the type that carries it; the type PATCH is the authority on references.
- **A stored value on a computed key is a hand-edit.** The read projection drops it, the next
  write refuses it, and the definition problems in `computed_problems` are reported separately;
  no per-record scan is added for it.
- **`days()` and `today()` use the space's zone.** A datetime is converted to its calendar date in
  that zone before the whole-day subtraction; this is the same rule the schedule engine uses.
- **A rollup's `list` labels are display text, not keys.** The client never re-resolves them; the
  server's label and a list entry are the same spelling.
- **No physical device is attached to this machine.** Phone QA is emulation plus measured DOM; the
  v0.4.3 physical-iPhone gate remains open and still precedes any keyboard claim.

## What M9 inherits

M9's property-model depth extends this milestone rather than replacing it: validation and defaults
validate the stored side of a property, and a rollup filter is a `ComputeDef` field evaluated by
the same engine. The formula module stays the single expression implementation, so M11's agent
surface exposes `compute` on the property DTO and marks computed values read-only in the generated
OpenAPI document without re-deriving anything. M14's desktop shell links the same evaluator:
computed values are not in the markdown, so sync never carries them.
