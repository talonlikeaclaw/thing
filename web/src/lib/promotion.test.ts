import { describe, expect, it } from "vitest";

import type { PropertyDef } from "@/api/types";
import { promotionBlocker, temporaryKey } from "@/lib/promotion";

function property(format: PropertyDef["format"]): PropertyDef {
  return { key: "artist", name: "Artist", format };
}

describe("promotionBlocker", () => {
  it("allows only text, select and multi-select columns", () => {
    expect(promotionBlocker(property("text"), 1)).toBeNull();
    expect(promotionBlocker(property("select"), 1)).toBeNull();
    expect(promotionBlocker(property("multi_select"), 1)).toBeNull();
    expect(promotionBlocker(property("number"), 1)).toBe(
      "Only text, select and multi-select columns can be turned into a type.",
    );
    expect(promotionBlocker(property("relation"), 1)).not.toBeNull();
  });

  it("refuses a property no type or several types carry", () => {
    expect(promotionBlocker(property("text"), 0)).toBe("No type carries this property.");
    expect(promotionBlocker(property("text"), 2)).toBe("This property is used by 2 types.");
  });
});

describe("temporaryKey", () => {
  it("adds the ref suffix and keeps the server's key limit", () => {
    expect(temporaryKey("artist")).toBe("artist_ref");
    const long = temporaryKey("a".repeat(40));
    expect(long).toHaveLength(40);
    expect(long.endsWith("_ref")).toBe(true);
    expect(long.endsWith("__ref")).toBe(false);
  });
});
