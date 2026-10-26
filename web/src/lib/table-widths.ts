import type { ViewDef } from "@/api/types";
import { clampWidth, defaultWidth } from "@/lib/views";

/** A pointer must travel this far before a resize starts. */
export const DRAG_THRESHOLD = 3;

/**
 * The width one column paints: its saved width, clamped. There is no
 * proportional fit — a wide window gets a filler column instead of narrower
 * data columns, so a drag moves the column under the finger and nothing else.
 */
export function savedWidth(view: ViewDef, key: string): number {
  return clampWidth(defaultWidth(view, key));
}

/** Every flex column's saved width, in render order. */
export function savedWidths(
  view: ViewDef,
  keys: readonly string[],
): Record<string, number> {
  const widths: Record<string, number> = {};
  for (const key of keys) {
    widths[key] = savedWidth(view, key);
  }
  return widths;
}

export interface WidthPlan {
  /** Painted width per key; always the saved width. */
  widths: Record<string, number>;
  /** The empty trailing column that absorbs the window's leftover space. */
  filler: number;
  /** The table's CSS width in pixels. */
  tableWidth: number;
}

/**
 * The table's width model. `fixed` is every column that is not a data column
 * (selection, add-property, the trailing spacer and the action rail). The
 * table fills `port` exactly when the columns fit and grows past it — one
 * scroller, no reflow — when they do not.
 */
export function widthPlan(
  widths: Readonly<Record<string, number>>,
  port: number,
  fixed: number,
): WidthPlan {
  let sum = 0;
  for (const width of Object.values(widths)) {
    sum += width;
  }
  const filler = Math.max(0, port - fixed - sum);
  return { widths: { ...widths }, filler, tableWidth: fixed + sum + filler };
}

/** Pixels a pointer has travelled since it went down. */
export function dragDelta(startX: number, clientX: number): number {
  return Math.round(clientX - startX);
}

/** Whether a drag has travelled far enough to resize anything. */
export function dragMoved(startX: number, clientX: number): boolean {
  return Math.abs(dragDelta(startX, clientX)) >= DRAG_THRESHOLD;
}

/** The width a drag paints: the start width plus the distance dragged. */
export function dragWidth(
  startWidth: number,
  startX: number,
  clientX: number,
): number {
  return clampWidth(startWidth + dragDelta(startX, clientX));
}
