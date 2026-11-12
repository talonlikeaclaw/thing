import { describe, expect, it } from "vitest";

import type { PropertyDisplay } from "@/api/types";
import { alignOf, displayLabel, numberText } from "@/lib/presentation";

/** The plan's grammar table, read left to right. */
const grammar: { display?: PropertyDisplay; at: [number, number, number] }[] = [
  // Absent is the server's label, so this module has nothing to say.
  { display: undefined, at: [1204, 4.7531, 3] },
  { display: { currency: "USD" }, at: [1204, 4.7531, 3] },
  { display: { currency: "USD", decimals: 0 }, at: [1204, 4.7531, 3] },
  { display: { decimals: 1 }, at: [1204, 4.7531, 3] },
  { display: { grouping: false }, at: [1204, 4.7531, 3] },
  { display: { grouping: false, decimals: 2 }, at: [1204, 4.7531, 3] },
];

describe("numberText", () => {
  it("says nothing when the display asks for nothing", () => {
    for (const display of [undefined, {}, { align: "right" }, { grouping: true }] as const) {
      expect(numberText(1204, display, "en-US")).toBeNull();
    }
  });

  it("returns null for a value that never reaches a formatter", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(numberText(value, { decimals: 2 }, "en-US")).toBeNull();
    }
  });

  it("reads the plan's grammar in en-US", () => {
    const expected = [
      [null, null, null],
      ["$1,204.00", "$4.75", "$3.00"],
      ["$1,204", "$5", "$3"],
      ["1,204.0", "4.8", "3.0"],
      ["1204", "4.7531", "3"],
      ["1204.00", "4.75", "3.00"],
    ];
    grammar.forEach((row, index) => {
      row.at.forEach((value, column) => {
        expect(numberText(value, row.display, "en-US"), `${index}/${column}`).toBe(
          expected[index]?.[column],
        );
      });
    });
  });

  it("puts the symbol on the reader's side", () => {
    const display = { currency: "USD" } as const;
    expect(numberText(1204, display, "de-DE")).toBe("1.204,00\u00a0$");
    expect(numberText(1204, display, "en-US")).toBe("$1,204.00");
    // A currency with no minor units keeps the formatter's own count.
    expect(numberText(1204, { currency: "JPY" }, "en-US")).toBe("¥1,204");
  });

  it("rounds at the digit the display fixes", () => {
    expect(numberText(4.5, { decimals: 0 }, "en-US")).toBe("5");
    expect(numberText(4.4, { decimals: 0 }, "en-US")).toBe("4");
    expect(numberText(1.005, { decimals: 2 }, "en-US")).toBe("1.01");
  });

  it("keeps the value's own digits when only the grouping is asked for", () => {
    expect(numberText(4.7531, { grouping: false }, "en-US")).toBe("4.7531");
    expect(numberText(0.1 + 0.2, { grouping: false }, "en-US")).toBe("0.30000000000000004");
  });

  it("falls back rather than guessing at a code Intl does not know", () => {
    for (const currency of ["ZZZ", "usd", "$"]) {
      expect(numberText(1204, { currency }, "en-US"), currency).toBeNull();
    }
    // A real ISO code this runtime has no symbol or name for is not guessed
    // at either: the server's plain label stands.
    expect(numberText(1204, { currency: "XAU" }, "en-US")).toBeNull();
  });
});

describe("displayLabel", () => {
  it("keeps the server's label for every format but a number", () => {
    expect(displayLabel({ format: "text" }, "1204", "1204")).toBe("1204");
    expect(displayLabel({ format: "date" }, "2026-11-11", "Nov 11")).toBe("Nov 11");
    expect(displayLabel({}, 1204, "1204")).toBe("1204");
  });

  it("re-derives a number only when a display has something to say", () => {
    expect(displayLabel({ format: "number" }, 1204, "1204")).toBe("1204");
    expect(
      displayLabel({ format: "number", display: { currency: "USD" } }, 1204, "1204"),
    ).toBe("$1,204.00");
    expect(
      displayLabel({ format: "number", display: { currency: "ZZZ" } }, 1204, "1204"),
    ).toBe("1204");
  });

  it("leaves a non-number value alone even under a number format", () => {
    expect(displayLabel({ format: "number", display: { decimals: 2 } }, null, "")).toBe("");
  });
});

describe("alignOf", () => {
  it("right-aligns a number and left-aligns everything else", () => {
    expect(alignOf({ format: "number" })).toBe("right");
    expect(alignOf({ format: "text" })).toBe("left");
    expect(alignOf({})).toBe("left");
  });

  it("lets the display override either way", () => {
    expect(alignOf({ format: "number", display: { align: "left" } })).toBe("left");
    expect(alignOf({ format: "text", display: { align: "right" } })).toBe("right");
    // `auto` is never stored, but a hand-edited file may carry it.
    expect(alignOf({ format: "number", display: { align: "auto" } })).toBe("right");
    expect(alignOf({ format: "text", display: { align: "auto" } })).toBe("left");
  });
});
