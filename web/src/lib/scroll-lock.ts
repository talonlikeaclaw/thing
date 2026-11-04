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
 * A pinned body stops the layout scroller, not the visual viewport. iOS can
 * still pan that when a sheet has nothing to scroll — the capture sheet with
 * its optional fields folded is exactly that shape — so the background moves
 * under the panel. Cancelling the gesture unless it starts inside a scroll
 * container that has room leaves every real scroller alone.
 */
function hasRoomToScroll(target: EventTarget | null): boolean {
  let node = target instanceof Element ? target : null;
  while (node) {
    if (node instanceof HTMLElement) {
      const style = getComputedStyle(node);
      const scrolls = style.overflowY === "auto" || style.overflowY === "scroll";
      if (scrolls && node.scrollHeight > node.clientHeight + 1) {
        return true;
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
  const target = event.target;
  if (
    !(target instanceof Element) ||
    !target.closest(".sheet-popup") ||
    !hasRoomToScroll(target)
  ) {
    event.preventDefault();
  }
}

export function lockDocumentScroll(): () => void {
  if (typeof document === "undefined") {
    return () => {};
  }

  locks += 1;
  if (locks === 1) {
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
    document.removeEventListener("touchmove", blockBackgroundScroll);
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
