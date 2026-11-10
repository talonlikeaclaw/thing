import { describe, expect, it } from "vitest";

import type { PropertyDef } from "@/api/types";
import {
  RESULT_FORMATS,
  STORED_FORMATS,
  computeDescription,
  isComputed,
  rollupResultFormat,
  writableProperties,
} from "@/lib/schema";

const related: PropertyDef = {
  key: "related",
  name: "Related",
  format: "relation",
  target_type: "plant",
  multi: true,
};

const label: PropertyDef = {
  key: "label",
  name: "Label",
  format: "text",
  compute: { kind: "formula", expression: 'title + " / " + room' },
};

const titles: PropertyDef = {
  key: "related_titles",
  name: "Related titles",
  format: "list",
  compute: { kind: "rollup", relation: "related", property: "title", aggregate: "list" },
};

describe("computed property helpers", () => {
  it("keeps list out of the stored formats and out of a result's text types", () => {
    expect(STORED_FORMATS.map((entry) => entry.value)).not.toContain("list");
    expect(STORED_FORMATS.map((entry) => entry.value)).toContain("attachments");
    expect(RESULT_FORMATS).toEqual(["text", "number", "checkbox", "date", "datetime", "list"]);
  });

  it("drops a calculated definition from the writable set", () => {
    expect(isComputed(label)).toBe(true);
    expect(isComputed(related)).toBe(false);
    expect(writableProperties([related, label, titles]).map((entry) => entry.key)).toEqual([
      "related",
    ]);
  });

  it("derives a rollup's result type from its aggregate and target", () => {
    expect(rollupResultFormat("count", undefined)).toBe("number");
    expect(rollupResultFormat("sum", "number")).toBe("number");
    expect(rollupResultFormat("min", "date")).toBe("date");
    expect(rollupResultFormat("max", "datetime")).toBe("datetime");
    expect(rollupResultFormat("min", "text")).toBeUndefined();
    expect(rollupResultFormat("list", "text")).toBe("list");
  });

  it("names the definition behind a calculated value", () => {
    expect(computeDescription(label, [label, related])).toBe(
      'Formula: title + " / " + room',
    );
    expect(
      computeDescription(
        { key: "count", name: "Count", format: "number",
          compute: { kind: "rollup", relation: "related", aggregate: "count" } },
        [related],
      ),
    ).toBe("Calculated: count of Related");
    expect(computeDescription(titles, [related])).toBe(
      "Calculated: list of Title in Related",
    );
    // A key whose definition is gone still reads as the key it names.
    expect(
      computeDescription(
        { key: "shelf", name: "Shelf", format: "list",
          compute: { kind: "rollup", relation: "cupboard", property: "shelf", aggregate: "list" } },
        [],
      ),
    ).toBe("Calculated: list of shelf in cupboard");
  });
});
