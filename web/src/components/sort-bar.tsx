import { Menu } from "@base-ui/react/menu";
import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronUp, MoreHorizontal, Plus, X } from "lucide-react";
import { useMemo, useState } from "react";

import type { Sort } from "@/api/types";
import { ThumbRow, useThumbHandedness } from "@/components/handedness";
import { PropertyPicker } from "@/components/property-picker";
import { Button } from "@/components/ui/controls";
import { cn } from "@/lib/cn";
import type { ColumnChoice } from "@/lib/filter";
import { addSort, moveSort, removeSort, withSortDirection, withSortEmpty } from "@/lib/filter";

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
  const [pending, setPending] = useState<string | null>(null);
  const addKey =
    pending && unused.some((property) => property.key === pending)
      ? pending
      : (unused[0]?.key ?? null);

  function rename(from: string, to: string) {
    const taken = sorts.some((sort) => sort.property === to && sort.property !== from);
    if (taken) {
      return;
    }
    onChange(
      sorts.map((sort) => (sort.property === from ? { ...sort, property: to } : sort)),
    );
  }

  return (
    <section aria-label="Sorting" id={id}>
      {sorts.length === 0 ? (
        <p className="text-[12px] text-faint">The type's saved order.</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {sorts.map((sort, index) => {
            const column = columns.find((candidate) => candidate.key === sort.property);
            const name = column?.label ?? sort.property;
            return (
              <li key={sort.property} className="flex flex-col gap-1.5 border-b rule pb-2 last:border-b-0 last:pb-0">
                <PropertyPicker
                  properties={properties}
                  carried={carried}
                  value={sort.property}
                  onChange={(key) => rename(sort.property, key)}
                  label={`Sort column: ${name}`}
                  className="min-w-0"
                />
                <ThumbRow className="flex-wrap items-center gap-1.5">
                  <span className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-label={`Move ${name} up`}
                      disabled={index === 0}
                      className={ROW_BUTTON}
                      onClick={() => onChange(moveSort(sorts, sort.property, -1))}
                    >
                      <ChevronUp aria-hidden size={13} />
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${name} down`}
                      disabled={index === sorts.length - 1}
                      className={ROW_BUTTON}
                      onClick={() => onChange(moveSort(sorts, sort.property, 1))}
                    >
                      <ChevronDown aria-hidden size={13} />
                    </button>
                    <Menu.Root>
                      <Menu.Trigger
                        aria-label={`${name} sort options`}
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
                            <Menu.Item
                              className={MENU_ITEM}
                              onClick={() => onChange(withSortEmpty(sorts, sort.property, "start"))}
                            >
                              <span aria-hidden className="w-3.5 shrink-0">
                                {(sort.empty ?? "end") === "start" ? (
                                  <Check aria-hidden size={13} className="text-accent" />
                                ) : null}
                              </span>
                              Empty values first
                            </Menu.Item>
                            <Menu.Item
                              className={MENU_ITEM}
                              onClick={() => onChange(withSortEmpty(sorts, sort.property, "end"))}
                            >
                              <span aria-hidden className="w-3.5 shrink-0">
                                {(sort.empty ?? "end") === "end" ? (
                                  <Check aria-hidden size={13} className="text-accent" />
                                ) : null}
                              </span>
                              Empty values last
                            </Menu.Item>
                          </Menu.Popup>
                        </Menu.Positioner>
                      </Menu.Portal>
                    </Menu.Root>
                    <button
                      type="button"
                      aria-label={`Remove ${name} sort`}
                      className={ROW_BUTTON}
                      onClick={() => onChange(removeSort(sorts, sort.property))}
                    >
                      <X aria-hidden size={13} />
                    </button>
                  </span>
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
                            "inline-flex h-7 items-center gap-1 rounded-full px-2 text-[11px] transition-colors pointer-coarse:h-11",
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
        <div className="mt-3 flex flex-col gap-2">
          <PropertyPicker
            properties={unused}
            carried={carried}
            value={addKey}
            onChange={(key) => setPending(key)}
            label="Add a sort column"
            placeholder="Add a sort"
          />
          <Button
            type="button"
            variant="ghost"
            className="min-h-8 w-full justify-start px-3 text-[12px] pointer-coarse:min-h-11"
            disabled={addKey === null}
            onClick={() => {
              if (addKey) {
                onChange(addSort(sorts, addKey));
                setPending(null);
              }
            }}
          >
            <Plus aria-hidden size={13} />
            Add sort
          </Button>
        </div>
      ) : null}
    </section>
  );
}
