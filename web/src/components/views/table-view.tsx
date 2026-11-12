import { Popover } from "@base-ui/react/popover";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  ArrowUpRight,
  Check,
  Copy,
  MoreHorizontal,
  Plus,
  Sigma,
  SquareFunction,
  Trash2,
} from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { Link, useNavigate } from "react-router";

import type {
  ComputeKind,
  ObjectSummary,
  PropertyDef,
  PropertyFormat,
  Sort,
  TypeDef,
  ValueJson,
  ViewDef,
  WriteResult,
} from "@/api/types";
import { useThumbHandedness } from "@/components/handedness";
import { FORMAT_ICONS } from "@/components/format-icon";
import { PropertyCell, TitleCell } from "@/components/property-cell";
import { useToast } from "@/components/ui/toast";
import { summarizeColumn } from "@/lib/aggregate";
import { cn } from "@/lib/cn";
import {
  TITLE_COLUMN_KEY,
  cellText,
  clampCell,
  normalizeRange,
  rangeContains,
  rangeMatrix,
  rangeSize,
  revealDelta,
  sameCell,
  stepCell,
  tabCell,
  toMarkdown,
  toTsv,
  type Cell,
  type GridColumn,
} from "@/lib/grid";
import { isEditableTarget } from "@/lib/hotkeys";
import { useCoarsePointer } from "@/lib/media";
import { alignOf, displayLabel } from "@/lib/presentation";
import { completeLabel } from "@/lib/schedule";
import { computeDescription, formatLabel, isComputed } from "@/lib/schema";
import {
  dragMoved,
  dragWidth,
  savedWidths,
  widthPlan,
} from "@/lib/table-widths";
import { clampWidth } from "@/lib/views";

const OPEN_WIDTH_FINE = 134;
const OPEN_WIDTH_COARSE = 182;
/** Compact rows keep only the ⋯ menu (Open lives inside it): one 44 px control. */
const COMPACT_EDITOR_WIDTH_FINE = 44;
const COMPACT_EDITOR_WIDTH_COARSE = 52;
const COMPACT_VIEWER_WIDTH_FINE = 44;
const COMPACT_VIEWER_WIDTH_COARSE = 52;
const SELECT_WIDTH = 44;
/** The trailing add-property header is a control, not a data column. */
const ADD_PROPERTY_WIDTH = 132;
/** One character's advance in the header's mono label size and tracking. */
const FORMAT_TEXT_ADVANCE = 7.6;
/** The header cell's right padding; the format words must clear it. */
const HEADER_RIGHT_PADDING = 8;
/** Breathing room between a revealed cell and the sticky chrome around it. */
const CELL_CLEARANCE = 6;
/** The two spellings a copy writes: a TSV block, or a markdown table. */
type CopyKind = "tsv" | "markdown";

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
  /** Changes whenever the page, filter, sort, search or view changes. */
  scopeKey: string;
  /** Every row the view matches, so the footer can say when it covers only a page. */
  total: number;
  sorts: Sort[];
  selected: ReadonlySet<string>;
  /** Rows whose action is in flight, so only their controls freeze. */
  pendingRows: ReadonlySet<string>;
  /** The bulk editor's inline panel is taller than the selection band. */
  bulkOpen: boolean;
  timeZone: string;
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
  /** Resolves once the width write lands; the preview is dropped either way. */
  onResize: (key: string, width: number) => Promise<void>;
  /** A layout PATCH is in flight; a second resize waits for it. */
  layoutPending: boolean;
  /** Opens the add-property dialog from the trailing header cell. */
  onAddProperty: () => void;
  /** The compact dirty/query status, rendered in the hint row so it never shifts the table. */
  compactStatus?: ReactNode;
}

/**
 * The table renderer: one row per record, saved widths, cells edited in place.
 * It is also a keyboard grid: one tab stop, arrow/j/k/h/l movement, Tab to walk
 * the data cells, Enter to open the active cell, `o` to open its record, `x` to
 * select the row and `/` to reach search.
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
  scopeKey,
  sorts,
  selected,
  pendingRows,
  bulkOpen,
  timeZone,
  total,
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
  layoutPending,
  onAddProperty,
  compactStatus,
}: TableViewProps) {
  const propertyByKey = new Map(properties.map((property) => [property.key, property]));
  const navigate = useNavigate();
  const toast = useToast();
  const propertyKeys = view.columns.filter((key) => key !== TITLE_COLUMN_KEY);
  // The data columns in view order. The checkbox, add-property, tail and rail
  // columns are controls, so they are never data and never get a range cell.
  const gridColumns: GridColumn[] = [
    { key: TITLE_COLUMN_KEY, label: "Title" },
    ...propertyKeys.map((key) => {
      const property = propertyByKey.get(key);
      return {
        key,
        label: property?.name ?? key,
        format: property?.format,
        display: property?.display,
      };
    }),
  ];
  // The band is a denylist: absent means shown, so an old view reads unchanged.
  const footerShown = view.footer !== false;
  const footerHidden = new Set(view.footer_hidden ?? []);
  // The footer reads the rows the table shows: one page, the active filter and
  // the server's order, never a server-side aggregate.
  const summaries =
    rows.length > 0 && footerShown
      ? gridColumns.map((column) => summarizeColumn(column, rows, timeZone))
      : [];
  const [preview, setPreview] = useState<Record<string, number>>({});
  const flexKeys = [TITLE_COLUMN_KEY, ...propertyKeys];
  // Literal widths: the saved value — or the phone width — is what the column
  // paints. The window's leftover space becomes one filler column, so a drag
  // moves only the column under the finger and never reflows its neighbours.
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

  // Below a phone width the title pins to the left edge and every column takes
  // the fixed phone width, so a swipe reads values instead of a squeezed fit.
  const compact = available > 0 ? available < 640 : window.innerWidth < 640;
  const coarse = useCoarsePointer();
  // The action rail is a control, not data: it lives at the thumb edge, so the
  // title and the properties stay in their schema order beside it.
  const handedness = useThumbHandedness();
  const railBefore = handedness === "left";
  const saved = savedWidths(view, flexKeys, compact);
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
  // A trailing rail paints over the scrollport's right edge, so the table keeps
  // one rail-width of empty tail: the last data column can scroll clear of it
  // instead of ending underneath. A leading rail already covers the start, so
  // it needs no spacer. The same tail absorbs leftover space either way, which
  // is why a drag never moves a neighbour.
  const spacer = railBefore ? 0 : openWidth;
  const widthOf = (key: string): number => preview[key] ?? saved[key] ?? 0;
  const plan = widthPlan(
    Object.fromEntries(flexKeys.map((key) => [key, widthOf(key)])),
    available,
    fixedWidth + spacer,
  );
  const columnWidth = (key: string) => plan.widths[key] ?? widthOf(key);
  const tailWidth = plan.filler + spacer;
  const tableWidth = plan.tableWidth;
  const verb = completeLabel(type.schedule_labels);

  // The rail and the pinned title share the viewport edge on the rail's side.
  const railEdge = railBefore ? "left-0 border-r" : "right-0 border-l";
  // A collapsed border lives in the table's paint layer, not the sticky cell's,
  // so the sub-pixel strip where a leading rail meets the next column can be
  // left unpainted — page background, or the columns sliding underneath, show
  // through it while the table scrolls. Paint that strip from the rail, the
  // higher of the two sticky cells: a 3 px band of the rail's background that
  // covers its last 2 px and 1 px past its edge, tinted raised on a selected
  // row. The header keeps its collapsed divider, which is painted.
  const railSeam = railBefore
    ? "after:pointer-events-none after:absolute after:inset-y-0 after:-right-[2px] after:w-[3px] after:content-['']"
    : null;
  // Every body cell is the card's surface, so the rail's seam paints it too.
  const railSeamTone = railBefore ? "after:bg-surface" : null;
  // A pinned cell must stay opaque: a translucent wash would let the columns
  // sliding underneath show through. Hover and selected paint the wash over the
  // cell's own ground instead of replacing it with alpha.
  const hoverSurface =
    "group-hover:bg-[color-mix(in_srgb,var(--color-accent)_6%,var(--color-surface))]!";
  const selectedSurface = "bg-[color-mix(in_srgb,var(--color-accent)_12%,var(--color-surface))]";
  // The active data cell's ring, inset so the sticky header and the card's clip
  // can never cut it, in both schemes and on the accent wash. It marks where
  // the next keystroke lands, so a finger-only device keeps the plain table.
  const activeRing = coarse ? null : "shadow-[inset_0_0_0_2px_var(--color-accent)]";
  /** The moving corner of a range is thinner than the anchor it grew from. */
  const rangeRing = coarse ? null : "shadow-[inset_0_0_0_1px_var(--color-accent)]";
  const railSeamToneSelected = railBefore
    ? "after:bg-[color-mix(in_srgb,var(--color-accent)_12%,var(--color-surface))]"
    : null;
  const railHeaderClass = cn("sticky z-30 rule p-0", railEdge);
  const railBodyClass = cn("sticky z-20 rule py-1", railEdge);

  // Column 0 is the checkbox for editors, then the title, then properties.
  const selectOffset = showSelect ? 1 : 0;
  // The pinned data columns start after the rail when it leads the row.
  const pinnedOffset = (railBefore ? openWidth : 0) + selectOffset * SELECT_WIDTH;
  const titleCol = selectOffset;
  const actionCol = selectOffset + propertyKeys.length + 1;
  const colCount = actionCol + 1;
  const lastDataCol = titleCol + gridColumns.length - 1;
  const isDataColumn = (col: number) => col >= titleCol && col <= lastDataCol;

  const gridRef = useRef<HTMLTableElement>(null);
  const [active, setActive] = useState<Cell | null>(null);
  /** The other corner of a cell range; absent while the selection is one cell. */
  const [anchor, setAnchor] = useState<Cell | null>(null);
  // The rectangle the reader has marked, in data coordinates. A control column
  // has no range: the wash, the bar and the copy all name data only.
  const range =
    anchor && active && isDataColumn(anchor.col) && isDataColumn(active.col)
      ? normalizeRange(anchor, active)
      : null;
  const rangeStats = range ? rangeSize(range) : null;
  /** The rectangle's corners as one value, so leaving it can clear the note. */
  const rangeShape = range
    ? `${range.top}:${range.left}:${range.bottom}:${range.right}`
    : "";
  /**
   * The last copy's sentence, announced politely and cleared as soon as the
   * rectangle moves: the reader hears the result once, beside the range's size.
   */
  const [copyNote, setCopyNote] = useState<string | null>(null);
  /** The card holds focus: the ring only speaks for a grid you are inside. */
  const [gridFocused, setGridFocused] = useState(false);
  /** A pinned title shows a stronger edge only once columns have slid under it. */
  const [scrolled, setScrolled] = useState(false);
  /** More columns sit past the right edge, so the ledger offers a visible cue. */
  const [moreRight, setMoreRight] = useState(false);

  useLayoutEffect(() => {
    const port = portRef.current;
    const table = gridRef.current;
    if (!port) {
      return;
    }
    const update = () =>
      setMoreRight(port.scrollLeft + port.clientWidth < port.scrollWidth - 2);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(port);
    if (table) {
      observer.observe(table);
    }
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  useEffect(() => {
    // A new page, filter, sort, search or view is a new grid: neither corner of
    // the old range means anything in it.
    setAnchor(null);
    setActive(rows.length > 0 ? { row: 0, col: titleCol } : null);
  }, [scopeKey, titleCol]);

  useEffect(() => {
    // A live delete or a filter can shorten the page under the reader. The
    // range and the active cell saturate instead of pointing past the end.
    if (rows.length === 0) {
      setActive(null);
      setAnchor(null);
      return;
    }
    const rowCount = rows.length;
    const columnCount = colCount;
    setActive((current) =>
      current ? clampCell(current, rowCount, columnCount) : { row: 0, col: titleCol },
    );
    setAnchor((current) =>
      current ? clampCell(current, rowCount, columnCount) : null,
    );
  }, [rows.length, colCount, titleCol]);

  // A selection made by keyboard or the bulk bar must keep its checkboxes.
  useEffect(() => {
    if (selected.size > 0) {
      setSelecting(true);
    }
  }, [selected.size]);

  useEffect(() => {
    // A copy's sentence belongs to the rectangle that is no longer there.
    setCopyNote(null);
  }, [rangeShape]);

  // Toggling Select inserts the 44 px checkbox rail before the pinned title,
  // which widens the pinned group. Keep the scroll exactly where it was: adding
  // the rail to it would slide the first property column under the title.
  const keepScroll = useRef<number | null>(null);
  useLayoutEffect(() => {
    const keep = keepScroll.current;
    keepScroll.current = null;
    if (keep !== null && portRef.current) {
      portRef.current.scrollLeft = Math.max(0, keep);
    }
  }, [showSelect]);

  function toggleSelecting() {
    keepScroll.current = portRef.current?.scrollLeft ?? null;
    if (!selecting) {
      setSelecting(true);
      return;
    }
    setSelecting(false);
    if (selected.size > 0) {
      onClearSelection();
    }
  }

  function activate(row: number, col: number, keepAnchor = false) {
    if (!keepAnchor) {
      setAnchor(null);
    }
    setActive({ row, col });
    window.requestAnimationFrame(() => {
      const cell = gridRef.current?.querySelector<HTMLElement>(`[data-cell="${row}:${col}"]`);
      // The browser's own scroll stops at the scrollport's edge, which the
      // sticky title and rail cover; reveal the cell inside the clear band.
      cell?.focus({ preventScroll: true });
      revealCell(row, col);
    });
  }

  /**
   * Scrolls the card until the cell clears the pinned title column, the action
   * rail and the sticky header. Only data columns move: a sticky cell is
   * already at its own edge.
   */
  function revealCell(row: number, col: number) {
    const port = portRef.current;
    const cell = gridRef.current?.querySelector<HTMLElement>(`[data-cell="${row}:${col}"]`);
    if (!port || !cell) {
      return;
    }
    const portRect = port.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();
    const header = gridRef.current?.querySelector("thead")?.getBoundingClientRect();
    const sticky = col <= titleCol || col === actionCol;
    const delta = revealDelta(
      cellRect,
      portRect,
      {
        left: sticky ? 0 : pinnedOffset + columnWidth(TITLE_COLUMN_KEY) + CELL_CLEARANCE,
        right: railBefore ? 0 : openWidth + CELL_CLEARANCE,
        top: (header?.height ?? 0) + CELL_CLEARANCE,
        bottom: CELL_CLEARANCE,
      },
    );
    if (delta.left !== 0) {
      port.scrollLeft += delta.left;
    }
    if (delta.top !== 0) {
      port.scrollTop += delta.top;
    }
  }

  function move(rowDelta: number, colDelta: number, extend = false) {
    const base = active ?? { row: 0, col: titleCol };
    const next = stepCell(base, rowDelta, colDelta, rows.length, colCount);
    if (!next) {
      return;
    }
    if (!extend) {
      activate(next.row, next.col);
      return;
    }
    // Shift never walks into a control column: a range is made of data only.
    const col = Math.min(Math.max(next.col, titleCol), lastDataCol);
    const start = anchor ?? {
      row: Math.min(Math.max(base.row, 0), rows.length - 1),
      col: Math.min(Math.max(base.col, titleCol), lastDataCol),
    };
    setAnchor(start);
    activate(next.row, col, true);
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

  /** The label one cell shows; the copy writes exactly this, never the value. */
  function labelAt(cell: Cell): string | null {
    if (!isDataColumn(cell.col)) {
      return null;
    }
    const row = rows[cell.row];
    const column = gridColumns[cell.col - titleCol];
    return row && column ? cellText(column, row) : null;
  }

  /** The text a copy writes: the rectangle as a table, or one cell's label. */
  function copyPayload(kind: CopyKind, cell: Cell | null): string | null {
    if (range) {
      // The range is in DOM columns; the model's data columns start at the
      // title, after the checkbox column.
      const matrix = rangeMatrix(gridColumns, rows, {
        ...range,
        left: range.left - titleCol,
        right: range.right - titleCol,
      });
      return kind === "markdown"
        ? toMarkdown(matrix.header, matrix.rows)
        : toTsv(matrix.header, matrix.rows);
    }
    return cell ? labelAt(cell) : null;
  }

  /**
   * Writes the selection — or the focused cell — to the clipboard. A refused
   * copy keeps the range so the reader can retry; nothing throws.
   */
  async function copy(kind: CopyKind, cell: Cell | null) {
    const text = copyPayload(kind, cell);
    if (text === null) {
      return;
    }
    const note =
      kind === "markdown"
        ? "Copied as a markdown table."
        : `Copied ${counted(rangeStats?.cells ?? 1, "cell", "cells")}.`;
    try {
      await navigator.clipboard.writeText(text);
      setCopyNote(note);
      toast.showToast(note);
    } catch {
      const refusal = "The browser refused the copy.";
      setCopyNote(refusal);
      toast.showToast(refusal, "danger");
    }
  }

  function onGridKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.defaultPrevented || isEditableTarget(event.target)) {
      return;
    }
    // The key addresses the cell that has focus, so a checkbox or a rail
    // control keeps working while the roving ring stays on data.
    const cell = cellAt(event.target) ?? active ?? { row: 0, col: 0 };
    const key = event.key;
    if (key === "j" || key === "ArrowDown") {
      event.preventDefault();
      move(1, 0, event.shiftKey);
    } else if (key === "k" || key === "ArrowUp") {
      event.preventDefault();
      move(-1, 0, event.shiftKey);
    } else if (key === "l" || key === "ArrowRight") {
      event.preventDefault();
      move(0, 1, event.shiftKey);
    } else if (key === "h" || key === "ArrowLeft") {
      event.preventDefault();
      move(0, -1, event.shiftKey);
    } else if (key === "Tab") {
      // Spreadsheet traversal, deliberately not the APG grid's leave-the-grid
      // Tab: only a data cell intercepts it, so header controls, the checkbox
      // column and the rail keep their native order. At either boundary the
      // key is left alone and the browser moves focus out of the table.
      if (
        !(event.target instanceof HTMLElement) ||
        !event.target.closest("[data-grid-cell]")
      ) {
        return;
      }
      const next = tabCell(
        cell,
        titleCol,
        titleCol + gridColumns.length - 1,
        rows.length,
        event.shiftKey,
      );
      if (!next) {
        return;
      }
      event.preventDefault();
      activate(next.row, next.col);
    } else if (key === "x" && canEdit) {
      event.preventDefault();
      if (!event.repeat) {
        const row = rows[cell.row];
        if (row) {
          onToggleRow(row.id);
        }
      }
    } else if (key === "o") {
      event.preventDefault();
      if (!event.repeat) {
        const row = rows[cell.row];
        if (row) {
          navigate(`/s/${spaceId}/o/${row.id}`);
        }
      }
    } else if (key === "Enter") {
      event.preventDefault();
      activateCell(cell);
    } else if ((event.metaKey || event.ctrlKey) && key.toLowerCase() === "c") {
      // Selected prose is the reader's own copy, and a control column has no
      // label to write: both leave the key to the browser.
      if (window.getSelection()?.toString() || !isDataColumn(cell.col)) {
        return;
      }
      event.preventDefault();
      void copy("tsv", cell);
    } else if (key === "Escape") {
      event.preventDefault();
      if (anchor) {
        // The first Escape gives up the rectangle, not the reader's place.
        setAnchor(null);
        return;
      }
      setActive(null);
      onClearSelection();
    } else if (key === "/") {
      event.preventDefault();
      onFocusSearch();
    }
  }

  // The preview survives the write: the cache already carries the new width,
  // so dropping it when the PATCH lands is invisible, and dropping it early
  // would snap the column back for a frame.
  function resize(key: string, width: number) {
    setPreview((current) => ({ ...current, [key]: width }));
    void onResize(key, width)
      .catch(() => undefined)
      .finally(() => {
        setPreview((current) => {
          if (current[key] !== width) {
            return current;
          }
          const next = { ...current };
          delete next[key];
          return next;
        });
      });
  }

  /** A press that never crossed the drag threshold paints nothing. */
  function cancelResize(key: string) {
    setPreview((current) => {
      if (!(key in current)) {
        return current;
      }
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function sortOf(key: string): Sort | undefined {
    return sorts.find((sort) => sort.property === key);
  }

  function cellProps(row: number, col: number) {
    return {
      "data-cell": `${row}:${col}`,
      tabIndex: isRovingCell(row, col) ? 0 : -1,
    } as const;
  }

  /**
   * The grid's one tab stop: the active cell, or the first data cell while
   * Escape has cleared it, so the body never loses its keyboard entry point.
   */
  function isRovingCell(row: number, col: number): boolean {
    const roving = active ?? { row: 0, col: titleCol };
    return roving.row === row && roving.col === col;
  }

  /**
   * A data cell is also the roving position when it takes focus. A control
   * cell must not steal it: after the row checkbox the browser's own Tab has to
   * land on the active data cell, which is the grid's one native entry point.
   */
  function dataCellProps(row: number, col: number) {
    const inRange = range !== null && rangeContains(range, { row, col });
    return {
      ...cellProps(row, col),
      "data-grid-cell": "",
      "data-active": isActiveCell(row, col) ? "true" : undefined,
      "data-in-range": inRange ? "true" : undefined,
      // Only a live range marks cells; the row's own aria-selected still means
      // the bulk selection.
      "aria-selected": range ? (inRange ? "true" : "false") : undefined,
      onFocus: () => setActive({ row, col }),
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
        // A touch tap is not a range gesture: the phone table keeps its old
        // behaviour and never raises the selection bar.
        if (event.pointerType === "touch") {
          setAnchor(null);
          setActive({ row, col });
          return;
        }
        // Shift is the range gesture; a plain press collapses the rectangle to
        // the pressed cell and makes it the anchor a later Shift click grows.
        if (event.shiftKey) {
          return;
        }
        setAnchor({ row, col });
        setActive({ row, col });
      },
      onClickCapture: (event: ReactMouseEvent<HTMLElement>) => {
        // Capture runs before the cell's display button, so a Shift click
        // grows the rectangle instead of opening an editor.
        if (!event.shiftKey) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        setAnchor((current) => current ?? { row, col });
        setActive({ row, col });
      },
    } as const;
  }

  /** The cell a focused element sits in, parsed from its host's `data-cell`. */
  function cellAt(target: EventTarget | null): Cell | null {
    if (!(target instanceof HTMLElement)) {
      return null;
    }
    const raw = target.closest<HTMLElement>("[data-cell]")?.dataset.cell;
    if (!raw) {
      return null;
    }
    const [rowText, colText] = raw.split(":");
    const row = Number(rowText);
    const col = Number(colText);
    return Number.isInteger(row) && Number.isInteger(col) ? { row, col } : null;
  }

  /** The one roving cell: only it is tabbable among the body cells. */
  function isActiveCell(row: number, col: number): boolean {
    return active !== null && active.row === row && active.col === col;
  }

  /** The active cell's ring, or the range's two-corner grammar. */
  function ringOf(row: number, col: number): string | null {
    if (!gridFocused) {
      return null;
    }
    const cell = { row, col };
    if (range && rangeContains(range, cell)) {
      if (anchor && sameCell(anchor, cell)) {
        return activeRing;
      }
      return isActiveCell(row, col) ? rangeRing : null;
    }
    return isActiveCell(row, col) ? activeRing : null;
  }

  function sortHeader(key: string) {
    const sort = sortOf(key);
    return {
      "aria-sort": sort ? (sort.direction === "asc" ? "ascending" : "descending") : "none",
    } as const;
  }

  const selectedOnPage = rows.filter((row) => selected.has(row.id)).length;
  const allSelected = rows.length > 0 && selectedOnPage === rows.length;
  // The page floats the bulk band over the viewport's bottom edge; the card
  // keeps a matching empty strip so the band never covers a row.
  const bandOpen = canEdit && selected.size > 0;
  const counted = (count: number, one: string, many: string) =>
    `${count} ${count === 1 ? one : many}`;

  // The rail header travels to whichever edge the rail occupies; the add
  // control on a phone lives there too.
  const railHeaderCell = (
    <th scope="col" className={cn(railHeaderClass, "bg-raised")}>
      <span className="sr-only">Actions</span>
      {compact && canEdit ? (
        <button
          type="button"
          aria-label="Add property"
          title="Add property"
          className="mx-auto inline-flex h-8 w-8 items-center justify-center rounded-full text-faint transition-colors hover:bg-raised hover:text-accent pointer-coarse:h-11 pointer-coarse:w-11 max-sm:h-11 max-sm:w-11"
          onClick={onAddProperty}
        >
          <Plus aria-hidden size={14} />
        </button>
      ) : null}
    </th>
  );

  // Select is a control, so it follows the rail to the thumb edge.
  const selectToggle = canEdit ? (
    <button
      type="button"
      aria-pressed={selecting}
      className="label inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center px-2 text-[11px] text-faint transition-colors hover:text-accent"
      onClick={toggleSelecting}
    >
      {selecting ? "Done" : "Select"}
    </button>
  ) : null;

  // The bar lives in a row that is already reserved above the card, so a
  // selection never pushes the rows the reader is working in down the page.
  const barButton =
    "inline-flex min-h-6 shrink-0 items-center rounded-[6px] px-2 text-[11px] text-muted transition-colors hover:bg-surface hover:text-ink pointer-coarse:min-h-11";
  // The footer band is opaque and pinned to the scrollport's bottom edge; the
  // bulk editor owns that edge while it is open, so the band drops the offset.
  const footerCell =
    "py-1.5 pr-2 align-top font-mono text-[11px] tabular-nums text-muted outline-none";
  const footerStick = !compact && !bulkOpen ? "sticky bottom-0" : null;
  const rangeBar = rangeStats ? (
    <div
      role="group"
      aria-label="Cell selection"
      className={cn(
        "flex w-full min-w-0 items-center gap-2 rounded-[8px] border border-line bg-raised px-2",
        compact ? "min-h-11 flex-wrap py-1" : "h-6",
      )}
    >
      <span
        aria-live="polite"
        className={cn(
          "min-w-0 flex-1 truncate font-mono text-[11px] tabular-nums tracking-[0.06em] text-muted",
          // Three finger-sized buttons leave the count no room beside them, so
          // the bar wraps and the count keeps its own line.
          compact && "w-full flex-none",
        )}
      >
        <span aria-hidden>
          {`${counted(rangeStats.cells, "cell", "cells")} · ${counted(rangeStats.rows, "row", "rows")} × ${counted(rangeStats.columns, "column", "columns")}`}
        </span>
        <span className="sr-only">
          {`${counted(rangeStats.rows, "row", "rows")} by ${counted(rangeStats.columns, "column", "columns")}, ${counted(rangeStats.cells, "cell", "cells")} selected`}
        </span>
        {/* The copy's result joins the same live region, beside the shape. */}
        {copyNote ? <span className="sr-only">{`. ${copyNote}`}</span> : null}
      </span>
      <button
        type="button"
        className={barButton}
        onClick={() => void copy("tsv", active)}
      >
        Copy
      </button>
      <button
        type="button"
        className={barButton}
        onClick={() => void copy("markdown", active)}
      >
        Copy as Markdown
      </button>
      <button
        type="button"
        className={barButton}
        onClick={() => setAnchor(null)}
      >
        Clear
      </button>
    </div>
  ) : null;

  return (
    <>
    {compact ? (
      <div className="mt-3 flex min-h-11 items-center gap-3">
        {railBefore ? selectToggle : null}
        {rangeBar ? (
          <div className="min-w-0 flex-1">{rangeBar}</div>
        ) : compactStatus ? (
          <div className="min-w-0 flex-1">{compactStatus}</div>
        ) : (
          <p
            className="min-w-0 flex-1 truncate text-[12px] text-muted"
            title="Swipe the table sideways to see every column. Use the ⋯ menu for row actions."
          >
            {selecting ? "Tap the boxes to select rows" : "Swipe for columns · ⋯ for actions"}
          </p>
        )}
        {railBefore ? null : selectToggle}
        {/* With no bar, a single-cell copy still needs a polite surface. */}
        {rangeBar ? null : (
          <span aria-live="polite" className="sr-only">
            {copyNote}
          </span>
        )}
      </div>
    ) : null}
    {compact ? null : (
      <div className="mt-1 h-6">
        {rangeBar ?? (
          <span aria-live="polite" className="sr-only">
            {copyNote}
          </span>
        )}
      </div>
    )}
    <div
      ref={portRef}
      className={cn(
        "rounded-[20px] border border-line bg-surface",
        compact
          ? "mt-2 overflow-x-auto overscroll-x-contain"
          : "mt-1 max-h-[70dvh] overflow-auto overscroll-contain",
        bulkOpen ? "pb-[26rem] sm:pb-[14rem]" : bandOpen ? "pb-[4.5rem]" : "pb-2",
      )}
      onKeyDown={onGridKeyDown}
      onFocus={() => setGridFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setGridFocused(false);
        }
      }}
      onScroll={(event) => {
        setScrolled(event.currentTarget.scrollLeft > 0);
        const el = event.currentTarget;
        setMoreRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
      }}
    >
      <table
        ref={gridRef}
        role="grid"
        aria-label={`${type.name_plural} records`}
        aria-rowcount={rows.length + (summaries.length > 0 ? 2 : 1)}
        aria-colcount={colCount}
        aria-busy={busy}
        aria-multiselectable={canEdit ? true : undefined}
        className="table-fixed border-collapse text-left"
        style={{ width: tableWidth }}
      >
        <colgroup>
          {railBefore ? <col style={{ width: openWidth }} /> : null}
          {showSelect ? <col style={{ width: SELECT_WIDTH }} /> : null}
          <col style={{ width: columnWidth("title") }} />
          {propertyKeys.map((key) => (
            <col key={key} style={{ width: columnWidth(key) }} />
          ))}
          {showAddColumn ? <col style={{ width: ADD_PROPERTY_WIDTH }} /> : null}
          <col style={{ width: tailWidth }} />
          {railBefore ? null : <col style={{ width: openWidth }} />}
        </colgroup>
        <thead
          className={cn(
            // The row owns a stacking context above the body's pinned cells
            // (title and rail carry z-20): at equal z the body, later in the
            // DOM, painted over the header while the page scrolled.
            // The card is its own scrollport, so the header parks at its top on
            // every width; the shell header floats above the card, not inside it.
            "sticky top-0 z-30 bg-raised",
          )}
        >
          <tr className="border-b rule [&>th]:align-top">
            {railBefore ? railHeaderCell : null}
            {showSelect ? (
              <th
                scope="col"
                className="sticky z-30 bg-raised p-0 text-center"
                style={{ left: railBefore ? openWidth : 0 }}
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
                "label relative sticky z-30 border-r rule p-0 pl-3 pr-2 font-medium",
                "bg-raised",
                scrolled && "border-line-strong",
              )}
              style={{ left: pinnedOffset }}
              {...sortHeader("title")}
            >
              <HeaderSort
                columnKey="title"
                label="Title"
                /* The title is the table's one built-in text column; it names
                   its format like every property so the band reads as one row. */
                format="text"
                sort={sortOf("title")}
                onSort={onSort}
                showKey={!compact}
              />
              {canEdit && !compact ? (
                <ColumnResizer
                  label="Title"
                  width={columnWidth("title")}
                  disabled={layoutPending}
                  onPreview={(width) =>
                    setPreview((current) => ({ ...current, title: width }))
                  }
                  onCancel={() => cancelResize("title")}
                  onCommit={(width) => resize("title", width)}
                />
              ) : null}
              <HeaderFormat
                format="text"
                showKey={!compact}
                width={columnWidth("title")}
                inset="left-3"
              />
            </th>
            {propertyKeys.map((key) => {
              const property = propertyByKey.get(key);
              const label = property?.name ?? key;
              return (
                <th
                  key={key}
                  scope="col"
                  className="label relative p-0 pr-2 font-medium"
                  {...sortHeader(key)}
                >
                  <HeaderSort
                    columnKey={key}
                    label={label}
                    format={property?.format}
                    calculated={property?.compute?.kind}
                    sort={sortOf(key)}
                    onSort={onSort}
                    showKey={!compact}
                  />
                  {canEdit && !compact ? (
                    <ColumnResizer
                      label={label}
                      width={columnWidth(key)}
                      disabled={layoutPending}
                      onPreview={(width) =>
                        setPreview((current) => ({ ...current, [key]: width }))
                      }
                      onCancel={() => cancelResize(key)}
                      onCommit={(width) => resize(key, width)}
                    />
                  ) : null}
                  <HeaderFormat
                    format={property?.format}
                    calculated={property?.compute?.kind}
                    showKey={!compact}
                    width={columnWidth(key)}
                  />
                </th>
              );
            })}
            {showAddColumn ? (
              <th scope="col" className="p-0 pr-2 text-left">
                <button
                  type="button"
                  aria-label="Add property"
                  className="inline-flex min-h-8 w-full items-center gap-1 rounded-[8px] px-1 text-[12px] whitespace-nowrap text-faint transition-colors hover:bg-raised hover:text-accent pointer-coarse:min-h-11"
                  onClick={onAddProperty}
                >
                  <Plus aria-hidden size={13} />
                  Add property
                </button>
              </th>
            ) : null}
            <th scope="col" aria-hidden className="p-0" />
            {railBefore ? null : railHeaderCell}
          </tr>
        </thead>
        <tbody className={busy ? "pointer-events-none opacity-60" : undefined}>
          {rows.map((row, rowIndex) => {
            const isSelected = selected.has(row.id);
            const rowActive = active?.row === rowIndex;
            const rowPending = pendingRows.has(row.id);
            const actionCell = (
                <td
                  {...cellProps(rowIndex, actionCol)}
                  aria-label={`Actions for “${row.title}”`}
                  className={cn(
                    railBodyClass,
                    "outline-none",
                    railSeam,
                    isSelected ? selectedSurface : "bg-surface",
                    !isSelected && hoverSurface,
                    isSelected ? railSeamToneSelected : railSeamTone,
                    railBefore ? "text-left" : "text-right",
                  )}
                >
                  <div
                    className={cn(
                      "row-actions flex items-center",
                      railBefore ? "justify-start" : compact ? "justify-center" : "justify-end",
                      compact ? "gap-0" : "gap-0.5",
                    )}
                  >
                    {compact && canEdit ? (
                      <RowActionsMenu
                        spaceId={spaceId}
                        row={row}
                        verb={verb}
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
                    {compact && canEdit ? null : (
                      <Link
                        to={`/s/${spaceId}/o/${row.id}`}
                        aria-label={`Open ${row.title}`}
                        title="Open record"
                        tabIndex={rowActive ? 0 : -1}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full text-faint transition-colors hover:bg-raised hover:text-accent pointer-coarse:h-11 pointer-coarse:w-11 max-sm:h-11 max-sm:w-11"
                      >
                        <ArrowUpRight aria-hidden size={14} />
                      </Link>
                    )}
                  </div>
                </td>
            );
            return (
              <tr
                key={row.id}
                aria-rowindex={rowIndex + 2}
                aria-selected={canEdit ? isSelected : undefined}
                data-active={rowActive ? "true" : undefined}
                className={cn(
                  "group border-b rule align-top transition-colors",
                  isSelected
                    ? selectedSurface
                    : "hover:bg-[color-mix(in_srgb,var(--color-accent)_6%,var(--color-surface))]!",
                  rowActive && "[&>td]:border-t [&>td]:border-line-strong [&>th]:border-t [&>th]:border-line-strong",
                )}
              >
                {railBefore ? actionCell : null}
                {showSelect ? (
                  <td
                    {...cellProps(rowIndex, 0)}
                    aria-label={`Select “${row.title}”`}
                    className={cn(
                      "sticky z-10 py-1 text-center outline-none",
                      isSelected ? selectedSurface : "bg-surface",
                      !isSelected && hoverSurface,
                    )}
                    style={{ left: railBefore ? openWidth : 0 }}
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
                  {...dataCellProps(rowIndex, titleCol)}
                  scope="row"
                  aria-label={
                    canEdit
                      ? `Edit title for “${row.title}”, currently “${row.title}”`
                      : `Title “${row.title}”`
                  }
                  className={cn(
                    "sticky z-20 border-r rule py-1 pr-2 text-left font-normal outline-none",
                    isSelected ||
                      (range !== null &&
                        rangeContains(range, { row: rowIndex, col: titleCol }))
                      ? selectedSurface
                      : "bg-surface",
                    !isSelected &&
                      !(range !== null && rangeContains(range, { row: rowIndex, col: titleCol })) &&
                      (compact ? hoverSurface : hoverSurface),
                    ringOf(rowIndex, titleCol),
                  )}
                  style={{ left: pinnedOffset }}
                >
                  <TitleCell
                    title={row.title}
                    icon={row.icon}
                    canEdit={canEdit}
                    tabIndex={-1}
                    onCommit={(title) => onTitleCommit(row, title)}
                  />
                </th>
                {propertyKeys.map((key, offset) => {
                  const property = propertyByKey.get(key);
                  const cellCol = titleCol + 1 + offset;
                  const inRange =
                    range !== null && rangeContains(range, { row: rowIndex, col: cellCol });
                  if (!property) {
                    return (
                      <td
                        key={key}
                        {...dataCellProps(rowIndex, cellCol)}
                        className={cn(
                          "py-1 pr-2 font-mono text-[11px] text-faint outline-none",
                          inRange && selectedSurface,
                          ringOf(rowIndex, cellCol),
                        )}
                      >
                        {key}
                      </td>
                    );
                  }
                  const label =
                    displayLabel(property, row.values[key]?.value, row.values[key]?.label ?? "");
                  // The column decides the edge: a number sits right unless the
                  // property pins it, and every other format sits left.
                  const align = alignOf(property);
                  return (
                    <td
                      key={key}
                      {...dataCellProps(rowIndex, cellCol)}
                      className={cn(
                        "py-1 pr-2 outline-none",
                        align === "right" ? "text-right" : "text-left",
                        inRange && selectedSurface,
                        ringOf(rowIndex, cellCol),
                      )}
                      aria-label={
                        isComputed(property) || !canEdit
                          ? `${property.name} for “${row.title}”: ${label || "empty"}${isComputed(property) ? ", calculated" : ""}`
                          : `Edit ${property.name} for “${row.title}”, currently “${label || "empty"}”`
                      }
                    >
                      <PropertyCell
                        spaceId={spaceId}
                        timeZone={timeZone}
                        property={property}
                        cell={row.values[key] as ValueJson | undefined}
                        schedule={row.schedule}
                        canEdit={canEdit}
                        rowTitle={row.title}
                        tabIndex={-1}
                        description={computeDescription(property, properties)}
                        onCommit={(cell) => onCellCommit(row, property, cell)}
                      />
                    </td>
                  );
                })}
                {showAddColumn ? <td aria-hidden className="py-1" /> : null}
                <td aria-hidden />
                {railBefore ? null : actionCell}
              </tr>
            );
          })}
        </tbody>
        {summaries.length > 0 ? (
          <tfoot>
            <tr className="border-t rule">
              {railBefore ? (
                <td
                  aria-hidden
                  className={cn(footerCell, footerStick, railEdge, "bg-surface")}
                />
              ) : null}
              {showSelect ? (
                <td aria-hidden className={cn(footerCell, footerStick, "bg-surface")} />
              ) : null}
              {gridColumns.map((column, index) => {
                // A hidden column keeps its place in the row and reads blank;
                // the scope sentence still covers the rows it does not count.
                const hidden = footerHidden.has(column.key);
                return (
                  <td
                    key={column.key}
                    aria-label={hidden ? undefined : summaries[index]?.long}
                    title={hidden ? undefined : summaries[index]?.long}
                    className={cn(
                      footerCell,
                      footerStick,
                      "z-20 bg-surface",
                      alignOf(column) === "right" ? "text-right" : "text-left",
                      // The title column stays pinned on every width, as its body does.
                      index === 0 && "sticky left-0 border-r rule",
                    )}
                    style={index === 0 ? { left: pinnedOffset } : undefined}
                  >
                    {hidden ? null : (
                      <span aria-hidden className="block truncate">
                        {summaries[index]?.short}
                      </span>
                    )}
                  </td>
                );
              })}
              {showAddColumn ? (
                <td aria-hidden className={cn(footerCell, footerStick, "bg-surface")} />
              ) : null}
              <td aria-hidden className={cn(footerCell, footerStick, "bg-surface")} />
              {railBefore ? null : (
                <td
                  aria-hidden
                  className={cn(footerCell, footerStick, railEdge, "bg-surface")}
                />
              )}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
    {rows.length > 0 || (!compact && moreRight) ? (
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-muted">
        {rows.length > 0 && footerShown ? (
          <p>
            {total > rows.length
              ? `Summaries cover the ${rows.length} rows shown, not all ${total}.`
              : `Summaries cover all ${rows.length} rows.`}
          </p>
        ) : null}
        {!compact && moreRight ? (
          <p className="flex items-center gap-1.5">
            <ArrowRight aria-hidden size={12} />
            Scroll sideways for every column
          </p>
        ) : null}
      </div>
    ) : null}
    </>
  );
}

/** The phone-width row menu: the three actions an inline cell would crowd out. */
function RowActionsMenu({
  spaceId,
  row,
  verb,
  completing,
  busy,
  onComplete,
  onDuplicate,
  onTrash,
}: {
  spaceId: string;
  row: ObjectSummary;
  verb: string;
  completing: boolean;
  busy: boolean;
  onComplete: () => void;
  onDuplicate: () => void;
  onTrash: () => void;
}) {
  const canComplete = row.schedule !== undefined && row.schedule.status !== "done";
  const handedness = useThumbHandedness();
  const navigate = useNavigate();
  const item =
    "flex min-h-9 w-full items-center gap-2 rounded-[10px] px-3 text-left text-[13px] text-ink transition-colors hover:bg-raised disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:min-h-11";
  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label={`More actions for “${row.title}”`}
        className="inline-flex h-8 w-8 items-center justify-center rounded-full text-faint transition-colors hover:bg-raised hover:text-accent pointer-coarse:h-11 pointer-coarse:w-11 max-sm:h-11 max-sm:w-11"
      >
        <MoreHorizontal aria-hidden size={16} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          sideOffset={4}
          align={handedness === "left" ? "start" : "end"}
          className="z-50"
        >
          <Popover.Popup className="glass-strong min-w-[11rem] rounded-card p-1.5">
            <Popover.Close
              className={item}
              onClick={() => navigate(`/s/${spaceId}/o/${row.id}`)}
            >
              <ArrowUpRight aria-hidden size={14} />
              Open record
            </Popover.Close>
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
        "inline-flex h-8 w-8 items-center justify-center rounded-full text-faint transition-colors hover:bg-raised disabled:opacity-50 pointer-coarse:h-11 pointer-coarse:w-11",
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
  /** A width write is in flight; a second press waits for it. */
  disabled: boolean;
  onPreview: (width: number) => void;
  onCancel: () => void;
  onCommit: (width: number) => void;
}

/**
 * A keyboard-focusable column edge. A press paints nothing until it travels
 * `DRAG_THRESHOLD`; moves preview continuously and the write happens on
 * release. Arrow keys move 16 px, Shift 64 px.
 */
function ColumnResizer({
  label,
  width,
  disabled,
  onPreview,
  onCancel,
  onCommit,
}: ColumnResizerProps) {
  const [dragging, setDragging] = useState<{ startX: number; startWidth: number } | null>(null);

  return (
    <span
      role="separator"
      aria-label={`Resize ${label} column`}
      aria-orientation="vertical"
      aria-valuenow={width}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      className={cn(
        "absolute inset-y-0 right-0 w-2 cursor-col-resize touch-none border-r border-transparent transition-colors hover:border-line-strong focus-visible:border-accent",
        disabled && "pointer-events-none opacity-50",
      )}
      onPointerDown={(event) => {
        if (disabled) {
          return;
        }
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging({ startX: event.clientX, startWidth: width });
      }}
      onPointerMove={(event) => {
        if (!dragging || !dragMoved(dragging.startX, event.clientX)) {
          return;
        }
        onPreview(dragWidth(dragging.startWidth, dragging.startX, event.clientX));
      }}
      onPointerUp={(event) => {
        if (!dragging) {
          return;
        }
        const moved = dragMoved(dragging.startX, event.clientX);
        const next = dragWidth(dragging.startWidth, dragging.startX, event.clientX);
        setDragging(null);
        if (moved) {
          onCommit(next);
        } else {
          onCancel();
        }
      }}
      onPointerCancel={() => {
        if (!dragging) {
          return;
        }
        setDragging(null);
        onCancel();
      }}
      onKeyDown={(event) => {
        if (disabled) {
          return;
        }
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

/** The words a header's format reads: the calculated kind first, then the format. */
function headerFormatText(format: PropertyFormat, calculated?: ComputeKind): string {
  return calculated
    ? `${calculated === "rollup" ? "Rollup" : "Formula"} · ${formatLabel(format)}`
    : formatLabel(format);
}

function HeaderSort({
  columnKey,
  label,
  format,
  calculated,
  sort,
  onSort,
  showKey,
}: {
  columnKey: string;
  label: string;
  /** A property header names its format on the bottom edge; the title has none. */
  format?: PropertyFormat;
  /** A calculated column marks itself; a stored one has no marker. */
  calculated?: ComputeKind;
  sort: Sort | undefined;
  onSort: (key: string, additive: boolean) => void;
  /** Phones drop the format line; the glyph pair sits beside the label. */
  showKey: boolean;
}) {
  // The header names the property; the format sits on the band's bottom edge,
  // so every column's type reads at one height however many lines the name
  // takes. A phone drops that line, so the same glyph pair rides on the
  // name's first line instead. A narrow column may clamp the name to three
  // lines, so the full name stays the native tooltip and the sort control's
  // accessible label.
  const named = label;
  const calculatedNote = calculated
    ? calculated === "rollup"
      ? ", rollup"
      : ", formula"
    : "";
  const formatText = format ? headerFormatText(format, calculated) : null;
  const FormatGlyph = format ? FORMAT_ICONS[format] : null;
  const CalculatedGlyph = calculated === "rollup" ? Sigma : SquareFunction;
  // A phone has no format line, so the glyph pair's spelling joins the sort
  // control's accessible name; on a wide screen the visible words already do.
  const formatNote =
    format && showKey
      ? calculatedNote
      : formatText
        ? `, ${formatText.replace(" · ", ", ").toLowerCase()}`
        : calculatedNote;
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
      className={cn(
        "flex w-full min-w-0 flex-col items-start gap-0 px-0 py-1.5 text-left transition-colors hover:text-ink pointer-coarse:min-h-11",
        format && showKey && "pb-6",
      )}
      aria-label={`Sort by ${named}${formatNote}, ${state}, activate to ${next}`}
      title={named}
      onClick={(event) => onSort(columnKey, event.shiftKey)}
    >
      {/* The glyphs stay on the first line's top edge, so a wrapped name never
          shifts the sort indicator down with it: every column's arrow reads at
          one height, the same as the name's first line. */}
      <span className="flex w-full min-w-0 items-start gap-1">
        <span className={cn("line-clamp-3 min-w-0 flex-1 break-words", sort && "text-ink")}>
          {label}
        </span>
        {!showKey && formatText ? (
          <span
            role="img"
            aria-label={`${formatText} column`}
            title={formatText}
            className="mt-[3px] flex shrink-0 items-center gap-1 text-faint"
          >
            {calculated ? (
              <CalculatedGlyph aria-hidden size={11} strokeWidth={1.75} />
            ) : null}
            {FormatGlyph ? <FormatGlyph aria-hidden size={11} strokeWidth={1.75} /> : null}
          </span>
        ) : null}
        <span className="mt-[3px] flex w-[11px] shrink-0 items-center">
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
    </button>
  );
}

/**
 * The format line under a property's name. It is positioned against the header
 * cell's bottom edge rather than the button, because the button only grows to
 * its own text: the cell is as tall as the tallest name in the row, and every
 * format must read at the same height. A narrow column shows the glyph pair
 * and keeps the spelling as the tooltip.
 */
function HeaderFormat({
  format,
  calculated,
  showKey,
  width,
  inset = "left-0",
}: {
  format?: PropertyFormat;
  calculated?: ComputeKind;
  showKey: boolean;
  width: number;
  /** The name's left inset; the cell's padding is outside the absolute box. */
  inset?: string;
}) {
  if (!format || !showKey) {
    return null;
  }
  const formatText = headerFormatText(format, calculated);
  // Maple Mono at 11px with the label tracking advances about 7.6px per
  // character; when the words cannot fit inside the cell's padding the header
  // falls back to the format's glyph instead of clipping the spelling.
  const formatFits =
    width - HEADER_RIGHT_PADDING >= Math.ceil(formatText.length * FORMAT_TEXT_ADVANCE);
  const FormatGlyph = FORMAT_ICONS[format];
  const CalculatedGlyph = calculated === "rollup" ? Sigma : SquareFunction;
  return (
    <span
      className={cn("pointer-events-none absolute right-0 bottom-1.5 flex h-[1.5em] items-center pr-2", inset)}
      title={formatText}
    >
      {formatFits ? (
        <span className="min-w-0 max-w-full truncate font-mono text-[length:var(--text-label)] leading-[var(--text-label--line-height)] tracking-[0.09em] text-faint uppercase">
          {formatText}
        </span>
      ) : (
        <span className="flex items-center gap-1 text-faint">
          {calculated ? (
            <CalculatedGlyph aria-hidden size={11} strokeWidth={1.75} />
          ) : null}
          <FormatGlyph aria-hidden size={11} strokeWidth={1.75} />
        </span>
      )}
    </span>
  );
}
