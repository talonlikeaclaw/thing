import { Menu } from "@base-ui/react/menu";
import { Link2, MoreHorizontal, Pencil, Plus, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";

import type { PropertyDef, PropertyFormat, ViewDef } from "@/api/types";
import { ThumbRow } from "@/components/handedness";
import { PromoteColumnDialog } from "@/components/schema/promote-column";
import { SmallButton } from "@/components/schema/small-button";
import { Button } from "@/components/ui/controls";
import { FormatChip } from "@/components/ui/page";
import { PositionMenu } from "@/components/ui/position-menu";
import { useCoarsePointer } from "@/lib/media";
import { searchProperties } from "@/lib/property-search";
import { promotionBlocker } from "@/lib/promotion";
import { computeKindLabel, formatLabel } from "@/lib/schema";
import { moveViewColumnTo, withColumn, withoutColumn } from "@/lib/views";

interface ColumnPanelProps {
  spaceId: string;
  /** The type whose view this panel edits. */
  typeKey: string;
  view: ViewDef;
  properties: PropertyDef[];
  disabled: boolean;
  onPatch: (change: { columns: string[]; widths: Record<string, number> }) => void;
  /** Opens the add-property dialog shared with the table header. */
  onAddProperty: () => void;
  /** The panel body's id, so the toolbar's trigger can name it. */
  id?: string;
}

const ICON_BUTTON =
  "inline-flex size-9 shrink-0 items-center justify-center rounded-full text-faint transition-colors hover:bg-raised hover:text-ink pointer-coarse:size-11";

/** A shown column, resolved to the property that names it. */
type ShownColumn = Pick<PropertyDef, "key" | "name" | "format" | "compute">;

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
  typeKey,
  view,
  properties,
  disabled,
  onPatch,
  onAddProperty,
  id,
}: ColumnPanelProps) {
  const coarse = useCoarsePointer();
  const [query, setQuery] = useState("");
  const [promoteKey, setPromoteKey] = useState<string | null>(null);
  const shownColumns = useMemo<ShownColumn[]>(() => {
    const propertyByKey = new Map(properties.map((property) => [property.key, property]));
    return view.columns
      .filter((key) => key !== "title")
      .map((key) => {
        const property = propertyByKey.get(key);
        return property
          ? {
              key: property.key,
              name: property.name,
              format: property.format,
              compute: property.compute,
            }
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
  const promoteProperty = promoteKey
    ? properties.find((property) => property.key === promoteKey)
    : undefined;

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
          className="h-9 min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-faint pointer-coarse:h-11 pointer-coarse:text-base max-sm:h-11 max-sm:text-base"
        />
        {total > 0 ? (
          <span className="tnum shrink-0 font-mono text-[11px] text-faint">
            {matched} of {total}
          </span>
        ) : null}
      </div>

      <Button
        type="button"
        variant="ghost"
        className="mt-2 min-h-9 w-full justify-start px-2 text-[12px] pointer-coarse:min-h-11"
        disabled={disabled}
        onClick={onAddProperty}
      >
        <Plus aria-hidden size={14} />
        Add property
      </Button>

      <ul className="mt-1">
        <li className="flex items-center gap-2 border-b rule py-1.5">
          <span className="min-w-0 flex-1 truncate text-[14px]">Title</span>
          <FormatChip className="border-accent/40 bg-accent-wash text-accent-on-wash">
            {formatLabel("text")}
          </FormatChip>
          <span className="flex w-[7.75rem] shrink-0 justify-end">
            <span className="label">fixed first</span>
          </span>
        </li>
        {shownMatches.map((column) => {
          const index = view.columns.indexOf(column.key);
          return (
            <li key={column.key} className="border-b rule">
              {/* Canonical right-handed order ends at the thumb edge, so the
                  position selector is last; left mode reverses the row. */}
              <ThumbRow className="items-center gap-2 py-1.5">
                <span className="min-w-0 flex-1 truncate text-[14px] text-accent">
                  {column.name}
                </span>
                <FormatChip className="border-accent/40 bg-accent-wash text-accent-on-wash">
                  {computeKindLabel(column)
                    ? `${computeKindLabel(column)} · ${formatLabel(column.format)}`
                    : formatLabel(column.format)}
                </FormatChip>
                <RowActions
                  spaceId={spaceId}
                  property={column}
                  disabled={disabled}
                  onPromote={() => setPromoteKey(column.key)}
                />
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
                  count={last}
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
                  <span className="min-w-0 flex-1 truncate text-[14px]">{property.name}</span>
                  <FormatChip className="border-accent/40 bg-accent-wash text-accent-on-wash">
                    {computeKindLabel(property)
                      ? `${computeKindLabel(property)} · ${formatLabel(property.format)}`
                      : formatLabel(property.format)}
                  </FormatChip>
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

      {coarse ? (
        <p className="mt-3 text-[12px] text-faint">Column widths are set on a wide screen.</p>
      ) : null}

      {promoteProperty ? (
        <PromoteColumnDialog
          spaceId={spaceId}
          typeKey={typeKey}
          property={promoteProperty}
          onClose={() => setPromoteKey(null)}
        />
      ) : null}
    </section>
  );
}

/**
 * The row's overflow menu: edit the property, or turn the column into a
 * relation. The conversion is disabled with the reason when the format cannot
 * become a relation; whether one type owns it is the plan's answer, shown in
 * the wizard before anything is written.
 */
function RowActions({
  spaceId,
  property,
  disabled,
  onPromote,
}: {
  spaceId: string;
  property: ShownColumn;
  disabled: boolean;
  onPromote: () => void;
}) {
  const blocker = promotionBlocker(property, 1);
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={`More actions for ${property.name}`}
        title={`More actions for ${property.name}`}
        disabled={disabled}
        className={ICON_BUTTON}
      >
        <MoreHorizontal aria-hidden size={15} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={4} align="end" className="z-50">
          <Menu.Popup className="glass-strong min-w-[15rem] rounded-card p-1.5 text-[13px] text-ink outline-none">
            <Menu.Item
              className="flex min-h-9 w-full items-center gap-2 rounded-[10px] px-3 text-left text-ink transition-colors hover:bg-raised pointer-coarse:min-h-11"
              render={<Link to={editHref(spaceId, property.key)} />}
            >
              <Pencil aria-hidden size={14} className="text-faint" />
              Edit property
            </Menu.Item>
            <Menu.Item
              className="flex min-h-9 w-full items-center gap-2 rounded-[10px] px-3 text-left text-ink transition-colors hover:bg-raised disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:min-h-11"
              disabled={blocker !== null}
              title={blocker ?? undefined}
              onClick={onPromote}
            >
              <Link2 aria-hidden size={14} className="text-faint" />
              Turn into a relation…
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

