import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyViewportMetrics,
  metricsFor,
  subscribeVisualViewport,
} from "@/lib/viewport";

describe("visual viewport metrics", () => {
  it("reports no keyboard when the visible area fills the layout viewport", () => {
    expect(metricsFor({ height: 844, offsetTop: 0 }, 844)).toEqual({
      height: 844,
      top: 0,
      keyboard: 0,
    });
  });

  it("measures a keyboard that covers the bottom of the page", () => {
    expect(metricsFor({ height: 480, offsetTop: 0 }, 844)).toEqual({
      height: 480,
      top: 0,
      keyboard: 364,
    });
  });

  it("subtracts the pan as well as the keyboard", () => {
    // iOS scrolled the page up by 100 and the keyboard covers 364.
    expect(metricsFor({ height: 380, offsetTop: 100 }, 844)).toEqual({
      height: 380,
      top: 100,
      keyboard: 364,
    });
  });

  it("never reports a negative keyboard or top", () => {
    expect(metricsFor({ height: 900, offsetTop: -20 }, 844)).toEqual({
      height: 900,
      top: 0,
      keyboard: 0,
    });
  });

  it("rounds fractional device pixels", () => {
    expect(metricsFor({ height: 479.6, offsetTop: 0.4 }, 844)).toEqual({
      height: 480,
      top: 0,
      keyboard: 364,
    });
  });
});

describe("applyViewportMetrics", () => {
  it("writes the three custom properties the sheet geometry reads", () => {
    const root = document.createElement("div");
    applyViewportMetrics(root, { height: 480, top: 12, keyboard: 352 });
    expect(root.style.getPropertyValue("--vv-height")).toBe("480px");
    expect(root.style.getPropertyValue("--vv-top")).toBe("12px");
    expect(root.style.getPropertyValue("--kb-height")).toBe("352px");
  });

  it("flags whether the keyboard is up, for the sheet footer inset", () => {
    const root = document.createElement("div");
    applyViewportMetrics(root, { height: 480, top: 0, keyboard: 364 });
    expect(root.dataset.keyboard).toBe("on");
    applyViewportMetrics(root, { height: 844, top: 0, keyboard: 0 });
    expect(root.dataset.keyboard).toBe("off");
  });
});

describe("subscribeVisualViewport", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("does nothing when the browser has no visualViewport", () => {
    const unsubscribe = subscribeVisualViewport(() => {
      throw new Error("must not report without a visual viewport");
    });
    expect(() => unsubscribe()).not.toThrow();
  });

  it("reports immediately, then once per frame on resize, and unsubscribes", () => {
    vi.useFakeTimers();
    const listeners = new Map<string, () => void>();
    const view = {
      height: 844,
      offsetTop: 0,
      addEventListener: (type: string, listener: () => void) => {
        listeners.set(type, listener);
      },
      removeEventListener: (type: string) => {
        listeners.delete(type);
      },
    };
    vi.stubGlobal("visualViewport", view);
    vi.stubGlobal("innerHeight", 844);

    const seen: number[] = [];
    const unsubscribe = subscribeVisualViewport((metrics) => seen.push(metrics.keyboard));
    expect(seen).toEqual([0]);

    view.height = 480;
    listeners.get("resize")?.();
    listeners.get("scroll")?.();
    vi.advanceTimersByTime(20);
    expect(seen).toEqual([0, 364]);

    unsubscribe();
    expect(listeners.size).toBe(0);
  });
});
