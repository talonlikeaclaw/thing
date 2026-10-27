import { Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

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
import { RecurrenceInput } from "@/components/recurrence-input";
import { Button } from "@/components/ui/controls";
import {
  columnChoice,
  columnChoices,
  completeFilter,
  conditionIsComplete,
  conditionTakesValue,
  conditionText,
  CONDITION_LABELS,
  filterParam,
  newCondition,
  operatorsFor,
  parseConditionText,
  withConditionOp,
  withConditionValue,
} from "@/lib/filter";

interface FilterBarProps {
  spaceId: string;
  type: TypeDef;
  properties: PropertyDef[];
  filter: Filter;
  onChange: (filter: Filter) => void;
}

/**
 * Conditions over the table's own columns. A condition is local until it has a
 * value; only complete conditions become the URL's filter, so a half-typed row
 * never blanks the table or reaches the server.
 */
export function FilterBar({ spaceId, type, properties, filter, onChange }: FilterBarProps) {
  const columns = columnChoices(type, properties);
  const [draft, setDraft] = useState<Condition[]>(filter.conditions);
  const published = useRef(filterParam(filter));

  // An outside change (view switch, Clear filters, a saved view) replaces the
  // draft; the bar's own writes are already reflected and never reset it.
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

  function replace(index: number, condition: Condition) {
    publish(draft.map((existing, at) => (at === index ? condition : existing)));
  }

  function remove(index: number) {
    publish(draft.filter((_, at) => at !== index));
  }

  function add() {
    const used = new Set(draft.map((condition) => condition.property));
    const column = columns.find((choice) => choice.key !== "updated_at" && !used.has(choice.key));
    if (!column) {
      return;
    }
    publish([...draft, newCondition(column)]);
  }

  return (
    <section aria-label="Filters" className="border-b rule pb-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="label">Filter</span>
        {draft.length > 1 ? (
          <div className="flex items-center gap-1" role="group" aria-label="Match">
            {(["and", "or"] as const).map((op) => (
              <button
                key={op}
                type="button"
                aria-pressed={filter.op === op}
                className="label rounded-[3px] px-2 py-1 transition-colors hover:text-ink aria-pressed:bg-raised aria-pressed:text-ink pointer-coarse:min-h-11"
                onClick={() => publish(draft, op)}
              >
                {op}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {draft.length === 0 ? (
        <p className="mt-1 text-[12px] text-faint">Every record in this type.</p>
      ) : (
        <ul className="mt-1">
          {draft.map((condition, index) => {
            const column = columnChoice(columns, condition.property);
            const format = column?.format ?? "text";
            const operators = operatorsFor(format);
            const op = operators.includes(condition.condition) ? condition.condition : operators[0];
            if (!op) {
              return null;
            }
            return (
              <li
                key={`${condition.property}-${index}`}
                className="flex flex-wrap items-center gap-1.5 border-b rule py-1.5 last:border-b-0"
              >
                <select
                  aria-label="Filter column"
                  className="h-8 rounded-[4px] border border-line-interactive bg-ground px-1.5 text-[12px] text-ink pointer-coarse:h-11 pointer-coarse:text-[16px]"
                  value={condition.property}
                  onChange={(event) => {
                    const next = columnChoice(columns, event.target.value);
                    if (next) {
                      replace(index, newCondition(next));
                    }
                  }}
                >
                  {columns.map((choice) => (
                    <option key={choice.key} value={choice.key}>
                      {choice.label}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Filter condition"
                  className="h-8 rounded-[4px] border border-line-interactive bg-ground px-1.5 text-[12px] text-ink pointer-coarse:h-11 pointer-coarse:text-[16px]"
                  value={op}
                  onChange={(event) =>
                    replace(index, withConditionOp(condition, event.target.value as CondOp))
                  }
                >
                  {operators.map((operator) => (
                    <option key={operator} value={operator}>
                      {CONDITION_LABELS[operator]}
                    </option>
                  ))}
                </select>
                <ConditionValue
                  spaceId={spaceId}
                  format={format}
                  property={properties.find((candidate) => candidate.key === condition.property)}
                  condition={condition}
                  conditionOp={op}
                  onChange={(value) =>
                    replace(index, withConditionValue({ ...condition, condition: op }, value))
                  }
                />
                {conditionIsComplete(condition) ? null : (
                  <span className="label text-faint">Needs a value</span>
                )}
                <button
                  type="button"
                  aria-label="Remove condition"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-[3px] text-faint transition-colors hover:bg-raised hover:text-ink pointer-coarse:h-11 pointer-coarse:w-11"
                  onClick={() => remove(index)}
                >
                  <X aria-hidden size={13} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <Button
        type="button"
        variant="ghost"
        className="mt-2 min-h-7 px-2 text-[12px] pointer-coarse:min-h-11"
        onClick={add}
      >
        <Plus aria-hidden size={13} />
        Add condition
      </Button>
    </section>
  );
}

interface ConditionValueProps {
  spaceId: string;
  format: PropertyFormat;
  property: PropertyDef | undefined;
  condition: Condition;
  conditionOp: CondOp;
  onChange: (value: unknown) => void;
}

function ConditionValue({
  spaceId,
  format,
  property,
  condition,
  conditionOp,
  onChange,
}: ConditionValueProps) {
  if (!conditionTakesValue(conditionOp)) {
    return null;
  }
  if (format === "recurrence") {
    return (
      <RecurrenceInput
        value={condition.value}
        showHint={false}
        onApply={(next) => onChange(next)}
      />
    );
  }
  if (format === "select" && property) {
    return (
      <select
        aria-label="Filter value"
        className="h-8 min-w-[8rem] rounded-[4px] border border-line-interactive bg-ground px-1.5 text-[12px] text-ink pointer-coarse:h-11 pointer-coarse:text-[16px]"
        value={typeof condition.value === "string" ? condition.value : ""}
        onChange={(event) => onChange(event.target.value || null)}
      >
        <option value="">Choose…</option>
        {(property.options ?? []).map((option) => (
          <option key={option.key} value={option.key}>
            {option.name}
          </option>
        ))}
      </select>
    );
  }
  if (format === "multi_select" && property) {
    return (
      <select
        aria-label="Filter value"
        className="h-8 min-w-[8rem] rounded-[4px] border border-line-interactive bg-ground px-1.5 text-[12px] text-ink pointer-coarse:h-11 pointer-coarse:text-[16px]"
        value={typeof condition.value === "string" ? condition.value : ""}
        onChange={(event) => onChange(event.target.value || null)}
      >
        <option value="">Choose…</option>
        {(property.options ?? []).map((option) => (
          <option key={option.key} value={option.key}>
            {option.name}
          </option>
        ))}
      </select>
    );
  }
  if (format === "checkbox") {
    return (
      <select
        aria-label="Filter value"
        className="h-8 rounded-[4px] border border-line-interactive bg-ground px-1.5 text-[12px] text-ink pointer-coarse:h-11 pointer-coarse:text-[16px]"
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
  if (format === "relation" && property) {
    return (
      <RelationValue
        spaceId={spaceId}
        property={property}
        value={condition.value}
        onChange={onChange}
      />
    );
  }
  return (
    <TextConditionValue
      format={format}
      conditionOp={conditionOp}
      value={condition.value}
      onChange={onChange}
    />
  );
}

/** A text field that keeps invalid input on screen instead of dropping it. */
function TextConditionValue({
  format,
  conditionOp,
  value,
  onChange,
}: {
  format: PropertyFormat;
  conditionOp: CondOp;
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
    const parsed = parseConditionText(conditionOp, format, text);
    if (parsed !== undefined) {
      onChange(parsed);
    }
  }

  return (
    <input
      aria-label="Filter value"
      className="h-8 min-w-[8rem] flex-1 rounded-[4px] border border-line-interactive bg-ground px-2 text-[12px] text-ink focus:border-accent pointer-coarse:h-11 pointer-coarse:text-[16px]"
      type={
        format === "number"
          ? "number"
          : format === "date"
            ? "date"
            : format === "datetime"
              ? "text"
              : "text"
      }
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
  value,
  onChange,
}: {
  spaceId: string;
  property: PropertyDef;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const { choices, loading } = useRelationChoices(spaceId, property, true);
  return (
    <select
      aria-label="Filter value"
      className="h-8 min-w-[9rem] flex-1 rounded-[4px] border border-line-interactive bg-ground px-1.5 text-[12px] text-ink pointer-coarse:h-11 pointer-coarse:text-[16px]"
      value={typeof value === "string" ? value : ""}
      onChange={(event) => onChange(event.target.value || null)}
    >
      <option value="">{loading ? "Reading…" : "Choose a target"}</option>
      {choices.map((choice) => (
        <option key={choice.id} value={choice.id}>
          {choice.title}
        </option>
      ))}
    </select>
  );
}
