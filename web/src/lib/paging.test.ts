import { describe, expect, it } from "vitest";

import { clampPage, pageCount, pageFromParam, pageRange, PAGE_SIZE } from "@/lib/paging";

describe("pageFromParam", () => {
  it("defaults to the first page", () => {
    expect(pageFromParam(null)).toBe(1);
    expect(pageFromParam("")).toBe(1);
    expect(pageFromParam("0")).toBe(1);
    expect(pageFromParam("-3")).toBe(1);
    expect(pageFromParam("abc")).toBe(1);
  });

  it("reads a positive integer page", () => {
    expect(pageFromParam("2")).toBe(2);
    expect(pageFromParam("3.9")).toBe(3);
  });
});

describe("pageCount", () => {
  it("counts pages of fifty rows and always keeps one page", () => {
    expect(pageCount(0)).toBe(1);
    expect(pageCount(1)).toBe(1);
    expect(pageCount(PAGE_SIZE)).toBe(1);
    expect(pageCount(PAGE_SIZE + 1)).toBe(2);
    expect(pageCount(PAGE_SIZE * 3)).toBe(3);
  });
});

describe("clampPage", () => {
  it("keeps the page inside the result set", () => {
    expect(clampPage(0, 120)).toBe(1);
    expect(clampPage(2, 120)).toBe(2);
    expect(clampPage(9, 120)).toBe(3);
    expect(clampPage(9, 0)).toBe(1);
  });
});

describe("pageRange", () => {
  it("returns a one-based inclusive range for the loaded page", () => {
    expect(pageRange(120, 1)).toEqual({ offset: 0, limit: 50, first: 1, last: 50 });
    expect(pageRange(120, 2)).toEqual({ offset: 50, limit: 50, first: 51, last: 100 });
    expect(pageRange(120, 3)).toEqual({ offset: 100, limit: 50, first: 101, last: 120 });
  });

  it("reports an empty range for an empty type", () => {
    expect(pageRange(0, 1)).toEqual({ offset: 0, limit: 50, first: 0, last: 0 });
  });

  it("clamps a page past the end", () => {
    expect(pageRange(10, 5)).toEqual({ offset: 0, limit: 50, first: 1, last: 10 });
  });
});
