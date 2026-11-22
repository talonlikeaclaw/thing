import { describe, expect, it } from "vitest";

import {
  FORMULA_FUNCTION_GROUPS,
  FORMULA_FUNCTIONS,
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

  it("offers nothing until a name is under way", () => {
    expect(formulaHints(references, "", 0)).toEqual([]);
    expect(formulaHints(references, "price + ", 8)).toEqual([]);
    expect(formulaHints(references, "price + da", 10)[0]).toMatchObject({
      value: "days_since_watered",
    });
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

  it("inserts an operator between spaces on either side", () => {
    expect(
      insertHint("price2", 5, { value: "*", label: "*", kind: "operator" }),
    ).toEqual({ expression: "price * 2", caret: 8 });
    expect(insertHint("price", 5, { value: "+", label: "+", kind: "operator" })).toEqual({
      expression: "price +",
      caret: 7,
    });
    expect(insertHint("", 0, { value: "-", label: "-", kind: "operator" })).toEqual({
      expression: "-",
      caret: 1,
    });
    expect(
      insertHint("today()", 6, { value: "+", label: "+", kind: "operator" }),
    ).toEqual({ expression: "today(+)", caret: 7 });
  });

  it("categorizes every function exactly once", () => {
    const grouped = FORMULA_FUNCTION_GROUPS.flatMap((group) => group.names);
    expect(grouped).toEqual([...FORMULA_FUNCTIONS]);
    expect(new Set(grouped).size).toBe(grouped.length);
    expect(FORMULA_FUNCTION_GROUPS.map((group) => group.title)).toEqual([
      "Logic",
      "Numbers",
      "Text",
      "Dates",
    ]);
  });
});
