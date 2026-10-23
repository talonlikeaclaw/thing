import { describe, expect, it } from "vitest";

import {
  DEFAULT_NAV_ORDER,
  moveNavLink,
  navOrderKey,
  readNavOrder,
  writeNavOrder,
  type NavOrderStorage,
} from "@/lib/nav-order";

function memoryStorage(values: Record<string, string> = {}): NavOrderStorage & {
  values: Map<string, string>;
} {
  const store = new Map(Object.entries(values));
  return {
    values: store,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
  };
}

const key = navOrderKey("user-1", "space-1");

describe("navOrderKey", () => {
  it("scopes the order to the user and the space", () => {
    expect(key).toBe("thing:nav-order:user-1:space-1");
  });
});

describe("readNavOrder", () => {
  it("returns the shipped order when nothing is stored", () => {
    expect(readNavOrder(memoryStorage(), key)).toEqual(DEFAULT_NAV_ORDER);
  });

  it("returns the shipped order for malformed JSON", () => {
    expect(readNavOrder(memoryStorage({ [key]: "{" }), key)).toEqual(DEFAULT_NAV_ORDER);
    expect(readNavOrder(memoryStorage({ [key]: '"schedule"' }), key)).toEqual(DEFAULT_NAV_ORDER);
  });

  it("keeps known links, drops duplicates and appends missing ones", () => {
    const storage = memoryStorage({
      [key]: JSON.stringify(["trash", "schedule", "trash", "nope", "members"]),
    });
    expect(readNavOrder(storage, key)).toEqual([
      "trash",
      "schedule",
      "members",
      "schema",
      "settings",
    ]);
  });
});

describe("writeNavOrder", () => {
  it("round-trips an order and swallows a refused write", () => {
    const storage = memoryStorage();
    writeNavOrder(storage, key, ["members", "trash", "schedule", "schema", "settings"]);
    expect(readNavOrder(storage, key)).toEqual([
      "members",
      "trash",
      "schedule",
      "schema",
      "settings",
    ]);

    expect(() =>
      writeNavOrder(
        {
          getItem: () => null,
          setItem: () => {
            throw new Error("quota");
          },
        },
        key,
        DEFAULT_NAV_ORDER,
      ),
    ).not.toThrow();
  });
});

describe("moveNavLink", () => {
  it("moves a link up and down without mutating the input", () => {
    const order = [...DEFAULT_NAV_ORDER];
    expect(moveNavLink(order, "settings", -1)).toEqual([
      "schema",
      "schedule",
      "members",
      "settings",
      "trash",
    ]);
    expect(moveNavLink(order, "schedule", 1)).toEqual([
      "schema",
      "members",
      "schedule",
      "trash",
      "settings",
    ]);
    expect(order).toEqual(DEFAULT_NAV_ORDER);
  });

  it("does nothing at the ends or for an unknown link", () => {
    expect(moveNavLink(DEFAULT_NAV_ORDER, "schema", -1)).toEqual(DEFAULT_NAV_ORDER);
    expect(moveNavLink(DEFAULT_NAV_ORDER, "settings", 1)).toEqual(DEFAULT_NAV_ORDER);
    expect(moveNavLink(DEFAULT_NAV_ORDER, "members", 0)).toEqual(DEFAULT_NAV_ORDER);
  });
});
