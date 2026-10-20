import { describe, expect, it } from "vitest";

import type { OptionDef, TypeProperty } from "@/api/types";
import {
  addProperty,
  moveColumn,
  moveItem,
  moveProperty,
  optionDrafts,
  optionInputs,
  removeProperty,
  sameJson,
  setColumn,
  TITLE_COLUMN,
} from "@/lib/schema";

const room: TypeProperty = { key: "room", required: false, featured: false };
const watered: TypeProperty = { key: "watered", required: true, featured: false };

describe("type membership", () => {
  it("adds a property once, at the end", () => {
    const members = addProperty([room], "watered");
    expect(members.map((member) => member.key)).toEqual(["room", "watered"]);
    expect(addProperty(members, "room")).toBe(members);
  });

  it("removes a property without touching the rest", () => {
    expect(removeProperty([room, watered], "room")).toEqual([watered]);
  });

  it("moves a property by one and clamps at the ends", () => {
    expect(moveProperty([room, watered], "watered", -1)).toEqual([watered, room]);
    expect(moveProperty([room, watered], "room", -1)).toEqual([room, watered]);
    expect(moveProperty([room, watered], "watered", 1)).toEqual([room, watered]);
  });
});

describe("view columns", () => {
  it("keeps title first and appends new columns", () => {
    expect(setColumn([TITLE_COLUMN], "room", true)).toEqual([TITLE_COLUMN, "room"]);
    expect(setColumn([TITLE_COLUMN, "room"], "watered", true)).toEqual([
      TITLE_COLUMN,
      "room",
      "watered",
    ]);
  });

  it("removes a column but never the title", () => {
    expect(setColumn([TITLE_COLUMN, "room"], "room", false)).toEqual([TITLE_COLUMN]);
    expect(setColumn([TITLE_COLUMN], TITLE_COLUMN, false)).toEqual([TITLE_COLUMN]);
  });

  it("moves a column only after title", () => {
    const columns = [TITLE_COLUMN, "room", "watered"];
    expect(moveColumn(columns, "watered", -1)).toEqual([TITLE_COLUMN, "watered", "room"]);
    expect(moveColumn(columns, "room", -1)).toEqual(columns);
    expect(moveColumn(columns, TITLE_COLUMN, 1)).toEqual(columns);
  });

  it("treats moves outside the list as no-ops", () => {
    const items = [1, 2, 3];
    expect(moveItem(items, 0, 3)).toBe(items);
    expect(moveItem(items, -1, 0)).toBe(items);
  });
});

describe("change detection", () => {
  it("ignores object key order between a request and a response", () => {
    expect(
      sameJson(
        { properties: [{ key: "room", required: false, featured: false }] },
        { properties: [{ featured: false, required: false, key: "room" }] },
      ),
    ).toBe(true);
  });

  it("still sees a real difference", () => {
    expect(sameJson({ columns: ["title"] }, { columns: ["title", "room"] })).toBe(false);
    expect(sameJson({ name: "Plant" }, { name: "Plants" })).toBe(false);
  });
});

describe("option drafts", () => {
  const saved: OptionDef[] = [{ key: "kitchen", name: "Kitchen", color: "#c8d96b" }];

  it("keeps a saved key so a rename does not re-key its values", () => {
    const drafts = optionDrafts(saved);
    drafts[0]!.name = "Kitchen counter";
    expect(optionInputs(drafts)).toEqual([
      { key: "kitchen", name: "Kitchen counter", color: "#c8d96b" },
    ]);
  });

  it("omits the key for a new option and trims the text", () => {
    expect(optionInputs([{ id: "draft-1", name: " Balcony ", color: " #f08a72 " }])).toEqual([
      { name: "Balcony", color: "#f08a72" },
    ]);
  });
});
