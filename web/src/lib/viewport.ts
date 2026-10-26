/**
 * The on-screen keyboard is invisible to layout. On iOS Safari the layout
 * viewport never changes when the keyboard opens — only the *visual* viewport
 * shrinks — and Chrome only resizes the layout viewport because the document
 * opts in with `interactive-widget=resizes-content`. So a sheet positioned
 * against `inset: 0` or `100dvh` is measured against a viewport that includes
 * the keyboard, and its footer ends up underneath it.
 *
 * These helpers turn `visualViewport` into three custom properties that the
 * sheet geometry in `globals.css` reads. One listener therefore fixes every
 * overlay, instead of each dialog guessing at `vh` units.
 */

export interface VisualViewportMetrics {
  /** Visible height in CSS pixels; equals the layout viewport with no keyboard. */
  height: number;
  /** How far the visible area is panned below the layout viewport's top. */
  top: number;
  /** The height the keyboard occupies, or 0. */
  keyboard: number;
}

/**
 * Everything the geometry needs from one frame of `visualViewport`.
 *
 * A panned viewport (`offsetTop > 0`) is the case iOS produces when it scrolls
 * the page to keep a focused field visible; the keyboard then covers whatever
 * is left below the visible area, which is `innerHeight - top - height`.
 */
export function metricsFor(
  view: { height: number; offsetTop: number },
  innerHeight: number,
): VisualViewportMetrics {
  const height = Math.max(0, Math.round(view.height));
  const top = Math.max(0, Math.round(view.offsetTop));
  const keyboard = Math.max(0, Math.round(innerHeight) - top - height);
  return { height, top, keyboard };
}

/** Publish the metrics where CSS reads them: on the document element. */
export function applyViewportMetrics(
  root: HTMLElement,
  metrics: VisualViewportMetrics,
): void {
  root.style.setProperty("--vv-height", `${metrics.height}px`);
  root.style.setProperty("--vv-top", `${metrics.top}px`);
  root.style.setProperty("--kb-height", `${metrics.keyboard}px`);
}

/**
 * Watch the visual viewport and report on the next animation frame at most.
 * Returns the unsubscribe function; a browser without `visualViewport` (or
 * jsdom) simply never reports, and the CSS falls back to `100dvh`.
 */
export function subscribeVisualViewport(
  onMetrics: (metrics: VisualViewportMetrics) => void,
): () => void {
  const view = typeof window === "undefined" ? null : window.visualViewport;
  if (!view) {
    return () => {};
  }

  let frame = 0;
  const read = () => {
    frame = 0;
    onMetrics(metricsFor(view, window.innerHeight));
  };
  const schedule = () => {
    if (frame === 0) {
      frame = window.requestAnimationFrame(read);
    }
  };

  view.addEventListener("resize", schedule);
  view.addEventListener("scroll", schedule);
  window.addEventListener("orientationchange", schedule);
  read();

  return () => {
    if (frame !== 0) {
      window.cancelAnimationFrame(frame);
    }
    view.removeEventListener("resize", schedule);
    view.removeEventListener("scroll", schedule);
    window.removeEventListener("orientationchange", schedule);
  };
}
