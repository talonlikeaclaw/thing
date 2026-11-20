import { Plus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";

import { useRelationChoices, useSpace } from "@/api/queries";
import type { Condition, Filter, FilterOp, PropertyDef, TypeDef } from "@/api/types";
import {
  ConditionRow,
  type PickerProperty,
} from "@/components/filter-conditions";
import { ThumbRow } from "@/components/handedness";
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
  filterParam,
  hasConditions,
  quickFilters,
  withConditions,
  withoutConditions,
} from "@/lib/filter";
import { valueLabel } from "@/lib/format";

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
  const space = useSpace(spaceId);
  const relationTitles = new Map(choices.map((choice) => [choice.id, choice.title]));
  const memberTitles = new Map(
    (space.data?.members ?? []).map((person) => [person.user, person.name]),
  );
  const titles = format === "member" ? memberTitles : relationTitles;
  const namesPending =
    format === "relation" ? loading : format === "member" ? space.isPending : false;
  // A target or member whose name has not arrived yet is pending, not a UUID.
  const pending =
    namesPending &&
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

