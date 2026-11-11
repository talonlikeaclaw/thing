import { describe, expect, it } from "vitest";

import {
  formulaHints,
  formulaToken,
  insideString,
  insertHint,
} from "@/lib/formula-hints";

const references = [
  { key: "days_since_watered", name: "Days since watered" },
  { key: "price", name: "Price" },
  { key: "today", name: "Today" },
  { key: "title", name: "Title" },
];

describe("formula hints", () => {
  it("finds the identifier around the caret", () => {
    expect(formulaToken("price * quantity", 5)).toEqual({
      start: 0,
      end: 5,
      token: "price",
    });
    expect(formulaToken("price * quantity", 10)).toEqual({
      start: 8,
      end: 16,
      token: "quantity",
    });
  });

  it("offers matching properties before functions and keywords", () => {
    const hints = formulaHints(references, "pri", 3);
    expect(hints[0]).toMatchObject({ value: "price", kind: "property" });
    expect(hints.map((hint) => hint.value)).not.toContain("today");
  });

  it("does not offer a property a function shadows", () => {
    const hints = formulaHints(references, "today", 5);
    expect(hints[0]).toMatchObject({ value: "today", kind: "function" });
    expect(hints.filter((hint) => hint.kind === "property")).toHaveLength(0);
  });

  it("stays quiet inside a string literal", () => {
    expect(insideString('if(stock > 0, "In stock", "Out")', 22)).toBe(true);
    expect(formulaHints(references, 'if(stock > 0, "In', 17)).toEqual([]);
  });

  it("inserts a property over the token, and a function with its parenthesis", () => {
    expect(insertHint("pri * 2", 3, { value: "price", label: "Price", kind: "property" })).toEqual({
      expression: "price * 2",
      caret: 5,
    });
    expect(
      insertHint("da", 2, { value: "days", label: "days", kind: "function" }),
    ).toEqual({ expression: "days(", caret: 5 });
    expect(
      insertHint("days()", 4, { value: "days", label: "days", kind: "function" }),
    ).toEqual({ expression: "days()", caret: 4 });
  });
});
