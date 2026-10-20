import { ChevronDown, ChevronUp, Plus, X } from "lucide-react";
import { useState } from "react";

import type { ColumnChoice } from "@/lib/filter";
import { addSort, moveSort, removeSort, withSortDirection, withSortEmpty } from "@/lib/filter";
import type { Sort } from "@/api/types";
import { Button } from "@/components/ui/controls";

interface SortBarProps {
  columns: ColumnChoice[];
  sorts: Sort[];
  onChange: (sorts: Sort[]) => void;
}

/** The type view's order, edited in place; the first row wins the tie. */
export function SortBar({ columns, sorts, onChange }: SortBarProps) {
  const unused = columns.filter((column) => !sorts.some((sort) => sort.property === column.key));
  const [pending, setPending] = useState(unused[0]?.key ?? "");
  const addKey = unused.some((column) => column.key === pending)
    ? pending
    : (unused[0]?.key ?? "");

  return (
    <section aria-label="Sorting" className="border-b rule pb-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="label">Sort</span>
        <span className="label tnum">{sorts.length}</span>
      </div>

      {sorts.length === 0 ? (
        <p className="mt-1 text-[12px] text-faint">The type's saved order.</p>
      ) : (
        <ol className="mt-1">
          {sorts.map((sort, index) => {
            const choice = columns.find((column) => column.key === sort.property);
            return (
              <li
                key={sort.property}
                className="flex flex-wrap items-center gap-1.5 border-b rule py-1.5 last:border-b-0"
              >
                <select
                  aria-label="Sort column"
                  className="h-8 rounded-[4px] border border-line bg-ground px-1.5 text-[12px] text-ink pointer-coarse:h-11"
                  value={sort.property}
                  onChange={(event) => {
                    const next = event.target.value;
                    const taken = sorts.some(
                      (other) => other.property === next && other.property !== sort.property,
                    );
                    if (!taken) {
                      onChange(
                        sorts.map((existing) =>
                          existing.property === sort.property
                            ? { ...existing, property: next }
                            : existing,
                        ),
                      );
                    }
                  }}
                >
                  {columns.map((column) => (
                    <option
                      key={column.key}
                      value={column.key}
                      disabled={sorts.some(
                        (other) =>
                          other.property === column.key && other.property !== sort.property,
                      )}
                    >
                      {column.label}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Sort direction"
                  className="h-8 rounded-[4px] border border-line bg-ground px-1.5 text-[12px] text-ink pointer-coarse:h-11"
                  value={sort.direction}
                  onChange={(event) =>
                    onChange(
                      withSortDirection(
                        sorts,
                        sort.property,
                        event.target.value === "desc" ? "desc" : "asc",
                      ),
                    )
                  }
                >
                  <option value="asc">ascending</option>
                  <option value="desc">descending</option>
                </select>
                <select
                  aria-label="Empty placement"
                  className="h-8 rounded-[4px] border border-line bg-ground px-1.5 text-[12px] text-ink pointer-coarse:h-11"
                  value={sort.empty ?? "end"}
                  onChange={(event) =>
                    onChange(
                      withSortEmpty(
                        sorts,
                        sort.property,
                        event.target.value === "start" ? "start" : "end",
                      ),
                    )
                  }
                >
                  <option value="end">empty last</option>
                  <option value="start">empty first</option>
                </select>
                <span className="ml-auto flex items-center gap-1">
                  <button
                    type="button"
                    aria-label={`Move ${choice?.label ?? sort.property} up`}
                    disabled={index === 0}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-[3px] text-faint transition-colors hover:bg-raised hover:text-ink disabled:opacity-40 pointer-coarse:h-11 pointer-coarse:w-11"
                    onClick={() => onChange(moveSort(sorts, sort.property, -1))}
                  >
                    <ChevronUp aria-hidden size={13} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${choice?.label ?? sort.property} down`}
                    disabled={index === sorts.length - 1}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-[3px] text-faint transition-colors hover:bg-raised hover:text-ink disabled:opacity-40 pointer-coarse:h-11 pointer-coarse:w-11"
                    onClick={() => onChange(moveSort(sorts, sort.property, 1))}
                  >
                    <ChevronDown aria-hidden size={13} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${choice?.label ?? sort.property} sort`}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-[3px] text-faint transition-colors hover:bg-raised hover:text-ink pointer-coarse:h-11 pointer-coarse:w-11"
                    onClick={() => onChange(removeSort(sorts, sort.property))}
                  >
                    <X aria-hidden size={13} />
                  </button>
                </span>
              </li>
            );
          })}
        </ol>
      )}

      {unused.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select
            aria-label="Add a sort column"
            className="h-8 rounded-[4px] border border-line bg-ground px-1.5 text-[12px] text-ink pointer-coarse:h-11"
            value={addKey}
            onChange={(event) => setPending(event.target.value)}
          >
            {unused.map((column) => (
              <option key={column.key} value={column.key}>
                {column.label}
              </option>
            ))}
          </select>
          <Button
            type="button"
            variant="ghost"
            className="min-h-7 px-2 text-[12px] pointer-coarse:min-h-11"
            onClick={() => {
              if (addKey) {
                onChange(addSort(sorts, addKey));
                setPending("");
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
