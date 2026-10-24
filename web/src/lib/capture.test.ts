import { describe, expect, it } from "vitest";

import type { PropertyDef, TypeDef } from "@/api/types";
import {
  captureFields,
  captureTypeKey,
  readCaptureType,
  requiredProperties,
  writeCaptureType,
  type CaptureStorage,
} from "@/lib/capture";

function memoryStorage(initial: Record<string, string> = {}): CaptureStorage & {
  values: Map<string, string>;
} {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

const key = captureTypeKey("user-1", "space-1");

describe("captureTypeKey", () => {
  it("scopes the last type to the user and the space", () => {
    expect(key).toBe("thing:quick-capture-type:user-1:space-1");
  });
});

describe("readCaptureType", () => {
  it("returns null when nothing was stored", () => {
    expect(readCaptureType(memoryStorage(), key)).toBeNull();
    expect(readCaptureType(memoryStorage({ [key]: "" }), key)).toBeNull();
  });

  it("returns null when storage refuses to read", () => {
    const storage: CaptureStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {},
    };
    expect(readCaptureType(storage, key)).toBeNull();
  });

  it("reads the stored type key", () => {
    expect(readCaptureType(memoryStorage({ [key]: "chore" }), key)).toBe("chore");
  });
});

describe("writeCaptureType", () => {
  it("stores the chosen type", () => {
    const storage = memoryStorage();
    writeCaptureType(storage, key, "chore");
    expect(storage.values.get(key)).toBe("chore");
  });

  it("swallows a refused write", () => {
    const storage: CaptureStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(() => writeCaptureType(storage, key, "chore")).not.toThrow();
  });
});

function property(key: string, format: PropertyDef["format"] = "text"): PropertyDef {
  return { key, name: key, format };
}

function type(properties: TypeDef["properties"], schedule = false): TypeDef {
  return {
    key: "chore",
    name: "Chore",
    name_plural: "Chores",
    description: "",
    schedule,
    properties,
    views: [],
    default_view: "all",
    ...(schedule
      ? {
          implicit_properties: [
            property("due_date", "date"),
            property("recurrence", "recurrence"),
            property("last_completed_at", "datetime"),
          ],
        }
      : {}),
  };
}

describe("captureFields", () => {
  it("groups required members before the other editable fields", () => {
    const chore = type(
      [
        { key: "room", required: true, featured: false },
        { key: "notes", required: false, featured: false },
      ],
      true,
    );
    const properties = [property("notes"), property("room")];
    const fields = captureFields(chore, properties);
    expect(fields.required.map((entry) => entry.key)).toEqual(["room"]);
    expect(fields.optional.map((entry) => entry.key)).toEqual([
      "notes",
      "due_date",
      "recurrence",
    ]);
  });

  it("skips an optional member with no definition", () => {
    const chore = type([
      { key: "room", required: true, featured: false },
      { key: "ghost", required: false, featured: false },
    ]);
    const fields = captureFields(chore, [property("room")]);
    expect(fields.required.map((entry) => entry.key)).toEqual(["room"]);
    expect(fields.optional).toEqual([]);
  });

  it("returns two empty groups without a type", () => {
    expect(captureFields(undefined, [property("room")])).toEqual({
      required: [],
      optional: [],
    });
  });
});

describe("requiredProperties", () => {
  it("returns required members in type order, resolved to definitions", () => {
    const chore = type([
      { key: "room", required: true, featured: false },
      { key: "notes", required: false, featured: false },
      { key: "who", required: true, featured: false },
    ]);
    expect(
      requiredProperties(chore, [property("who"), property("room"), property("notes")]).map(
        (entry) => entry.key,
      ),
    ).toEqual(["room", "who"]);
  });

  it("never asks for a generated schedule key", () => {
    const chore = type([{ key: "room", required: true, featured: false }], true);
    const properties = [
      property("room"),
      property("due_date", "date"),
      property("recurrence", "recurrence"),
      property("last_completed_at", "datetime"),
    ];
    expect(requiredProperties(chore, properties).map((entry) => entry.key)).toEqual(["room"]);
  });

  it("skips a required member with no definition", () => {
    const chore = type([{ key: "ghost", required: true, featured: false }]);
    expect(requiredProperties(chore, [])).toEqual([]);
  });

  it("returns nothing without a type", () => {
    expect(requiredProperties(undefined, [property("room")])).toEqual([]);
  });
});
