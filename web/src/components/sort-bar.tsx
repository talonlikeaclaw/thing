import { Menu } from "@base-ui/react/menu";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronUp,
  MoreHorizontal,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";

import type { Sort } from "@/api/types";
import { ThumbRow, useThumbHandedness } from "@/components/handedness";
import { PropertyPicker } from "@/components/property-picker";
import { cn } from "@/lib/cn";
import type { ColumnChoice } from "@/lib/filter";
import {
  addSort,
  moveSort,
  removeSort,
  withSortDirection,
  withSortEmpty,
} from "@/lib/filter";

interface SortBarProps {
  columns: ColumnChoice[];
  sorts: Sort[];
  onChange: (sorts: Sort[]) => void;
  /** The panel body's id, so the toolbar's trigger can name it. */
  id?: string;
}

const MENU_ITEM =
  "flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-[12px] text-ink hover:bg-[var(--color-accent-wash-hover)] focus:bg-[var(--color-accent-wash-hover)] focus:outline-none pointer-coarse:min-h-11";

const ROW_BUTTON =
  "inline-flex size-7 shrink-0 items-center justify-center rounded-full text-faint transition-colors hover:bg-raised hover:text-ink disabled:opacity-40 pointer-coarse:size-11";

/**
 * The view's order, edited in one panel: a property, a two-state direction and
 * a remove. Where empty values land is a row menu, so the common row stays two
 * controls wide; the first row still wins the tie.
 */
export function SortBar({ columns, sorts, onChange, id }: SortBarProps) {
  const handedness = useThumbHandedness();
  const properties = useMemo(
    () => columns.map((column) => ({ key: column.key, name: column.label, format: column.format })),
    [columns],
  );
  const carried = useMemo(() => new Set(columns.map((column) => column.key)), [columns]);
  const unused = properties.filter((property) => !sorts.some((sort) => sort.property === property.key));
  // The add control never holds a selection: choosing a column appends its
  // rule and the picker returns to its placeholder, so it cannot be read as a
  // second sort that is already applied.
  const [pending, setPending] = useState<string | null>(null);

  function rename(from: string, to: string) {
    onChange(sorts.map((sort) => (sort.property === from ? { ...sort, property: to } : sort)));
  }

  return (
    <section aria-label="Sorting" id={id}>
      {sorts.length === 0 ? (
        <p className="text-[13px] text-muted">Nothing is sorted; the records keep their saved order.</p>
      ) : (
        <ol className="grid gap-3">
          {sorts.map((sort, index) => {
            const column = columns.find((candidate) => candidate.key === sort.property);
            const name = column?.label ?? sort.property;
            return (
              <li
                key={sort.property}
                className="grid gap-2 border-b rule pb-3 last:border-b-0 last:pb-0"
              >
                {/* The ordinal is the rule's priority; the property trigger
                    keeps its name and format, and the row actions ride beside
                    it so the direction segment owns the line under it. */}
                <div className="flex items-center gap-2">
                  <span aria-hidden className="tnum w-3 shrink-0 font-mono text-[11px] text-faint">
                    {index + 1}
                  </span>
                  <PropertyPicker
                    properties={properties}
                    carried={carried}
                    value={sort.property}
                    onChange={(key) => rename(sort.property, key)}
                    title="Sort column"
                    className="min-w-0 flex-1"
                  />
                  <button
                    type="button"
                    aria-label={`Remove ${name} sort`}
                    title={`Remove ${name} sort`}
                    className={ROW_BUTTON}
                    onClick={() => onChange(removeSort(sorts, sort.property))}
                  >
                    <X aria-hidden size={14} />
                  </button>
                </div>
                <ThumbRow className="flex-wrap items-center gap-1">
                  <button
                    type="button"
                    aria-label={`Move ${name} up`}
                    title="Move this rule up"
                    disabled={index === 0}
                    className={ROW_BUTTON}
                    onClick={() => onChange(moveSort(sorts, sort.property, -1))}
                  >
                    <ChevronUp aria-hidden size={14} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${name} down`}
                    title="Move this rule down"
                    disabled={index === sorts.length - 1}
                    className={ROW_BUTTON}
                    onClick={() => onChange(moveSort(sorts, sort.property, 1))}
                  >
                    <ChevronDown aria-hidden size={14} />
                  </button>
                  <Menu.Root>
                    <Menu.Trigger
                      aria-label={`${name} sort options`}
                      title="Empty values first or last"
                      className={ROW_BUTTON}
                    >
                      <MoreHorizontal aria-hidden size={15} />
                    </Menu.Trigger>
                    <Menu.Portal>
                      <Menu.Positioner
                        sideOffset={4}
                        align={handedness === "left" ? "start" : "end"}
                        className="z-50"
                      >
                        <Menu.Popup className="glass-strong min-w-[12rem] rounded-card p-1.5 text-ink outline-none">
                          {(["start", "end"] as const).map((empty) => (
                            <Menu.Item
                              key={empty}
                              className={MENU_ITEM}
                              onClick={() => onChange(withSortEmpty(sorts, sort.property, empty))}
                            >
                              <span aria-hidden className="w-3.5 shrink-0">
                                {(sort.empty ?? "end") === empty ? (
                                  <Check aria-hidden size={13} className="text-accent" />
                                ) : null}
                              </span>
                              {empty === "start" ? "Empty values first" : "Empty values last"}
                            </Menu.Item>
                          ))}
                        </Menu.Popup>
                      </Menu.Positioner>
                    </Menu.Portal>
                  </Menu.Root>
                  <span
                    role="group"
                    aria-label={`${name} direction`}
                    className="inline-flex items-center rounded-full border border-line-interactive/70 bg-raised/40 p-0.5"
                  >
                    {(["asc", "desc"] as const).map((direction) => {
                      const active = sort.direction === direction;
                      return (
                        <button
                          key={direction}
                          type="button"
                          aria-pressed={active}
                          className={cn(
                            "inline-flex min-h-8 items-center gap-1 rounded-full px-2.5 text-[12px] transition-colors pointer-coarse:min-h-11",
                            active
                              ? "bg-accent-wash text-accent-on-wash"
                              : "text-muted hover:text-ink",
                          )}
                          onClick={() => onChange(withSortDirection(sorts, sort.property, direction))}
                        >
                          {direction === "asc" ? (
                            <ArrowUp aria-hidden size={12} />
                          ) : (
                            <ArrowDown aria-hidden size={12} />
                          )}
                          {direction === "asc" ? "Ascending" : "Descending"}
                        </button>
                      );
                    })}
                  </span>
                </ThumbRow>
              </li>
            );
          })}
        </ol>
      )}

      {unused.length > 0 ? (
        <div className="mt-4 grid gap-2 border-t rule pt-3">
          <span className="label">Add a sort</span>
          <PropertyPicker
            properties={unused}
            carried={carried}
            value={pending}
            onChange={(key) => {
              onChange(addSort(sorts, key));
              setPending(null);
            }}
            title="Add a sort column"
            placeholder="Choose a column"
          />
        </div>
      ) : null}
    </section>
  );
}
