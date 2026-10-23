import { describe, expect, it } from "vitest";

import { ApiError } from "@/api/client";
import { readApiCreated, readApiProblems } from "@/lib/display";

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
