import "@testing-library/jest-dom/vitest";

// jsdom has no layout engine and no media queries. The app reads both on the
// paths these component tests exercise, so a no-op stand-in keeps the real
// components mounted instead of mocking their helpers.
if (typeof window !== "undefined") {
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = (query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }) as MediaQueryList;
  }
  if (typeof HTMLElement.prototype.scrollIntoView !== "function") {
    HTMLElement.prototype.scrollIntoView = () => undefined;
  }
  // The table's width plan observes its scrollport; jsdom has no observer.
  if (typeof globalThis.ResizeObserver !== "function") {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
  }
  // jsdom defines the method but logs "not implemented" when it is called.
  window.scrollTo = () => undefined;
}
