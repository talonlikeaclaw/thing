import { Plus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useRelationChoices, useSpace } from "@/api/queries";
import type {
  CondOp,
  Condition,
  Filter,
  FilterOp,
  PropertyDef,
  PropertyFormat,
  TypeDef,
} from "@/api/types";
import { ChoicePicker } from "@/components/choice-picker";
import { PropertyPicker } from "@/components/property-picker";
import { RecurrenceInput } from "@/components/recurrence-input";
import { Button } from "@/components/ui/controls";
import {
  columnChoice,
  completeFilter,
  conditionIsComplete,
  conditionTakesList,
  conditionTakesValue,
  conditionText,
  CONDITION_LABELS,
  datePresets,
  filterChoices,
  filterParam,
  newCondition,
  operatorsFor,
  parseConditionText,
  withConditionOp,
  withConditionValue,
  type ColumnChoice,
} from "@/lib/filter";

/** A property row's identity, which the picker needs for anything it lists. */
export type PickerProperty = Pick<
  PropertyDef,
  "key" | "name" | "format" | "compute"
>;

const VALUE_FRAME =
  "h-8 min-w-0 flex-1 rounded-[10px] border border-line-interactive/70 bg-raised/40 px-2 text-[12px] text-ink focus:border-accent pointer-coarse:h-11 pointer-coarse:text-[16px]";

const OP_FRAME =
  "h-8 shrink-0 rounded-[10px] border border-line-interactive/70 bg-raised/40 px-1.5 text-[12px] text-ink pointer-coarse:h-11 pointer-coarse:text-[16px]";

export interface ConditionRowProps {
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
 *
 * The view's filter panel and a rollup's target filter render this same row,
 * so the two queries are edited with the same grammar.
 */
export function ConditionRow({
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
    format === "member" ||
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
  if (format === "member" && property) {
    return (
      <MemberValue
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

/** A member condition picks a person by name and carries the id, like a cell. */
function MemberValue({
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
  const space = useSpace(spaceId);
  return (
    <ChoicePicker
      label={`Filter ${property.name} value`}
      choices={(space.data?.members ?? []).map((person) => ({
        id: person.user,
        label: person.name,
        hint: person.email ?? undefined,
      }))}
      multiple={multiple}
      loading={space.isPending}
      value={value}
      onChange={onChange}
    />
  );
}

interface FilterConditionsProps {
  spaceId: string;
  type: TypeDef;
  properties: PropertyDef[];
  filter: Filter;
  today: string;
  onChange: (filter: Filter) => void;
  /** What an empty filter means here; the view and a rollup say it differently. */
  empty: string;
}

/**
 * A filter's editable condition list, for surfaces that own a plain `Filter`
 * rather than the view panel's draft and shortcut state. A half-built row stays
 * on screen but never enters the published filter.
 */
export function FilterConditions({
  spaceId,
  type,
  properties,
  filter,
  today,
  onChange,
  empty,
}: FilterConditionsProps) {
  const choices = useMemo(() => filterChoices(type, properties), [type, properties]);
  const pickerProperties = useMemo<PickerProperty[]>(
    () =>
      choices.map((choice) => ({
        key: choice.key,
        name: choice.label,
        format: choice.format,
        compute: properties.find((property) => property.key === choice.key)?.compute,
      })),
    [choices, properties],
  );
  const [draft, setDraft] = useState<Condition[]>(filter.conditions);
  const published = useRef(filterParam(filter));

  // An outside change (a saved definition, a cleared row) replaces the draft;
  // this list's own writes are already reflected and never reset it.
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

  return (
    <div className="grid gap-1">
      {draft.length > 1 ? (
        <div
          className="inline-flex w-fit items-center gap-0.5 rounded-full border border-line p-0.5"
          role="group"
          aria-label="Match targets"
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
        <p className="text-[12px] leading-4 text-muted">{empty}</p>
      ) : (
        <ul>
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
        className="mt-1 min-h-8 w-fit px-2 text-[12px] pointer-coarse:min-h-11"
        onClick={add}
      >
        <Plus aria-hidden size={13} />
        Add condition
      </Button>
    </div>
  );
}
