import { useEffect } from "react";

/**
 * The Schedule and the Calendar are one place read two ways, so the door
 * between them keeps the reader's position: the page it leaves notes the
 * offset, and the page it lands on restores it.
 *
 * The restore has to wait. A landed page paints its shell before its reads
 * answer, the short frame cannot hold a scrolled page, and the browser clamps
 * the offset to whatever fits. So the hook holds the noted position until the
 * page can hold it, and settles for the height the page does have at the end
 * of a short window. A reader who wheels, touches or presses a key first wins:
 * the page never moves under them.
 *
 * The note is cleared only when the restore finishes, never when the effect is
 * torn down: a development double-mount would otherwise eat the position
 * before the second run could read it.
 */
const KEY = "thing:dated-scroll";
/** How long the landed page may take to grow into the noted position. */
const RESTORE_WINDOW_MS = 1200;

/** Notes where the reader was, from the door's own click. */
export function keepDatedScroll(event: {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): void {
  // A modified click opens another tab or window; it is not a switch.
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return;
  }
  try {
    sessionStorage.setItem(KEY, String(window.scrollY));
  } catch {
    // A refused write only means the door lands at the top.
  }
}

function notedPosition(): number {
  try {
    return Number(sessionStorage.getItem(KEY) ?? "");
  } catch {
    return 0;
  }
}

function clearNotedPosition(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to clear when storage refuses the write.
  }
}

/** Restores the position the door noted, once the page can hold it. */
export function useKeptDatedScroll(): void {
  useEffect(() => {
    const target = notedPosition();
    if (!Number.isFinite(target) || target <= 0) {
      return;
    }

    let taken = false;
    const takeOver = () => {
      taken = true;
    };
    // The gestures that mean the reader took over; a clamp fires a scroll event
    // of its own, so listening to scrolling cannot tell the two apart.
    window.addEventListener("wheel", takeOver, { passive: true });
    window.addEventListener("touchmove", takeOver, { passive: true });
    window.addEventListener("keydown", takeOver);
    const removeWatchers = () => {
      window.removeEventListener("wheel", takeOver);
      window.removeEventListener("touchmove", takeOver);
      window.removeEventListener("keydown", takeOver);
    };
    const finish = () => {
      removeWatchers();
      clearNotedPosition();
    };

    const until = performance.now() + RESTORE_WINDOW_MS;
    let frame = requestAnimationFrame(function step() {
      if (taken) {
        finish();
        return;
      }
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (performance.now() > until) {
        // Settle where the landed page can actually hold the reader.
        window.scrollTo(0, Math.min(target, Math.max(0, max)));
        finish();
        return;
      }
      // A page that is still growing can shrink a frame later and clamp the
      // scroll it just took, so the position is held every frame until the
      // window closes rather than applied once.
      if (max >= target) {
        window.scrollTo(0, target);
      }
      frame = requestAnimationFrame(step);
    });

    return () => {
      cancelAnimationFrame(frame);
      removeWatchers();
    };
  }, []);
}
