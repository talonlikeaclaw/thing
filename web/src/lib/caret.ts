//! Where the caret sits inside a textarea, so a menu can hang from it.
//!
//! A textarea exposes no caret geometry, so the offset is measured by mirroring
//! the field's computed text style into an off-screen div and reading a
//! zero-width marker's box. The arithmetic that turns that measurement into a
//! position inside the field is a pure function, tested on its own.

/** A caret box in the field's content coordinates. */
export interface CaretPoint {
  top: number;
  left: number;
  height: number;
}

/** The scrolled distance of a textarea's content. */
export interface ScrollOffset {
  top: number;
  left: number;
}

/** The field's visible box, in CSS pixels. */
export interface CaretBox {
  width: number;
  height: number;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/**
 * Places a mirror-measured caret inside the field's scroll box.
 *
 * The measurement is in content coordinates, so the scroll offset is removed
 * and the result is clamped to the visible box: a caret scrolled out of sight
 * anchors the menu at the nearest edge instead of outside the field.
 */
export function caretPoint(measured: CaretPoint, scroll: ScrollOffset, box: CaretBox): CaretPoint {
  const height = Math.max(0, measured.height);
  return {
    top: clamp(measured.top - scroll.top, 0, Math.max(0, box.height - height)),
    left: clamp(measured.left - scroll.left, 0, Math.max(0, box.width - 1)),
    height,
  };
}

/** The text properties a mirror must copy to measure the same line boxes. */
const MIRROR_PROPERTIES = [
  "border-bottom-width",
  "border-left-width",
  "border-right-width",
  "border-top-width",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "letter-spacing",
  "line-height",
  "padding-bottom",
  "padding-left",
  "padding-right",
  "padding-top",
  "tab-size",
  "text-indent",
  "text-transform",
  "word-break",
] as const;

/**
 * The caret's box inside `field`, or `null` when there is no document to
 * measure against (a test environment without a layout engine still gets a box
 * of zeros, which the caller clamps).
 */
export function caretRect(field: HTMLTextAreaElement, offset: number): CaretPoint | null {
  const measured = caretContent(field, offset);
  if (!measured) {
    return null;
  }
  return caretPoint(
    measured,
    { top: field.scrollTop, left: field.scrollLeft },
    { width: field.clientWidth, height: field.clientHeight },
  );
}

/**
 * The caret's box in the field's content coordinates, before scroll is
 * removed. This is what a scroll adjustment needs; `caretRect` is the
 * on-screen version a menu uses.
 */
export function caretContent(
  field: HTMLTextAreaElement,
  offset: number,
): CaretPoint | null {
  if (typeof document === "undefined") {
    return null;
  }
  const style = window.getComputedStyle(field);
  const mirror = document.createElement("div");
  for (const property of MIRROR_PROPERTIES) {
    mirror.style.setProperty(property, style.getPropertyValue(property));
  }
  mirror.style.position = "absolute";
  mirror.style.top = "-9999px";
  mirror.style.left = "-9999px";
  mirror.style.width = `${field.clientWidth}px`;
  mirror.style.boxSizing = "border-box";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.overflowWrap = "break-word";
  mirror.style.overflow = "hidden";
  mirror.style.visibility = "hidden";
  mirror.textContent = field.value.slice(0, offset);

  const marker = document.createElement("span");
  marker.textContent = "\u200b";
  mirror.append(marker);
  document.body.append(mirror);
  const measured: CaretPoint = {
    top: marker.offsetTop,
    left: marker.offsetLeft,
    height: marker.offsetHeight || Number.parseFloat(style.lineHeight) || 18,
  };
  mirror.remove();

  return measured;
}

/**
 * The scrollTop that brings a content-coordinate caret fully inside a field of
 * height `boxHeight`. It moves by the smallest amount needed, so a visible
 * caret never jumps.
 */
export function scrollTopForCaret(
  caret: CaretPoint,
  scrollTop: number,
  boxHeight: number,
  margin = 0,
): number {
  const top = Math.max(0, caret.top);
  const height = Math.max(0, caret.height);
  const soft = Math.max(0, margin);
  if (top - soft < scrollTop) {
    return Math.max(0, top - soft);
  }
  if (top + height + soft > scrollTop + boxHeight) {
    return Math.max(0, top + height + soft - boxHeight);
  }
  return scrollTop;
}
