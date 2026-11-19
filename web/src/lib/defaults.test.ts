import { describe, expect, it } from "vitest";

import type { PropertyDef, TypeDef, TypeProperty, ViewDef } from "@/api/types";
import { withDefaults } from "@/lib/defaults";

const table: ViewDef = {
  key: "all",
  name: "All",
  kind: "table",
  sorts: [],
  filter: { op: "and", conditions: [] },
  columns: ["title"],
  widths: {},
};

const members: TypeProperty[] = [
  { key: "room", required: false, featured: true, default: "study" },
  { key: "price", required: false, featured: true, default: 0 },
  { key: "days", required: false, featured: true, default: 3 },
  { key: "notes", required: false, featured: true },
];

const properties: PropertyDef[] = [
  { key: "room", name: "Room", format: "text" },
  { key: "price", name: "Price", format: "number" },
  {
    key: "days",
    name: "Days",
    format: "number",
    compute: { kind: "formula", expression: "1 + 1" },
  },
  { key: "notes", name: "Notes", format: "text" },
];

function plant(): TypeDef {
  return {
    key: "plant",
    name: "Plant",
    name_plural: "Plants",
    description: "",
    schedule: false,
    properties: members,
    views: [table],
    default_view: "all",
  };
}

describe("withDefaults", () => {
  it("copies every default the caller did not set", () => {
    expect(withDefaults(plant(), properties, {})).toEqual({
      room: "study",
      price: 0,
    });
  });

  it("keeps a value the caller already set", () => {
    expect(withDefaults(plant(), properties, { room: "attic" })).toEqual({
      room: "attic",
      price: 0,
    });
  });

  it("keeps an explicit null, so a cleared field stays cleared", () => {
    expect(withDefaults(plant(), properties, { room: null })).toEqual({
      room: null,
      price: 0,
    });
  });

  it("never mutates its input", () => {
    const values: Record<string, unknown> = { room: "attic" };
    withDefaults(plant(), properties, values);
    expect(values).toEqual({ room: "attic" });
  });

  it("leaves a member without a default absent", () => {
    expect(withDefaults(plant(), properties, {})).not.toHaveProperty("notes");
  });
});
