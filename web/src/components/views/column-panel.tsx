import { ChevronLeft, ChevronRight, Plus, Search, X } from "lucide-react";
import { useState } from "react";

import type { PropertyDef, ViewDef } from "@/api/types";
import { SmallButton } from "@/components/schema/small-button";
import { Button } from "@/components/ui/controls";
import { useCoarsePointer, useCompactWidth } from "@/lib/media";
import { searchProperties } from "@/lib/property-search";
import { moveViewColumn, withColumn, withoutColumn } from "@/lib/views";

interface ColumnPanelProps {
  view: ViewDef;
  properties: PropertyDef[];
  disabled: boolean;
  onPatch: (change: { columns: string[]; widths: Record<string, number> }) => void;
  /** Opens the add-property dialog shared with the table header. */
  onAddProperty: () => void;
}

/** Column visibility and order for one view; every change writes immediately. */
export function ColumnPanel({
  view,
  properties,
  disabled,
  onPatch,
  onAddProperty,
}: ColumnPanelProps) {
  const propertyByKey = new Map(properties.map((property) => [property.key, property]));
  const nameOf = (key: string) => propertyByKey.get(key)?.name ?? key;
  const compact = useCompactWidth();
  const coarse = useCoarsePointer();
  const [query, setQuery] = useState("");
  const shown = view.columns.filter((key) => key !== "title");
  const hidden = properties.filter((property) => !view.columns.includes(property.key));
  const hiddenMatches = searchProperties(hidden, query);

  function move(key: string, delta: number) {
    const columns = moveViewColumn(view, key, delta);
    onPatch({ columns, widths: { ...view.widths } });
  }

  function hide(key: string) {
    onPatch(withoutColumn(view, key));
  }

  function show(key: string) {
    onPatch(withColumn(view, key, true));
  }

  return (
    <section
      aria-label="Columns"
      className="mt-3 border-y rule py-3"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="label">Columns</span>
        <span className="text-[12px] text-faint">
          {coarse
            ? "Column widths are set on a wide screen."
            : "Drag a header edge in the table to set its width."}
        </span>
      </div>

      <ul className="mt-2">
        <li className="flex items-center justify-between border-b rule py-1.5">
          <span className="flex items-baseline gap-2">
            {compact ? null : (
              <span className="font-mono text-[11px] text-faint">title</span>
            )}
            <span className="text-[14px]">Title</span>
          </span>
          <span className="label">fixed first</span>
        </li>
        {shown.map((key) => (
          <li
            key={key}
            className="flex items-center justify-between gap-2 border-b rule py-1.5"
          >
            <span className="flex min-w-0 items-baseline gap-2">
              {compact ? null : (
                <span className="font-mono text-[11px] text-faint">{key}</span>
              )}
              <span className="truncate text-[14px]">{nameOf(key)}</span>
            </span>
            <span className="flex items-center gap-2">
              {/* Position is one control, not two loose arrows: a pill keeps the
                  pair together, dims the end that cannot move, and stays 44px
                  per side on a finger. */}
              <span className="inline-flex items-center rounded-full border border-line-strong/70 bg-surface p-0.5">
                <button
                  type="button"
                  aria-label={`Move ${nameOf(key)} left`}
                  title={`Move ${nameOf(key)} left`}
                  disabled={disabled || view.columns.indexOf(key) <= 1}
                  className="inline-flex size-7 items-center justify-center rounded-full text-ink transition-colors hover:bg-accent-wash hover:text-accent-on-wash disabled:text-faint/45 disabled:hover:bg-transparent disabled:hover:text-faint/45 pointer-coarse:size-11"
                  onClick={() => move(key, -1)}
                >
                  <ChevronLeft aria-hidden size={16} />
                </button>
                <span
                  aria-hidden
                  className="tnum min-w-4 text-center font-mono text-[11px] text-faint"
                >
                  {view.columns.indexOf(key)}
                </span>
                <button
                  type="button"
                  aria-label={`Move ${nameOf(key)} right`}
                  title={`Move ${nameOf(key)} right`}
                  disabled={disabled || view.columns.indexOf(key) === view.columns.length - 1}
                  className="inline-flex size-7 items-center justify-center rounded-full text-ink transition-colors hover:bg-accent-wash hover:text-accent-on-wash disabled:text-faint/45 disabled:hover:bg-transparent disabled:hover:text-faint/45 pointer-coarse:size-11"
                  onClick={() => move(key, 1)}
                >
                  <ChevronRight aria-hidden size={16} />
                </button>
              </span>
              <SmallButton
                label={`Hide ${nameOf(key)}`}
                disabled={disabled}
                onClick={() => hide(key)}
              >
                <X aria-hidden size={15} />
              </SmallButton>
            </span>
          </li>
        ))}
      </ul>

      {hidden.length > 0 ? (
        <div className="mt-3">
          <span className="label">Hidden</span>
          <label className="mt-1 flex items-center gap-2 border-b rule pb-1.5">
            <Search aria-hidden size={13} className="shrink-0 text-faint" />
            <input
              type="search"
              value={query}
              aria-label="Search hidden properties"
              placeholder="Search hidden properties."
              onChange={(event) => setQuery(event.target.value)}
              className="h-8 min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-faint pointer-coarse:h-11 pointer-coarse:text-base"
            />
          </label>
          {hiddenMatches.length === 0 ? (
            <p className="mt-2 text-[13px] text-muted">
              No property matches “{query.trim()}”.
            </p>
          ) : null}
          <ul className="mt-1">
            {hiddenMatches.map((property) => (
              <li
                key={property.key}
                className="flex items-center justify-between gap-2 border-b rule py-1.5"
              >
                <span className="flex min-w-0 items-baseline gap-2">
                  {compact ? null : (
                    <span className="font-mono text-[11px] text-faint">{property.key}</span>
                  )}
                  <span className="truncate text-[14px]">{property.name}</span>
                </span>
                <SmallButton
                  label={`Show ${property.name}`}
                  disabled={disabled}
                  onClick={() => show(property.key)}
                >
                  <Plus aria-hidden size={15} />
                </SmallButton>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Button
        type="button"
        variant="ghost"
        className="mt-3 min-h-9 w-full justify-start px-3 text-[13px] pointer-coarse:min-h-11"
        disabled={disabled}
        onClick={onAddProperty}
      >
        <Plus aria-hidden size={15} />
        Add property
      </Button>
    </section>
  );
}
