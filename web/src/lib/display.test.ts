import { describe, expect, it } from "vitest";

import { ApiError } from "@/api/client";
import {
  formatDate,
  formatDateTime,
  formatDay,
  readApiCreated,
  readApiProblems,
} from "@/lib/display";

describe("readApiProblems", () => {
  it("keeps every row and field from details.errors", () => {
    const error = new ApiError(422, "validation_failed", "one row was refused", {
      errors: [
        { row: 2, field: "room", message: "unknown option" },
        { row: 4, field: "due_date", message: "not a date" },
      ],
    });

    expect(readApiProblems(error)).toEqual([
      { row: 2, field: "room", message: "unknown option" },
      { row: 4, field: "due_date", message: "not a date" },
    ]);
  });

  it("falls back to the envelope's field and message", () => {
    const error = new ApiError(422, "validation_failed", "title is required", {
      field: "title",
    });

    expect(readApiProblems(error)).toEqual([
      { field: "title", message: "title is required" },
    ]);
  });

  it("ignores a non-Api error and entries without a usable message", () => {
    expect(readApiProblems(new Error("offline"))).toEqual([]);
    const error = new ApiError(422, "validation_failed", "refused", {
      errors: [{ row: 1 }, { field: "room" }] as never,
    });
    expect(readApiProblems(error)).toEqual([
      { row: 1, message: "refused" },
      { field: "room", message: "refused" },
    ]);
  });
});

describe("readApiCreated", () => {
  it("counts the records a partial import wrote", () => {
    const error = new ApiError(500, "internal", "stopped mid-import", {
      created: [{ id: "a", title: "Fern" }, { id: "b", title: "Moss" }],
    });
    expect(readApiCreated(error)).toBe(2);
  });

  it("returns undefined when nothing claims a count", () => {
    expect(readApiCreated(new ApiError(500, "internal", "no count"))).toBeUndefined();
    expect(readApiCreated(new Error("offline"))).toBeUndefined();
  });
});

describe("formatDate", () => {
  const instant = "2026-01-01T02:30:00Z";

  it("renders the day in the space's zone, not the browser's", () => {
    const expected = new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeZone: "America/Toronto",
    }).format(new Date(instant));
    expect(formatDate(instant, "America/Toronto")).toBe(expected);
    expect(formatDate(instant, "UTC")).not.toBe(expected);
  });
});

describe("formatDateTime", () => {
  it("renders the clock time in the space's zone", () => {
    const instant = "2026-01-01T02:30:00Z";
    const expected = new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Tokyo",
    }).format(new Date(instant));
    expect(formatDateTime(instant, "Asia/Tokyo")).toBe(expected);
  });
});

describe("formatDay", () => {
  it("keeps a calendar day on its own date everywhere", () => {
    const expected = new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeZone: "UTC",
    }).format(new Date("2026-11-03T00:00:00Z"));
    expect(formatDay("2026-11-03")).toBe(expected);
    expect(formatDay("2026-11-03")).toContain("2026");
  });

  it("reads a malformed day as itself", () => {
    expect(formatDay("not a day")).toBe("not a day");
  });
});
