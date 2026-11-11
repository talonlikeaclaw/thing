import { Plus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";

import { useRelationChoices } from "@/api/queries";
import type {
  CondOp,
  Condition,
  Filter,
  FilterOp,
  PropertyDef,
  PropertyFormat,
  TypeDef,
} from "@/api/types";
import { ThumbRow } from "@/components/handedness";
import { ChoicePicker } from "@/components/choice-picker";
import { PropertyPicker } from "@/components/property-picker";
import { RecurrenceInput } from "@/components/recurrence-input";
import { Button } from "@/components/ui/controls";
import { ViewPanel } from "@/components/ui/view-panel";
import {
  columnChoice,
  filterChoices,
  type ColumnChoice,
  completeFilter,
  conditionChipLabel,
  conditionIsComplete,
  conditionKey,
  conditionTakesList,
  conditionTakesValue,
  conditionText,
  CONDITION_LABELS,
  datePresets,
  filterParam,
  hasConditions,
  newCondition,
  operatorsFor,
  parseConditionText,
  quickFilters,
  withConditionOp,
  withConditionValue,
  withConditions,
  withoutConditions,
} from "@/lib/filter";
import { valueLabel } from "@/lib/format";

/** A property row's identity, which the picker needs for anything it lists. */
type PickerProperty = Pick<PropertyDef, "key" | "name" | "format" | "compute">;

const VALUE_FRAME =
  "h-8 min-w-0 flex-1 rounded-[10px] border border-line-interactive/70 bg-raised/40 px-2 text-[12px] text-ink focus:border-accent pointer-coarse:h-11 pointer-coarse:text-[16px]";

const OP_FRAME =
  "h-8 shrink-0 rounded-[10px] border border-line-interactive/70 bg-raised/40 px-1.5 text-[12px] text-ink pointer-coarse:h-11 pointer-coarse:text-[16px]";

interface FilterPanelProps {
  spaceId: string;
  type: TypeDef;
  /** The type's own properties, including the generated schedule ones. */
  properties: PropertyDef[];
  filter: Filter;
  /** What the table's current read matched; the panel says it in words. */
  matched?: number;
  /** The space zone's today, `YYYY-MM-DD`. */
  today: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The Filter button: the popover hangs from it and focus returns to it. */
  anchor: RefObject<HTMLElement | null>;
  onChange: (filter: Filter) => void;
  /** Offered in the footer when the query is unsaved, so a phone can keep it. */
  saveView?: { onSave: () => void; pending: boolean };
}

/**
 * The view's query, edited where it stands: a condition begins with a property
 * and only becomes the URL's filter once it carries everything the server
 * needs. The chips under the toolbar are that filter; this panel is its editor.
 */
export function FilterPanel({
  spaceId,
  type,
  properties,
  filter,
  matched,
  today,
  open,
  onOpenChange,
  anchor,
  onChange,
  saveView,
}: FilterPanelProps) {
  const choices = useMemo(() => filterChoices(type, properties), [type, properties]);
  const pickerProperties = useMemo<PickerProperty[]>(
    () =>
      choices.map((choice) => ({
        key: choice.key,
        name: choice.label,
        format: choice.format,
        // A calculated column is named on the picker chip, so a filter that
        // names one never reads as a stored field.
        compute: properties.find((property) => property.key === choice.key)?.compute,
      })),
    [choices, properties],
  );
  const [draft, setDraft] = useState<Condition[]>(filter.conditions);
  const published = useRef(filterParam(filter));

  // An outside change (a saved view, Reset, a chip, Clear all) replaces the
  // draft; the panel's own writes are already reflected and never reset it.
  useEffect(() => {
    const incoming = filterParam(filter);
    if (incoming === published.current) {
      return;
    }
    published.current = incoming;
    setDraft(filter.conditions);
  }, [filter]);

  function publish(next: Condition[], nextOp: FilterOp = filter.op) {
    setDraft(next);
    const complete = completeFilter({ op: nextOp, conditions: next });
    published.current = filterParam(complete);
    onChange(complete);
  }

  function replace(index: number, conditions: Condition[]) {
    publish(draft.flatMap((existing, at) => (at === index ? conditions : [existing])));
  }

  function remove(index: number) {
    publish(draft.filter((_, at) => at !== index));
  }

  function add() {
    publish([...draft, { property: "", condition: "equal" }]);
  }

  // A shortcut writes ordinary conditions and never stores a marker, so it is
  // on exactly when its conditions are in the query. Drafts keep their place.
  function togglePreset(conditions: Condition[]) {
    const complete = completeFilter({ op: filter.op, conditions: draft });
    const active = hasConditions(complete, conditions);
    const next = active
      ? withoutConditions(complete, conditions)
      : withConditions(complete, conditions);
    const drafts = draft.filter((condition) => !conditionIsComplete(condition));
    publish([...next.conditions, ...drafts]);
  }

  const complete = completeFilter({ op: filter.op, conditions: draft });
  const shorts = type.schedule ? quickFilters(today) : [];

  // Canonical right-handed order; `ThumbRow` puts the primary action on the
  // thumb edge when a left-handed phone is holding the sheet.
  const footer = (
    <ThumbRow className="w-full items-center gap-2">
      <Button
        type="button"
        variant="ghost"
        className="min-h-9 px-3 text-[13px] pointer-coarse:min-h-11"
        disabled={complete.conditions.length === 0}
        onClick={() => publish([], "and")}
      >
        Clear all
      </Button>
      <span aria-hidden className="flex-1" />
      {saveView ? (
        <Button
          type="button"
          className="min-h-9 px-3 text-[13px] pointer-coarse:min-h-11"
          disabled={saveView.pending}
          onClick={saveView.onSave}
        >
          {saveView.pending ? "Saving…" : "Save view"}
        </Button>
      ) : null}
      <Button
        type="button"
        variant={saveView ? "ghost" : undefined}
        className="min-h-9 px-4 text-[13px] pointer-coarse:min-h-11"
        onClick={() => onOpenChange(false)}
      >
        Done
      </Button>
    </ThumbRow>
  );

  return (
    <ViewPanel
      title="Filter"
      count={complete.conditions.length}
      open={open}
      onOpenChange={onOpenChange}
      anchor={anchor}
      footer={footer}
    >
      <p className="text-[12px] text-muted" aria-live="polite">
        {matched === undefined
          ? "Reading records…"
          : `${matched} ${matched === 1 ? "record matches" : "records match"}`}
      </p>

      {shorts.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Quick filters">
          {shorts.map((short) => (
            <button
              key={short.key}
              type="button"
              aria-pressed={hasConditions(complete, short.conditions)}
              className="rounded-full border border-line-interactive/70 bg-raised/40 px-2.5 py-1 text-[12px] text-ink transition-colors hover:border-line-strong aria-pressed:border-accent/60 aria-pressed:bg-accent-wash aria-pressed:text-accent-on-wash pointer-coarse:min-h-11"
              onClick={() => togglePreset(short.conditions)}
            >
              {short.label}
            </button>
          ))}
        </div>
      ) : null}

      {draft.length > 1 ? (
        <div
          className="mt-3 inline-flex items-center gap-0.5 rounded-full border border-line p-0.5"
          role="group"
          aria-label="Match"
        >
          {(
            [
              { op: "and", label: "Match all" },
              { op: "or", label: "Match any" },
            ] as const
          ).map((option) => (
            <button
              key={option.op}
              type="button"
              aria-pressed={filter.op === option.op}
              className="rounded-full px-2.5 py-1 text-[12px] text-muted transition-colors hover:text-ink aria-pressed:bg-accent-wash aria-pressed:text-accent-on-wash pointer-coarse:min-h-11"
              onClick={() => publish(draft, option.op)}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}

      {draft.length === 0 ? (
        <p className="mt-3 text-[13px] text-muted">Every record in this type.</p>
      ) : (
        <ul className="mt-2">
          {draft.map((condition, index) => (
            <ConditionRow
              key={`${condition.property}-${index}`}
              spaceId={spaceId}
              columns={choices}
              pickerProperties={pickerProperties}
              properties={properties}
              today={today}
              condition={condition}
              onChange={(next) => replace(index, next)}
              onRemove={() => remove(index)}
            />
          ))}
        </ul>
      )}

      <Button
        type="button"
        variant="ghost"
        className="mt-2 min-h-8 px-2 text-[12px] pointer-coarse:min-h-11"
        onClick={add}
      >
        <Plus aria-hidden size={13} />
        Add condition
      </Button>
    </ViewPanel>
  );
}

interface ConditionRowProps {
  spaceId: string;
  columns: ColumnChoice[];
  pickerProperties: PickerProperty[];
  properties: PropertyDef[];
  today: string;
  condition: Condition;
  onChange: (conditions: Condition[]) => void;
  onRemove: () => void;
}

/**
 * One condition: the property comes first, and the operator and value only
 * appear once it does. A row without a value stays a draft in the list.
 */
function ConditionRow({
  spaceId,
  columns,
  pickerProperties,
  properties,
  today,
  condition,
  onChange,
  onRemove,
}: ConditionRowProps) {
  const column = columnChoice(columns, condition.property);
  const property = properties.find((candidate) => candidate.key === condition.property);
  const format = column?.format ?? "text";
  const operators = column ? operatorsFor(format) : [];
  const op = operators.includes(condition.condition) ? condition.condition : operators[0];
  const complete = conditionIsComplete(condition);
  const isDate = format === "date" || format === "datetime";
  const listValue =
    format === "select" ||
    format === "multi_select" ||
    format === "relation" ||
    format === "recurrence";
  const needsValue = !complete && op !== undefined && conditionTakesValue(op);

  function pick(key: string) {
    const next = columnChoice(columns, key);
    if (next) {
      onChange([newCondition(next)]);
    }
  }

  return (
    <li className="grid gap-1.5 border-b rule py-2 last:border-b-0">
      <div className="flex items-center gap-1.5">
        <div className="min-w-0 flex-1">
          <PropertyPicker
            properties={pickerProperties}
            value={column ? condition.property : null}
            onChange={pick}
            title="Choose a property to filter by"
          />
        </div>
        <button
          type="button"
          aria-label="Remove condition"
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-faint transition-colors hover:bg-raised hover:text-ink pointer-coarse:size-11"
          onClick={onRemove}
        >
          <X aria-hidden size={13} />
        </button>
      </div>

      {column && op ? (
        <div className="grid gap-1.5">
          <div className="flex flex-wrap items-start gap-1.5">
            <select
              aria-label="Filter condition"
              className={OP_FRAME}
              value={op}
              onChange={(event) =>
                onChange([withConditionOp(condition, event.target.value as CondOp)])
              }
            >
              {operators.map((operator) => (
                <option key={operator} value={operator}>
                  {CONDITION_LABELS[operator]}
                </option>
              ))}
            </select>
            <div className="grid min-w-0 flex-1 gap-1 max-sm:basis-full">
              <ConditionValue
                spaceId={spaceId}
                format={format}
                property={property}
                condition={{ ...condition, condition: op }}
                onChange={(value) =>
                  onChange([withConditionValue({ ...condition, condition: op }, value)])
                }
              />
              {/* A list of options or targets shows its own empty state; only a
                  plain field needs the sentence under it. */}
              {needsValue && !listValue ? (
                <span className="text-[11px] text-faint">Choose a value</span>
              ) : null}
            </div>
          </div>
          {isDate ? (
            <div className="flex flex-wrap gap-1">
              {datePresets(today, format, condition.property).map((preset) => (
                <button
                  key={preset.key}
                  type="button"
                  className="rounded-full border border-line px-2 py-0.5 text-[11px] text-muted transition-colors hover:border-line-strong hover:text-ink pointer-coarse:min-h-9"
                  onClick={() => onChange(preset.conditions)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-[12px] text-faint">Choose a property to filter by.</p>
      )}
    </li>
  );
}

interface ConditionValueProps {
  spaceId: string;
  format: PropertyFormat;
  property: PropertyDef | undefined;
  condition: Condition;
  onChange: (value: unknown) => void;
}

function ConditionValue({
  spaceId,
  format,
  property,
  condition,
  onChange,
}: ConditionValueProps) {
  if (!conditionTakesValue(condition.condition)) {
    return null;
  }
  if (format === "recurrence") {
    return (
      <RecurrenceInput value={condition.value} showHint={false} onApply={(next) => onChange(next)} />
    );
  }
  if (format === "date" || format === "datetime") {
    return <TextValue op={condition.condition} format={format} value={condition.value} onChange={onChange} />;
  }
  if ((format === "select" || format === "multi_select") && property) {
    return (
      <ChoicePicker
        label={`Filter ${property.name} value`}
        choices={(property.options ?? []).map((option) => ({
          id: option.key,
          label: option.name,
        }))}
        multiple={conditionTakesList(condition.condition)}
        value={condition.value}
        onChange={onChange}
      />
    );
  }
  if (format === "relation" && property) {
    return (
      <RelationValue
        spaceId={spaceId}
        property={property}
        multiple={conditionTakesList(condition.condition)}
        value={condition.value}
        onChange={onChange}
      />
    );
  }
  if (format === "checkbox") {
    return (
      <select
        aria-label="Filter value"
        className={VALUE_FRAME}
        value={typeof condition.value === "boolean" ? String(condition.value) : ""}
        onChange={(event) =>
          onChange(event.target.value === "" ? null : event.target.value === "true")
        }
      >
        <option value="">Choose…</option>
        <option value="true">Checked</option>
        <option value="false">Unchecked</option>
      </select>
    );
  }
  return (
    <TextValue
      op={condition.condition}
      format={format}
      value={condition.value}
      onChange={onChange}
    />
  );
}

/** A text field that keeps invalid input on screen instead of dropping it. */
function TextValue({
  op,
  format,
  value,
  onChange,
}: {
  op: CondOp;
  format: PropertyFormat;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const external = conditionText(value);
  const [text, setText] = useState(external);
  useEffect(() => setText(external), [external]);

  function commit() {
    // An empty field is a draft, not a value: the row stays visible and the
    // condition leaves the query instead of being sent as "".
    if (text.trim() === "") {
      onChange(null);
      return;
    }
    const parsed = parseConditionText(op, format, text);
    if (parsed !== undefined) {
      onChange(parsed);
    }
  }

  return (
    <input
      aria-label="Filter value"
      className={VALUE_FRAME}
      type={format === "number" ? "number" : format === "date" ? "date" : "text"}
      placeholder={format === "datetime" ? "YYYY-MM-DDTHH:MM:SSZ" : "Value"}
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        }
      }}
    />
  );
}

function RelationValue({
  spaceId,
  property,
  multiple,
  value,
  onChange,
}: {
  spaceId: string;
  property: PropertyDef;
  multiple: boolean;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const { choices, loading } = useRelationChoices(spaceId, property, true);
  return (
    <ChoicePicker
      label={`Filter ${property.name} target`}
      choices={choices.map((choice) => ({
        id: choice.id,
        label: choice.title,
        hint: choice.type,
      }))}
      multiple={multiple}
      loading={loading}
      value={value}
      onChange={onChange}
    />
  );
}

interface FilterChipsProps {
  spaceId: string;
  type: TypeDef;
  properties: PropertyDef[];
  filter: Filter;
  onChange: (filter: Filter) => void;
}

/**
 * The query's visible state: one chip per complete condition, in order, with
 * Clear all at the end. A chip removes exactly its own condition.
 */
export function FilterChips({
  spaceId,
  type,
  properties,
  filter,
  onChange,
}: FilterChipsProps) {
  const choices = useMemo(() => filterChoices(type, properties), [type, properties]);
  const conditions = filter.conditions;
  if (conditions.length === 0) {
    return null;
  }
  return (
    <div
      className="mt-2 flex w-full items-center gap-1.5 overflow-x-auto pb-0.5"
      role="list"
      aria-label="Active filters"
    >
      {conditions.map((condition) => (
        <ConditionChip
          key={conditionKey(condition)}
          spaceId={spaceId}
          column={columnChoice(choices, condition.property)}
          property={properties.find((candidate) => candidate.key === condition.property)}
          condition={condition}
          onRemove={() =>
            onChange({
              op: filter.op,
              conditions: filter.conditions.filter(
                (existing) => conditionKey(existing) !== conditionKey(condition),
              ),
            })
          }
        />
      ))}
      <button
        type="button"
        className="shrink-0 px-1 text-[12px] text-muted underline decoration-line-strong hover:text-ink pointer-coarse:min-h-11"
        onClick={() => onChange({ op: filter.op, conditions: [] })}
      >
        Clear all
      </button>
    </div>
  );
}

/** One condition as a worded, removable chip. */
function ConditionChip({
  spaceId,
  column,
  property,
  condition,
  onRemove,
}: {
  spaceId: string;
  column: ColumnChoice | undefined;
  property: PropertyDef | undefined;
  condition: Condition;
  onRemove: () => void;
}) {
  const format = column?.format ?? "text";
  // Called for every chip, enabled only for a relation, so the hook order is
  // stable and a plain chip costs no request.
  const { choices, loading } = useRelationChoices(spaceId, property, format === "relation");
  const titles = new Map(choices.map((choice) => [choice.id, choice.title]));
  // A target whose title has not arrived yet is pending, not a UUID on screen.
  const pending =
    format === "relation" &&
    loading &&
    (Array.isArray(condition.value)
      ? condition.value.some((id) => typeof id === "string" && !titles.has(id))
      : typeof condition.value === "string" && !titles.has(condition.value));
  const label = conditionChipLabel(
    column,
    condition,
    pending ? "…" : valueLabel(format, condition.value, property, titles),
  );
  return (
    <span
      role="listitem"
      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-line bg-raised/40 py-0.5 pl-2.5 pr-0.5 text-[12px] text-ink"
    >
      <span className="whitespace-nowrap">{label}</span>
      <button
        type="button"
        aria-label={`Remove filter: ${label}`}
        className="grid size-6 shrink-0 place-items-center rounded-full text-faint transition-colors hover:bg-surface hover:text-ink pointer-coarse:size-11"
        onClick={onRemove}
      >
        <X aria-hidden size={12} />
      </button>
    </span>
  );
}

