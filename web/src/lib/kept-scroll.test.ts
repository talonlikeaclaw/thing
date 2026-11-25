import { beforeEach, describe, expect, it } from "vitest";

import { keepDatedScroll } from "@/lib/kept-scroll";

const KEY = "thing:dated-scroll";

function click(patch: Partial<{ button: number; metaKey: boolean; ctrlKey: boolean }> = {}) {
  return {
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...patch,
  };
}

describe("keepDatedScroll", () => {
  beforeEach(() => {
    sessionStorage.clear();
    Object.defineProperty(window, "scrollY", { value: 240, configurable: true });
  });

  it("notes the offset a plain click leaves", () => {
    keepDatedScroll(click());
    expect(sessionStorage.getItem(KEY)).toBe("240");
  });

  it("leaves the note alone for a click that opens another tab", () => {
    Object.defineProperty(window, "scrollY", { value: 10, configurable: true });
    keepDatedScroll(click());
    Object.defineProperty(window, "scrollY", { value: 900, configurable: true });
    keepDatedScroll(click({ metaKey: true }));
    keepDatedScroll(click({ ctrlKey: true }));
    keepDatedScroll(click({ button: 1 }));
    expect(sessionStorage.getItem(KEY)).toBe("10");
  });
});
