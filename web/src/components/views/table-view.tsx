import { Popover } from "@base-ui/react/popover";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ArrowUpRight,
  Check,
  Copy,
  MoreHorizontal,
  Plus,
  Trash2,
} from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Link } from "react-router";

import type {
  ObjectSummary,
  PropertyDef,
  Sort,
  TypeDef,
  ValueJson,
  ViewDef,
  WriteResult,
} from "@/api/types";
import { useHandedness } from "@/components/handedness";
import { PropertyField } from "@/components/property-field";
import { IconPicker } from "@/components/icon-picker";
import { PropertyCell, TitleCell } from "@/components/property-cell";
import { cn } from "@/lib/cn";
import { isEditableTarget } from "@/lib/hotkeys";
import { completeLabel } from "@/lib/schedule";
import { clampWidth, defaultWidth, MIN_COLUMN_WIDTH } from "@/lib/views";

const OPEN_WIDTH_FINE = 134;
const OPEN_WIDTH_COARSE = 182;
/** Compact rows keep only the ⋯ menu and Open, with no gap between them. */
const COMPACT_EDITOR_WIDTH_FINE = 64;
const COMPACT_EDITOR_WIDTH_COARSE = 80;
const COMPACT_VIEWER_WIDTH_FINE = 32;
const COMPACT_VIEWER_WIDTH_COARSE = 40;
const SELECT_WIDTH = 44;
/** The trailing add-property header is a control, not a data column. */
const ADD_PROPERTY_WIDTH = 132;

function subscribeCoarse(onChange: () => void) {
  const media = window.matchMedia("(pointer: coarse)");
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function coarsePointer() {
  return window.matchMedia("(pointer: coarse)").matches;
}

function useCoarsePointer() {
  return useSyncExternalStore(subscribeCoarse, coarsePointer, () => false);
}

interface Cell {
  row: number;
  col: number;
}

interface TableViewProps {
  spaceId: string;
  type: TypeDef;
  view: ViewDef;
  rows: ObjectSummary[];
  properties: PropertyDef[];
  canEdit: boolean;
  completing: boolean;
  /** A query for different rows is in flight; the visible rows are stale. */
  busy: boolean;
  sorts: Sort[];
  selected: ReadonlySet<string>;
  /** Rows whose action is in flight, so only their controls freeze. */
  pendingRows: ReadonlySet<string>;
  /** The bulk editor's inline panel is taller than the selection band. */
  bulkOpen: boolean;
  /** Required members a new record must carry before the POST. */
  requiredProperties: PropertyDef[];
  draft: {
    title: string;
    icon: string;
    values: Record<string, unknown | null>;
    error: string | null;
  } | null;
  /** A just-created record stays highlighted briefly. */
  highlightId: string | null;
  timeZone: string;
  onDraftTitle: (title: string) => void;
  onDraftIcon: (icon: string) => void;
  onDraftValue: (key: string, value: unknown | null) => void;
  onDraftCommit: () => void;
  onDraftCancel: () => void;
  onSort: (key: string, additive: boolean) => void;
  onToggleRow: (id: string) => void;
  onToggleAll: () => void;
  onClearSelection: () => void;
  onTitleCommit: (row: ObjectSummary, title: string) => Promise<WriteResult>;
  onCellCommit: (
    row: ObjectSummary,
    property: PropertyDef,
    cell: { value: unknown; label: string },
  ) => Promise<WriteResult>;
  onComplete: (row: ObjectSummary) => void;
  onDuplicate: (row: ObjectSummary) => void;
  onTrash: (row: ObjectSummary) => void;
  onFocusSearch: () => void;
  onResize: (key: string, width: number) => void;
  /** Opens the add-property dialog from the trailing header cell. */
  onAddProperty: () => void;
}

/**
 * The table renderer: one row per record, saved widths, cells edited in place.
 * It is also a keyboard grid: one tab stop, arrow/j/k/h/l movement, Enter to
 * open the active cell, `x` to select a row and `/` to reach search.
 */
export function TableView({
  spaceId,
  type,
  view,
  rows,
  properties,
  canEdit,
  completing,
  busy,
  sorts,
  selected,
  pendingRows,
  bulkOpen,
  requiredProperties,
  draft,
  highlightId,
  timeZone,
  onDraftTitle,
  onDraftIcon,
  onDraftValue,
  onDraftCommit,
  onDraftCancel,
  onSort,
  onToggleRow,
  onToggleAll,
  onClearSelection,
  onTitleCommit,
  onCellCommit,
  onComplete,
  onDuplicate,
  onTrash,
  onFocusSearch,
  onResize,
  onAddProperty,
}: TableViewProps) {
  const propertyByKey = new Map(properties.map((property) => [property.key, property]));
  const columns = view.columns.filter((key) => key !== "title");
  const [preview, setPreview] = useState<Record<string, number>>({});
  const widthOf = (key: string) => preview[key] ?? defaultWidth(view, key);
  // Flexible columns share the space the fixed ones leave, in the proportions
  // their saved widths describe: a wide window fills instead of scrolling, and
  // a narrow one stops at the resize floor and lets the scrollport take over.
  const portRef = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(0);
  useLayoutEffect(() => {
    const port = portRef.current;
    if (!port) {
      return;
    }
    const measure = () => setAvailable(port.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(port);
    return () => observer.disconnect();
  }, []);

  // Below a phone width the action cell keeps only Open and a menu; the title
  // unpins so a property column has room to be read while swiping.
  const compact = available > 0 ? available < 640 : window.innerWidth < 640;
  const coarse = useCoarsePointer();
  // On a phone the checkbox column is hidden until the reader asks to select,
  // so the title starts at the left edge and the freed width goes to content.
  const [selecting, setSelecting] = useState(false);
  const showSelect = canEdit && (!compact || selecting);
  const openWidth = compact
    ? canEdit
      ? coarse
        ? COMPACT_EDITOR_WIDTH_COARSE
        : COMPACT_EDITOR_WIDTH_FINE
      : coarse
        ? COMPACT_VIEWER_WIDTH_COARSE
        : COMPACT_VIEWER_WIDTH_FINE
    : coarse
      ? OPEN_WIDTH_COARSE
      : OPEN_WIDTH_FINE;
  // A phone shows the trigger above the scrollport instead: a trailing column
  // would be a horizontal swipe away and cost the table 132px it does not have.
  const showAddColumn = canEdit && !compact;
  const fixedWidth =
    (showSelect ? SELECT_WIDTH : 0) + (showAddColumn ? ADD_PROPERTY_WIDTH : 0) + openWidth;
  const flexTotal =
    widthOf("title") + columns.reduce((sum, key) => sum + widthOf(key), 0);
  const flexKeys = ["title", ...columns];
  const minFlex = MIN_COLUMN_WIDTH * flexKeys.length;
  const flexSpace = Math.max(minFlex, available - fixedWidth);
  const scale = flexTotal === 0 ? 1 : flexSpace / flexTotal;
  const widths = new Map<string, number>();
  for (const key of flexKeys) {
    widths.set(
      key,
      preview[key] ?? Math.max(MIN_COLUMN_WIDTH, Math.round(widthOf(key) * scale)),
    );
  }
  // Rounding leaves a pixel or two over; hand the remainder to the last
  // flexible column so a fitted table never grows a scrollbar.
  if (Object.keys(preview).length === 0 && flexSpace === available - fixedWidth) {
    const current = flexKeys.reduce((sum, key) => sum + (widths.get(key) ?? 0), 0);
    const last = flexKeys[flexKeys.length - 1];
    if (last) {
      widths.set(
        last,
        Math.max(MIN_COLUMN_WIDTH, (widths.get(last) ?? 0) + (flexSpace - current)),
      );
    }
  }
  const columnWidth = (key: string) => widths.get(key) ?? widthOf(key);
  const tableWidth =
    fixedWidth + flexKeys.reduce((sum, key) => sum + columnWidth(key), 0);
  const verb = completeLabel(type.schedule_labels);

  // Column 0 is the checkbox for editors, then the title, then properties.
  const selectOffset = showSelect ? 1 : 0;
  const titleCol = selectOffset;
  const actionCol = selectOffset + columns.length + 1;
  const colCount = actionCol + 1;

  const gridRef = useRef<HTMLTableElement>(null);
  const [active, setActive] = useState<Cell | null>(null);

  useEffect(() => {
    if (rows.length === 0) {
      setActive(null);
      return;
    }
    setActive((current) => (current && current.row < rows.length ? current : { row: 0, col: 0 }));
  }, [rows.length]);

  // A selection made by keyboard or the bulk bar must keep its checkboxes.
  useEffect(() => {
    if (selected.size > 0) {
      setSelecting(true);
    }
  }, [selected.size]);

  function toggleSelecting() {
    if (!selecting) {
      setSelecting(true);
      return;
    }
    setSelecting(false);
    if (selected.size > 0) {
      onClearSelection();
    }
  }

  function activate(row: number, col: number) {
    setActive({ row, col });
    window.requestAnimationFrame(() => {
      gridRef.current?.querySelector<HTMLElement>(`[data-cell="${row}:${col}"]`)?.focus();
    });
  }

  function move(rowDelta: number, colDelta: number) {
    if (rows.length === 0) {
      return;
    }
    const base = active ?? { row: 0, col: 0 };
    activate(
      Math.min(Math.max(0, base.row + rowDelta), rows.length - 1),
      Math.min(Math.max(0, base.col + colDelta), colCount - 1),
    );
  }

  function activateCell(cell: Cell) {
    if (busy) {
      return;
    }
    const row = rows[cell.row];
    const element = gridRef.current?.querySelector<HTMLElement>(
      `[data-cell="${cell.row}:${cell.col}"]`,
    );
    if (!row || !element) {
      return;
    }
    if (canEdit && cell.col === 0) {
      onToggleRow(row.id);
      return;
    }
    if (cell.col === actionCol) {
      element.querySelector<HTMLAnchorElement>("a")?.click();
      return;
    }
    element.querySelector<HTMLButtonElement>("button")?.click();
  }

  function onGridKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.defaultPrevented || isEditableTarget(event.target)) {
      return;
    }
    const cell = active ?? { row: 0, col: 0 };
    const key = event.key;
    if (key === "j" || key === "ArrowDown") {
      event.preventDefault();
      move(1, 0);
    } else if (key === "k" || key === "ArrowUp") {
      event.preventDefault();
      move(-1, 0);
    } else if (key === "l" || key === "ArrowRight") {
      event.preventDefault();
      move(0, 1);
    } else if (key === "h" || key === "ArrowLeft") {
      event.preventDefault();
      move(0, -1);
    } else if (key === "x" && canEdit) {
      event.preventDefault();
      if (!event.repeat) {
        const row = rows[cell.row];
        if (row) {
          onToggleRow(row.id);
        }
      }
    } else if (key === "Enter") {
      event.preventDefault();
      activateCell(cell);
    } else if (key === "Escape") {
      event.preventDefault();
      setActive(null);
      onClearSelection();
    } else if (key === "/") {
      event.preventDefault();
      onFocusSearch();
    }
  }

  function resize(key: string, width: number) {
    setPreview((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    onResize(key, width);
  }

  function sortOf(key: string): Sort | undefined {
    return sorts.find((sort) => sort.property === key);
  }

  function cellProps(row: number, col: number) {
    const current = active !== null && active.row === row && active.col === col;
    return {
      "data-cell": `${row}:${col}`,
      tabIndex: current ? 0 : -1,
      onFocus: () => setActive({ row, col }),
    } as const;
  }

  function sortHeader(key: string) {
    const sort = sortOf(key);
    return {
      "aria-sort": sort ? (sort.direction === "asc" ? "ascending" : "descending") : "none",
    } as const;
  }

  const selectedOnPage = rows.filter((row) => selected.has(row.id)).length;
  const allSelected = rows.length > 0 && selectedOnPage === rows.length;

  return (
    <>
    {compact ? (
      <div className="mt-3 flex items-center gap-3">
        <p
          className="min-w-0 flex-1 truncate text-[11px] text-muted"
          title="Swipe the table sideways to see every column. Use the ⋯ menu for row actions."
        >
          {selecting ? "Tap the boxes to select rows" : "Swipe for columns · ⋯ for actions"}
        </p>
        {canEdit ? (
          <button
            type="button"
            aria-pressed={selecting}
            className="label shrink-0 text-[11px] text-faint transition-colors hover:text-accent pointer-coarse:min-h-11"
            onClick={toggleSelecting}
          >
            {selecting ? "Done" : "Select"}
          </button>
        ) : null}
      </div>
    ) : null}
    <div
      ref={portRef}
      className={cn(
        compact ? "mt-2" : "mt-6",
        "max-h-[70vh] overflow-auto overscroll-contain",
        bulkOpen ? "pb-[26rem] sm:pb-[14rem]" : "pb-16",
      )}
      onKeyDown={onGridKeyDown}
    >
      <table
        ref={gridRef}
        role="grid"
        aria-label={`${type.name_plural} records`}
        aria-rowcount={rows.length + 1}
        aria-colcount={colCount}
        aria-busy={busy}
        aria-multiselectable={canEdit ? true : undefined}
        className="table-fixed border-collapse text-left"
        style={{ width: tableWidth }}
      >
        <colgroup>
          {showSelect ? <col style={{ width: SELECT_WIDTH }} /> : null}
          <col style={{ width: columnWidth("title") }} />
          {columns.map((key) => (
            <col key={key} style={{ width: columnWidth(key) }} />
          ))}
          {showAddColumn ? <col style={{ width: ADD_PROPERTY_WIDTH }} /> : null}
          <col style={{ width: openWidth }} />
        </colgroup>
        <thead className="sticky top-0 z-20 bg-ground">
          <tr className="border-b rule">
            {showSelect ? (
              <th
                scope="col"
                className="sticky left-0 z-30 bg-ground py-2 text-center"
              >
                <label className="inline-flex min-h-8 min-w-8 items-center justify-center pointer-coarse:min-h-11 pointer-coarse:min-w-11">
                  <input
                    ref={(element) => {
                      if (element) {
                        element.indeterminate = selectedOnPage > 0 && !allSelected;
                      }
                    }}
                    type="checkbox"
                    aria-label="Select every row on this page"
                    checked={allSelected}
                    disabled={busy || rows.length === 0}
                    className="h-4 w-4 accent-[var(--color-accent)] pointer-coarse:h-5 pointer-coarse:w-5"
                    onChange={onToggleAll}
                  />
                </label>
              </th>
            ) : null}
            <th
              scope="col"
              className={cn(
                "z-30 border-r rule bg-surface py-2 pr-3 font-medium",
                !compact && "sticky",
              )}
              style={compact ? undefined : { left: selectOffset * SELECT_WIDTH }}
              {...sortHeader("title")}
            >
              <HeaderSort
                columnKey="title"
                label="Title"
                sort={sortOf("title")}
                onSort={onSort}
              />
              {canEdit ? (
                <ColumnResizer
                  label="Title"
                  width={widthOf("title")}
                  onPreview={(width) =>
                    setPreview((current) => ({ ...current, title: width }))
                  }
                  onCommit={(width) => resize("title", width)}
                />
              ) : null}
            </th>
            {columns.map((key) => {
              const property = propertyByKey.get(key);
              const label = property?.name ?? key;
              return (
                <th
                  key={key}
                  scope="col"
                  className="label relative py-2 pr-3 font-medium"
                  {...sortHeader(key)}
                >
                  <HeaderSort
                    columnKey={key}
                    label={label}
                    sort={sortOf(key)}
                    onSort={onSort}
                  />
                  {canEdit ? (
                    <ColumnResizer
                      label={label}
                      width={widthOf(key)}
                      onPreview={(width) =>
                        setPreview((current) => ({ ...current, [key]: width }))
                      }
                      onCommit={(width) => resize(key, width)}
                    />
                  ) : null}
                </th>
              );
            })}
            {showAddColumn ? (
              <th scope="col" className="py-2 pr-2 text-left">
                <button
                  type="button"
                  aria-label="Add property"
                  className="inline-flex min-h-8 w-full items-center gap-1 rounded-[3px] px-1 text-[12px] whitespace-nowrap text-faint transition-colors hover:bg-raised hover:text-accent pointer-coarse:min-h-11"
                  onClick={onAddProperty}
                >
                  <Plus aria-hidden size={13} />
                  Add property
                </button>
              </th>
            ) : null}
            <th
              scope="col"
              className="sticky right-0 z-30 border-l rule bg-ground py-2"
            >
              <span className="sr-only">Actions</span>
              {compact && canEdit ? (
                <button
                  type="button"
                  aria-label="Add property"
                  title="Add property"
                  className="mx-auto inline-flex h-8 w-8 items-center justify-center rounded-[3px] text-faint transition-colors hover:bg-raised hover:text-accent pointer-coarse:h-11 pointer-coarse:w-11"
                  onClick={onAddProperty}
                >
                  <Plus aria-hidden size={14} />
                </button>
              ) : null}
            </th>
          </tr>
        </thead>
        <tbody className={busy ? "pointer-events-none opacity-60" : undefined}>
          {draft ? (
            <tr className="border-b rule bg-raised/40">
              {showSelect ? <td className="sticky left-0 z-10 bg-raised/40" /> : null}
              <th
                scope="row"
                className="sticky z-10 border-r rule p-1 text-left font-normal"
                style={{ left: selectOffset * SELECT_WIDTH }}
              >
                <div className="grid gap-1.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <IconPicker
                      variant="compact"
                      label="New record icon"
                      value={draft.icon}
                      onChange={onDraftIcon}
                    />
                    <input
                      autoFocus
                      aria-label="New record title"
                      className="h-8 min-w-0 flex-1 rounded-[3px] border border-line-interactive bg-ground px-1.5 text-[14px] font-medium text-ink outline-none focus:border-accent pointer-coarse:h-11 pointer-coarse:text-[16px]"
                      maxLength={200}
                      placeholder="Untitled"
                      value={draft.title}
                      onChange={(event) => onDraftTitle(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          onDraftCommit();
                        }
                        if (event.key === "Escape") {
                          event.preventDefault();
                          onDraftCancel();
                        }
                      }}
                    />
                  </div>
                  {requiredProperties.map((property) => (
                    <div key={property.key} className="grid gap-0.5">
                      <span className="label">{property.name} · required</span>
                      <PropertyField
                        spaceId={spaceId}
                        property={property}
                        value={draft.values[property.key] ?? null}
                        label=""
                        canEdit
                        timeZone={timeZone}
                        onChange={(value) => onDraftValue(property.key, value)}
                        onInvalid={() => undefined}
                      />
                    </div>
                  ))}
                  {draft.error ? (
                    <p role="alert" className="text-[11px] text-danger">
                      {draft.error}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-1">
                    <button
                      type="button"
                      className="rounded-[3px] bg-accent px-2 py-1 text-[11px] text-accent-ink pointer-coarse:min-h-11"
                      onClick={onDraftCommit}
                    >
                      Create
                    </button>
                    <button
                      type="button"
                      className="rounded-[3px] px-2 py-1 text-[11px] text-muted hover:text-ink pointer-coarse:min-h-11"
                      onClick={onDraftCancel}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </th>
              {columns.map((key) => (
                <td key={key} className="py-1 pr-2" />
              ))}
              {showAddColumn ? <td className="py-1 pr-2" /> : null}
              <td className="sticky right-0 border-l rule bg-raised/40" />
            </tr>
          ) : null}
          {rows.map((row, rowIndex) => {
            const isSelected = selected.has(row.id);
            const rowActive = active?.row === rowIndex;
            const rowPending = pendingRows.has(row.id);
            return (
              <tr
                key={row.id}
                aria-rowindex={rowIndex + 2}
                aria-selected={canEdit ? isSelected : undefined}
                data-active={rowActive ? "true" : undefined}
                className={cn(
                  "group border-b rule align-top",
                  isSelected && "bg-raised",
                  row.id === highlightId && "bg-accent/10",
                  rowActive && "[&>td]:border-t [&>td]:border-line-strong [&>th]:border-t [&>th]:border-line-strong",
                )}
              >
                {showSelect ? (
                  <td
                    {...cellProps(rowIndex, 0)}
                    aria-label={`Select “${row.title}”`}
                    className={cn(
                      "sticky left-0 z-10 py-1 text-center outline-none",
                      isSelected ? "bg-raised" : "bg-ground",
                    )}
                  >
                    <label className="inline-flex min-h-8 min-w-8 items-center justify-center pointer-coarse:min-h-11 pointer-coarse:min-w-11">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={busy}
                        tabIndex={rowActive ? 0 : -1}
                        aria-label={`Select “${row.title}”`}
                        className="h-4 w-4 accent-[var(--color-accent)] pointer-coarse:h-5 pointer-coarse:w-5"
                        onChange={() => onToggleRow(row.id)}
                      />
                    </label>
                  </td>
                ) : null}
                <th
                  {...cellProps(rowIndex, titleCol)}
                  scope="row"
                  aria-label={
                    canEdit
                      ? `Edit title for “${row.title}”, currently “${row.title}”`
                      : `Title “${row.title}”`
                  }
                  className={cn(
                    "z-10 border-r rule py-1 pr-2 text-left font-normal outline-none",
                    !compact && "sticky",
                    isSelected ? "bg-raised" : "bg-surface",
                  )}
                  style={compact ? undefined : { left: selectOffset * SELECT_WIDTH }}
                >
                  <TitleCell
                    title={row.title}
                    icon={row.icon}
                    canEdit={canEdit}
                    onCommit={(title) => onTitleCommit(row, title)}
                  />
                </th>
                {columns.map((key, offset) => {
                  const property = propertyByKey.get(key);
                  if (!property) {
                    return (
                      <td
                        key={key}
                        {...cellProps(rowIndex, titleCol + 1 + offset)}
                        className="py-1 pr-2 font-mono text-[11px] text-faint outline-none"
                      >
                        {key}
                      </td>
                    );
                  }
                  const label = row.values[key]?.label ?? "";
                  return (
                    <td
                      key={key}
                      {...cellProps(rowIndex, titleCol + 1 + offset)}
                      aria-label={
                        canEdit
                          ? `Edit ${property.name} for “${row.title}”, currently “${label || "empty"}”`
                          : `${property.name} for “${row.title}”: ${label || "empty"}`
                      }
                      className="py-1 pr-2 outline-none"
                    >
                      <PropertyCell
                        spaceId={spaceId}
                        timeZone={timeZone}
                        property={property}
                        cell={row.values[key] as ValueJson | undefined}
                        schedule={row.schedule}
                        canEdit={canEdit}
                        rowTitle={row.title}
                        onCommit={(cell) => onCellCommit(row, property, cell)}
                      />
                    </td>
                  );
                })}
                <td
                  {...cellProps(rowIndex, actionCol)}
                  aria-label={`Actions for “${row.title}”`}
                  className={cn(
                    "sticky right-0 border-l rule py-1 text-right outline-none",
                    isSelected ? "bg-raised" : "bg-ground",
                  )}
                >
                  <div
                    className={cn(
                      "row-actions flex items-center justify-end",
                      compact ? "gap-0" : "gap-0.5",
                    )}
                  >
                    {compact && canEdit ? (
                      <RowActionsMenu
                        row={row}
                        verb={verb}
                        tight
                        completing={completing}
                        busy={busy || rowPending}
                        onComplete={() => onComplete(row)}
                        onDuplicate={() => onDuplicate(row)}
                        onTrash={() => onTrash(row)}
                      />
                    ) : null}
                    {!compact && canEdit && type.schedule && row.schedule?.status !== "done" ? (
                      <RowAction
                        label={`${verb} ${row.title}`}
                        title={verb}
                        disabled={completing || busy}
                        tabIndex={rowActive ? 0 : -1}
                        onClick={() => onComplete(row)}
                      >
                        <Check aria-hidden size={14} />
                      </RowAction>
                    ) : null}
                    {!compact && canEdit ? (
                      <>
                        <RowAction
                          label={`Duplicate ${row.title}`}
                          title="Duplicate"
                          disabled={busy || rowPending}
                          tabIndex={rowActive ? 0 : -1}
                          onClick={() => onDuplicate(row)}
                        >
                          <Copy aria-hidden size={14} />
                        </RowAction>
                        <RowAction
                          label={`Move ${row.title} to trash`}
                          title="Move to trash"
                          disabled={busy || rowPending}
                          tabIndex={rowActive ? 0 : -1}
                          danger
                          onClick={() => onTrash(row)}
                        >
                          <Trash2 aria-hidden size={14} />
                        </RowAction>
                      </>
                    ) : null}
                    <Link
                      to={`/s/${spaceId}/o/${row.id}`}
                      aria-label={`Open ${row.title}`}
                      title="Open record"
                      tabIndex={rowActive ? 0 : -1}
                      className={cn(
                        "inline-flex h-8 w-8 items-center justify-center rounded-[3px] text-faint transition-colors hover:bg-raised hover:text-accent pointer-coarse:h-11 pointer-coarse:w-11",
                        compact && "pointer-coarse:w-10",
                      )}
                    >
                      <ArrowUpRight aria-hidden size={14} />
                    </Link>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    </>
  );
}

/** The phone-width row menu: the three actions an inline cell would crowd out. */
function RowActionsMenu({
  row,
  verb,
  tight,
  completing,
  busy,
  onComplete,
  onDuplicate,
  onTrash,
}: {
  row: ObjectSummary;
  verb: string;
  tight?: boolean;
  completing: boolean;
  busy: boolean;
  onComplete: () => void;
  onDuplicate: () => void;
  onTrash: () => void;
}) {
  const canComplete = row.schedule !== undefined && row.schedule.status !== "done";
  const { handedness } = useHandedness();
  const item =
    "flex min-h-9 w-full items-center gap-2 rounded-[4px] px-3 text-left text-[13px] text-ink transition-colors hover:bg-raised disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:min-h-11";
  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label={`More actions for “${row.title}”`}
        className={cn(
          "inline-flex h-8 w-8 items-center justify-center rounded-[3px] text-faint transition-colors hover:bg-raised hover:text-accent pointer-coarse:h-11 pointer-coarse:w-11",
          tight && "pointer-coarse:w-10",
        )}
      >
        <MoreHorizontal aria-hidden size={16} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          sideOffset={4}
          align={handedness === "left" ? "start" : "end"}
          className="z-50"
        >
          <Popover.Popup className="min-w-[11rem] rounded-field border border-line bg-surface p-1">
            {canComplete ? (
              <Popover.Close
                className={item}
                disabled={completing || busy}
                onClick={onComplete}
              >
                <Check aria-hidden size={14} />
                {verb}
              </Popover.Close>
            ) : null}
            <Popover.Close className={item} disabled={busy} onClick={onDuplicate}>
              <Copy aria-hidden size={14} />
              Duplicate
            </Popover.Close>
            <Popover.Close
              className={cn(item, "text-danger")}
              disabled={busy}
              onClick={onTrash}
            >
              <Trash2 aria-hidden size={14} />
              Move to trash
            </Popover.Close>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function RowAction({
  label,
  title,
  disabled,
  tabIndex,
  danger,
  onClick,
  children,
}: {
  label: string;
  title: string;
  disabled: boolean;
  tabIndex: number;
  danger?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title}
      disabled={disabled}
      tabIndex={tabIndex}
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-[3px] text-faint transition-colors hover:bg-raised disabled:opacity-50 pointer-coarse:h-11 pointer-coarse:w-11",
        danger ? "hover:text-danger" : "hover:text-accent",
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

interface ColumnResizerProps {
  label: string;
  width: number;
  onPreview: (width: number) => void;
  onCommit: (width: number) => void;
}

/**
 * A keyboard-focusable column edge. Pointer moves preview continuously; the
 * write happens on release. Arrow keys move 16px, Shift 64px.
 */
function ColumnResizer({ label, width, onPreview, onCommit }: ColumnResizerProps) {
  const [dragging, setDragging] = useState<{ startX: number; startWidth: number } | null>(null);

  function widthFor(delta: number) {
    return clampWidth((dragging?.startWidth ?? width) + delta);
  }

  return (
    <span
      role="separator"
      aria-label={`Resize ${label} column`}
      aria-orientation="vertical"
      aria-valuenow={width}
      tabIndex={0}
      className="absolute inset-y-0 right-0 w-2 cursor-col-resize touch-none border-r border-transparent transition-colors hover:border-line-strong focus-visible:border-accent pointer-coarse:w-4"
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging({ startX: event.clientX, startWidth: width });
      }}
      onPointerMove={(event) => {
        if (!dragging) {
          return;
        }
        onPreview(clampWidth(dragging.startWidth + event.clientX - dragging.startX));
      }}
      onPointerUp={(event) => {
        if (!dragging) {
          return;
        }
        const next = widthFor(event.clientX - dragging.startX);
        setDragging(null);
        onCommit(next);
      }}
      onPointerCancel={() => setDragging(null)}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 64 : 16;
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          onCommit(clampWidth(width - step));
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          onCommit(clampWidth(width + step));
        }
      }}
    />
  );
}

function HeaderSort({
  columnKey,
  label,
  sort,
  onSort,
}: {
  columnKey: string;
  label: string;
  sort: Sort | undefined;
  onSort: (key: string, additive: boolean) => void;
}) {
  const state = sort
    ? sort.direction === "asc"
      ? "currently ascending"
      : "currently descending"
    : "not sorted";
  const next = !sort
    ? "sort ascending"
    : sort.direction === "asc"
      ? "sort descending"
      : "clear the sort";

  return (
    <button
      type="button"
      className="flex w-full min-w-0 flex-col items-start gap-0 text-left transition-colors hover:text-ink"
      title={`${label} — ${state}; activate to ${next}`}
      aria-label={`Sort by ${label}, ${state}, activate to ${next}`}
      onClick={(event) => onSort(columnKey, event.shiftKey)}
    >
      <span className="flex w-full min-w-0 items-center gap-1">
        <span className="truncate">{label}</span>
        <span className="flex w-[11px] shrink-0 items-center">
          {sort ? (
            sort.direction === "asc" ? (
              <ArrowUp aria-hidden size={11} className="text-accent" />
            ) : (
              <ArrowDown aria-hidden size={11} className="text-accent" />
            )
          ) : (
            <ArrowUpDown aria-hidden size={11} className="text-faint opacity-60" />
          )}
        </span>
      </span>
      <span className="w-full truncate font-mono text-[9px] text-faint normal-case tracking-normal">
        {columnKey}
      </span>
    </button>
  );
}
