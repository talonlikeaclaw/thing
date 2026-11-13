/**
 * iOS Safari keeps the html element as the scroller even after a dialog hides
 * the body's overflow, so a sheet's backdrop can still drag the page under the
 * panel. Pinning the body is the lock WebKit obeys.
 *
 * Base UI locks first (a layout effect runs before the observer that calls
 * this), and on a desktop with inset scrollbars it already pins the body. This
 * lock defers to that pin and only adds one when the body was left in flow.
 * The count is shared because a picker can open inside a sheet.
 */

interface SavedDocument {
  y: number;
  position: string;
  top: string;
  left: string;
  right: string;
  width: string;
  rootOverflow: string;
}

let locks = 0;
let saved: SavedDocument | null = null;

/**
 * A touch that moves less than this is a tap, not a pan. Cancelling it would
 * eat the click the tap was for, so the threshold is what keeps a tab in the
 * View sheet's strip selectable on a phone.
 */
const TAP_SLOP = 6;

/** Where the current single-finger gesture began, in client coordinates. */
let panStart: { x: number; y: number } | null = null;

function trackPanStart(event: TouchEvent) {
  const touch = event.touches[0];
  panStart = touch ? { x: touch.clientX, y: touch.clientY } : null;
}

function clearPanStart() {
  panStart = null;
}

/**
 * A pinned body stops the layout scroller, not the visual viewport. iOS can
 * still pan that when a sheet has nothing to scroll — the capture sheet with
 * its optional fields folded is exactly that shape — so the background moves
 * under the panel. Cancelling the gesture unless it starts inside a scroll
 * container that has room leaves every real scroller alone.
 *
 * The axis is the gesture's own: the View sheet's tab strip scrolls sideways
 * inside a sheet that does not, and a vertical-only test cancels that pan and
 * the tap that follows it on iOS.
 */
function hasRoomToScroll(
  target: EventTarget | null,
  dx: number,
  dy: number,
): boolean {
  const horizontal = Math.abs(dx) > Math.abs(dy);
  let node = target instanceof Element ? target : null;
  while (node) {
    if (node instanceof HTMLElement) {
      const style = getComputedStyle(node);
      if (horizontal) {
        const scrolls = style.overflowX === "auto" || style.overflowX === "scroll";
        if (scrolls && node.scrollWidth > node.clientWidth + 1) {
          return true;
        }
      } else {
        const scrolls = style.overflowY === "auto" || style.overflowY === "scroll";
        if (scrolls && node.scrollHeight > node.clientHeight + 1) {
          return true;
        }
      }
    }
    if (node.classList.contains("sheet-popup")) {
      return false;
    }
    node = node.parentElement;
  }
  return false;
}

function blockBackgroundScroll(event: TouchEvent) {
  if (event.touches.length > 1) {
    return;
  }
  const touch = event.touches[0];
  const dx = touch && panStart ? touch.clientX - panStart.x : 0;
  const dy = touch && panStart ? touch.clientY - panStart.y : 0;
  if (Math.abs(dx) < TAP_SLOP && Math.abs(dy) < TAP_SLOP) {
    return;
  }
  const target = event.target;
  if (
    !(target instanceof Element) ||
    !target.closest(".sheet-popup") ||
    !hasRoomToScroll(target, dx, dy)
  ) {
    event.preventDefault();
  }
}

/**
 * Run a scroll once no sheet holds the body pinned. A route change can mount
 * the next page before the sheet it replaced unmounts, and a scroll while the
 * body is fixed lands nowhere — the sheet's release would then drop the reader
 * at the top of the page they just opened. Retries per frame, bounded, and the
 * caller's cleanup cancels it.
 */
export function whenScrollUnlocked(run: () => void): () => void {
  if (typeof document === "undefined") {
    return () => {};
  }
  let cancelled = false;
  let frames = 0;
  let frame = 0;
  const attempt = () => {
    if (cancelled) {
      return;
    }
    frames += 1;
    if (
      frames < 120 &&
      (locks > 0 || document.body.style.position === "fixed")
    ) {
      frame = window.requestAnimationFrame(attempt);
      return;
    }
    run();
  };
  frame = window.requestAnimationFrame(attempt);
  return () => {
    cancelled = true;
    window.cancelAnimationFrame(frame);
  };
}

export function lockDocumentScroll(): () => void {
  if (typeof document === "undefined") {
    return () => {};
  }

  locks += 1;
  if (locks === 1) {
    document.addEventListener("touchstart", trackPanStart, { passive: true });
    document.addEventListener("touchend", clearPanStart, { passive: true });
    document.addEventListener("touchcancel", clearPanStart, { passive: true });
    document.addEventListener("touchmove", blockBackgroundScroll, { passive: false });
  }
  if (locks === 1 && document.body.style.position !== "fixed") {
    const body = document.body;
    const root = document.documentElement;
    saved = {
      y: window.scrollY,
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      rootOverflow: root.style.overflow,
    };
    body.style.position = "fixed";
    body.style.top = `-${saved.y}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
    root.style.overflow = "hidden";
  }

  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    locks -= 1;
    if (locks > 0) {
      return;
    }
    document.removeEventListener("touchstart", trackPanStart);
    document.removeEventListener("touchend", clearPanStart);
    document.removeEventListener("touchcancel", clearPanStart);
    document.removeEventListener("touchmove", blockBackgroundScroll);
    panStart = null;
    if (saved === null) {
      return;
    }
    const body = document.body;
    const root = document.documentElement;
    const restore = saved;
    saved = null;
    body.style.position = restore.position;
    body.style.top = restore.top;
    body.style.left = restore.left;
    body.style.right = restore.right;
    body.style.width = restore.width;
    root.style.overflow = restore.rootOverflow;
    // The pinned body had no scroll offset; put the reader back where they were.
    window.scrollTo(0, restore.y);
  };
}
