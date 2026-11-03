import { describe, expect, it } from "vitest";

import { caretPoint, scrollTopForCaret } from "@/lib/caret";

describe("caretPoint", () => {
  it("keeps a caret that is already inside the field", () => {
    expect(caretPoint({ top: 40, left: 12, height: 20 }, { top: 0, left: 0 }, { width: 400, height: 300 })).toEqual({
      top: 40,
      left: 12,
      height: 20,
    });
  });

  it("subtracts the scrolled distance", () => {
    expect(caretPoint({ top: 400, left: 90, height: 20 }, { top: 360, left: 80 }, { width: 400, height: 300 })).toEqual({
      top: 40,
      left: 10,
      height: 20,
    });
  });

  it("clamps a caret scrolled above or left of the field", () => {
    expect(caretPoint({ top: 10, left: 4, height: 20 }, { top: 60, left: 30 }, { width: 400, height: 300 })).toEqual({
      top: 0,
      left: 0,
      height: 20,
    });
  });

  it("clamps the top so the caret's line stays inside the box", () => {
    expect(caretPoint({ top: 900, left: 0, height: 20 }, { top: 0, left: 0 }, { width: 400, height: 300 })).toEqual({
      top: 280,
      left: 0,
      height: 20,
    });
  });

  it("keeps the left edge inside the field's width", () => {
    expect(caretPoint({ top: 10, left: 500, height: 20 }, { top: 0, left: 0 }, { width: 400, height: 300 })).toEqual({
      top: 10,
      left: 399,
      height: 20,
    });
  });

  it("never reports a negative geometry for a hidden field", () => {
    expect(caretPoint({ top: -30, left: -12, height: -4 }, { top: 0, left: 0 }, { width: 0, height: 0 })).toEqual({
      top: 0,
      left: 0,
      height: 0,
    });
  });
});

describe("scrollTopForCaret", () => {
  it("leaves an already visible caret alone", () => {
    expect(scrollTopForCaret({ top: 40, left: 0, height: 20 }, 20, 200)).toBe(20);
  });

  it("scrolls up to a caret above the viewport", () => {
    expect(scrollTopForCaret({ top: 10, left: 0, height: 20 }, 80, 200)).toBe(10);
  });

  it("scrolls down by the smallest amount that reveals the caret", () => {
    expect(scrollTopForCaret({ top: 300, left: 0, height: 20 }, 40, 200)).toBe(120);
  });

  it("keeps a soft margin below the caret", () => {
    expect(scrollTopForCaret({ top: 300, left: 0, height: 20 }, 40, 200, 60)).toBe(180);
  });
});
