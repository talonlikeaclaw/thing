import { Menu } from "@base-ui/react/menu";
import { Check, ChevronDown, Pencil, Plus, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";

import type { PropertyDef, PropertyFormat, ViewDef } from "@/api/types";
import { ThumbRow, useThumbHandedness } from "@/components/handedness";
import { SmallButton } from "@/components/schema/small-button";
import { Button } from "@/components/ui/controls";
import { FormatChip } from "@/components/ui/page";
import { useCoarsePointer, useCompactWidth } from "@/lib/media";
import { searchProperties } from "@/lib/property-search";
import { formatLabel } from "@/lib/schema";
import { moveViewColumnTo, withColumn, withoutColumn } from "@/lib/views";

interface ColumnPanelProps {
  spaceId: string;
  view: ViewDef;
  properties: PropertyDef[];
  disabled: boolean;
  onPatch: (change: { columns: string[]; widths: Record<string, number> }) => void;
  /** Opens the add-property dialog shared with the table header. */
  onAddProperty: () => void;
  /** The panel body's id, so the toolbar's trigger can name it. */
  id?: string;
}

const MENU_ITEM =
  "flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-[12px] text-ink hover:bg-[var(--color-accent-wash-hover)] focus:bg-[var(--color-accent-wash-hover)] focus:outline-none pointer-coarse:min-h-11";

const ICON_BUTTON =
  "inline-flex size-7 shrink-0 items-center justify-center rounded-full text-faint transition-colors hover:bg-raised hover:text-ink pointer-coarse:size-11";

const POSITION =
  "inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-line-strong/70 bg-surface px-1.5 font-mono text-[11px] text-ink transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:h-11 pointer-coarse:px-3";

/** A shown column, resolved to the property that names it. */
type ShownColumn = Pick<PropertyDef, "key" | "name" | "format">;

/** The key the row's edit action opens: the schema page's property editor. */
function editHref(spaceId: string, key: string): string {
  return `/s/${spaceId}/schema?property=${encodeURIComponent(key)}`;
}

/**
 * Column visibility and order for one view; every change writes immediately.
 * One search field narrows the shown and the hidden list together, and a
 * column's position is a menu of slots: moving it three places right is one
 * write and one tap, not three taps at a control that moves under the finger.
 */
export function ColumnPanel({
  spaceId,
  view,
  properties,
  disabled,
  onPatch,
  onAddProperty,
  id,
}: ColumnPanelProps) {
  const compact = useCompactWidth();
  const coarse = useCoarsePointer();
  const [query, setQuery] = useState("");
  const shownColumns = useMemo<ShownColumn[]>(() => {
    const propertyByKey = new Map(properties.map((property) => [property.key, property]));
    return view.columns
      .filter((key) => key !== "title")
      .map((key) => {
        const property = propertyByKey.get(key);
        return property
          ? { key: property.key, name: property.name, format: property.format }
          : { key, name: key, format: "text" as PropertyFormat };
      });
  }, [view.columns, properties]);
  const hidden = useMemo(
    () => properties.filter((property) => !view.columns.includes(property.key)),
    [properties, view.columns],
  );
  const shownMatches = searchProperties(shownColumns, query);
  const hiddenMatches = searchProperties(hidden, query);
  const total = shownColumns.length + hidden.length;
  const matched = shownMatches.length + hiddenMatches.length;
  const last = Math.max(1, view.columns.length - 1);

  function moveTo(key: string, index: number) {
    const columns = moveViewColumnTo(view, key, index);
    onPatch({ columns, widths: { ...view.widths } });
  }

  function hide(key: string) {
    onPatch(withoutColumn(view, key));
  }

  function show(key: string) {
    onPatch(withColumn(view, key, true));
  }

  return (
    <section aria-label="Columns" id={id}>
      <div className="flex items-center gap-2 border-b rule px-1 pb-2">
        <Search aria-hidden size={13} className="shrink-0 text-faint" />
        <input
          type="search"
          value={query}
          aria-label="Search properties"
          placeholder="Search properties."
          onChange={(event) => setQuery(event.target.value)}
          className="h-8 min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-faint pointer-coarse:h-11 pointer-coarse:text-base max-sm:h-11 max-sm:text-base"
        />
        {total > 0 ? (
          <span className="tnum shrink-0 font-mono text-[11px] text-faint">
            {matched} of {total}
          </span>
        ) : null}
      </div>

      <ul className="mt-2">
        <li className="flex items-center gap-2 border-b rule py-1.5">
          <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
            {compact ? null : <span className="font-mono text-[11px] text-faint">title</span>}
            <span className="text-[14px]">Title</span>
            <FormatChip>{formatLabel("text")}</FormatChip>
          </span>
          <span className="label shrink-0">fixed first</span>
        </li>
        {shownMatches.map((column) => {
          const index = view.columns.indexOf(column.key);
          return (
            <li key={column.key} className="border-b rule">
              {/* Canonical right-handed order ends at the thumb edge, so the
                  position selector is last; left mode reverses the row. */}
              <ThumbRow className="items-center gap-2 py-1.5">
                <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
                  {compact ? null : (
                    <span className="font-mono text-[11px] text-faint">{column.key}</span>
                  )}
                  <span className="truncate text-[14px] text-accent">{column.name}</span>
                  <FormatChip>{formatLabel(column.format)}</FormatChip>
                </span>
                <Link
                  to={editHref(spaceId, column.key)}
                  aria-label={`Edit ${column.name} property`}
                  title={`Edit ${column.name}`}
                  className={ICON_BUTTON}
                >
                  <Pencil aria-hidden size={14} />
                </Link>
                <SmallButton
                  label={`Hide ${column.name}`}
                  disabled={disabled}
                  onClick={() => hide(column.key)}
                >
                  <X aria-hidden size={15} />
                </SmallButton>
                <PositionMenu
                  name={column.name}
                  index={index}
                  last={last}
                  disabled={disabled}
                  onMove={(position) => moveTo(column.key, position)}
                />
              </ThumbRow>
            </li>
          );
        })}
      </ul>

      <div className="mt-3">
        <span className="label">Hidden</span>
        {hidden.length === 0 ? (
          <p className="mt-2 text-[13px] text-muted">Every property is a column.</p>
        ) : hiddenMatches.length === 0 ? (
          <p className="mt-2 text-[13px] text-muted">
            No hidden property matches “{query.trim()}”.
          </p>
        ) : (
          <ul className="mt-1">
            {hiddenMatches.map((property) => (
              <li key={property.key} className="border-b rule">
                <ThumbRow className="items-center gap-2 py-1.5">
                  <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
                    {compact ? null : (
                      <span className="font-mono text-[11px] text-faint">{property.key}</span>
                    )}
                    <span className="truncate text-[14px]">{property.name}</span>
                    <FormatChip>{formatLabel(property.format)}</FormatChip>
                  </span>
                  <Link
                    to={editHref(spaceId, property.key)}
                    aria-label={`Edit ${property.name} property`}
                    title={`Edit ${property.name}`}
                    className={ICON_BUTTON}
                  >
                    <Pencil aria-hidden size={14} />
                  </Link>
                  <SmallButton
                    label={`Show ${property.name}`}
                    disabled={disabled}
                    onClick={() => show(property.key)}
                  >
                    <Plus aria-hidden size={15} />
                  </SmallButton>
                </ThumbRow>
              </li>
            ))}
          </ul>
        )}
      </div>

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

      {coarse ? (
        <p className="mt-3 text-[12px] text-faint">Column widths are set on a wide screen.</p>
      ) : null}
    </section>
  );
}

/**
 * A column's slot, opened as a list of every position it can take. The trigger
 * keeps the current number visible; choosing another slot moves the column in
 * one write and closes, so the target never moves between taps.
 */
function PositionMenu({
  name,
  index,
  last,
  disabled,
  onMove,
}: {
  name: string;
  index: number;
  last: number;
  disabled: boolean;
  onMove: (position: number) => void;
}) {
  const handedness = useThumbHandedness();
  const positions = Array.from({ length: last }, (_, at) => at + 1);
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={`Move ${name}: position ${index} of ${last}`}
        title={`Move ${name} to another position`}
        disabled={disabled}
        className={POSITION}
      >
        <span className="tnum">{index}</span>
        <ChevronDown aria-hidden size={11} className="text-faint" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          sideOffset={4}
          align={handedness === "left" ? "start" : "end"}
          className="z-50"
        >
          <Menu.Popup
            aria-label={`Move ${name}`}
            className="glass-strong max-h-[min(20rem,60vh)] min-w-[12rem] overflow-y-auto rounded-card p-1.5 text-ink outline-none"
          >
            {positions.map((position) => (
              <Menu.Item
                key={position}
                className={MENU_ITEM}
                onClick={() => onMove(position)}
              >
                <span aria-hidden className="w-3.5 shrink-0">
                  {position === index ? (
                    <Check aria-hidden size={13} className="text-accent" />
                  ) : null}
                </span>
                Move to position {position}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
