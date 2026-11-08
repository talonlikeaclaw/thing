import { describe, expect, it } from "vitest";

import type { PropertyDef } from "@/api/types";
import {
  foldProperty,
  groupProperties,
  scoreProperty,
  searchProperties,
} from "@/lib/property-search";

const properties: PropertyDef[] = [
  { key: "room", name: "Room", format: "text" },
  { key: "bedroom", name: "Bedroom", format: "select" },
  { key: "room_type", name: "Category", format: "text" },
  { key: "zone", name: "Zone", format: "multi_select" },
];

describe("foldProperty", () => {
  it("trims, lowercases and collapses whitespace", () => {
    expect(foldProperty("  Living   Room ")).toBe("living room");
  });
});

describe("scoreProperty", () => {
  it("ranks a name before the key at every strength", () => {
    const byName = { key: "x", name: "Road", format: "text" } as PropertyDef;
    const byKey = { key: "ro", name: "Zone", format: "text" } as PropertyDef;
    expect(scoreProperty(byName, "ro")).toBeLessThan(scoreProperty(byKey, "ro") ?? 99);
  });

  it("separates exact, prefix and substring matches", () => {
    const exact = scoreProperty({ key: "k1", name: "Room", format: "text" }, "room");
    const prefix = scoreProperty({ key: "k2", name: "Room type", format: "text" }, "room");
    const part = scoreProperty({ key: "k3", name: "Bedroom", format: "text" }, "room");
    expect(exact).toBeLessThan(prefix ?? 99);
    expect(prefix).toBeLessThan(part ?? 99);
  });

  it("matches a key when the name does not", () => {
    const keyed = { key: "room_type", name: "Category", format: "text" } as PropertyDef;
    expect(scoreProperty(keyed, "room_")).not.toBeNull();
  });

  it("returns null when neither the name nor the key contains the query", () => {
    const room = { key: "room", name: "Room", format: "text" } as PropertyDef;
    expect(scoreProperty(room, "garden")).toBeNull();
  });
});

describe("searchProperties", () => {
  it("keeps the incoming order for an empty query", () => {
    expect(searchProperties(properties, "  ")).toEqual(properties);
  });

  it("orders matches by tier and names the acceptance case", () => {
    // `ro`: Room by name prefix, Bedroom by name substring, Category by key.
    expect(searchProperties(properties, "ro").map((property) => property.key)).toEqual([
      "room",
      "bedroom",
      "room_type",
    ]);
  });

  it("breaks a tie by folded name, then by key", () => {
    const twins: PropertyDef[] = [
      { key: "room_b", name: "Room B", format: "text" },
      { key: "room_a", name: "Room A", format: "text" },
    ];
    expect(searchProperties(twins, "room").map((property) => property.key)).toEqual([
      "room_a",
      "room_b",
    ]);
  });

  it("drops everything that does not match", () => {
    expect(searchProperties(properties, "zzz")).toEqual([]);
  });
});

describe("groupProperties", () => {
  it("splits by membership and keeps each half's order", () => {
    const groups = groupProperties(properties, new Set(["bedroom", "zone"]));
    expect(groups.onThisType.map((property) => property.key)).toEqual(["bedroom", "zone"]);
    expect(groups.inLibrary.map((property) => property.key)).toEqual(["room", "room_type"]);
  });

  it("puts everything in the library when nothing is carried", () => {
    const groups = groupProperties(properties, new Set());
    expect(groups.onThisType).toEqual([]);
    expect(groups.inLibrary).toEqual(properties);
  });
});
