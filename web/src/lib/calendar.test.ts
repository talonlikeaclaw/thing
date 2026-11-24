import { describe, expect, it } from "vitest";

import {
  calendarParams,
  calendarStateFromParams,
  calendarStorageKey,
  defaultCalendarState,
  normalizeCalendarTypes,
  readCalendarState,
  weekDays,
  weekLabel,
  weekRange,
  weekStart,
  writeCalendarState,
  type CalendarState,
  type CalendarStorage,
} from "@/lib/calendar";

function memoryStorage(initial: Record<string, string> = {}): CalendarStorage & {
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

const base = defaultCalendarState("2026-11-23");

describe("a calendar week", () => {
  it("starts on the Monday of the day's week", () => {
    expect(weekStart("2026-11-23")).toBe("2026-11-23");
    expect(weekStart("2026-11-25")).toBe("2026-11-23");
    expect(weekStart("2026-11-29")).toBe("2026-11-23");
  });

  it("reads a Sunday as the week that ends on it", () => {
    expect(weekStart("2026-11-22")).toBe("2026-11-16");
  });

  it("refuses a day that is not one", () => {
    expect(weekStart("2026-02-30")).toBe("");
    expect(weekStart("")).toBe("");
  });

  it("paints seven days from Monday to Sunday", () => {
    expect(weekDays("2026-11-23")).toEqual([
      "2026-11-23",
      "2026-11-24",
      "2026-11-25",
      "2026-11-26",
      "2026-11-27",
      "2026-11-28",
      "2026-11-29",
    ]);
    expect(weekDays("")).toEqual([]);
  });

  it("bounds the week reads inclusively", () => {
    expect(weekRange("2026-11-23")).toEqual({ from: "2026-11-23", to: "2026-11-29" });
  });
});

describe("a week label", () => {
  it("names the month once when both ends share it", () => {
    expect(weekLabel("2026-11-23")).toBe("23–29 November 2026");
  });

  it("names both months when the week crosses one", () => {
    expect(weekLabel("2026-11-30")).toBe("30 November – 6 December 2026");
  });

  it("keeps both years when the week crosses one", () => {
    expect(weekLabel("2025-12-29")).toBe("29 December 2025 – 4 January 2026");
  });

  it("reads a malformed week as nothing", () => {
    expect(weekLabel("")).toBe("");
  });
});

describe("calendar state", () => {
  it("starts on the month containing today, in today's week", () => {
    expect(base).toEqual({
      view: "month",
      month: "2026-11",
      week: "2026-11-23",
      types: [],
    });
  });

  it("writes no parameters for the defaults", () => {
    expect(calendarParams(base, base).toString()).toBe("");
  });

  it("writes non-default state in a fixed order", () => {
    const state: CalendarState = {
      view: "week",
      month: "2026-12",
      week: "2026-12-07",
      types: ["plant", "chore"],
    };
    expect(calendarParams(state, base).toString()).toBe(
      "view=week&month=2026-12&week=2026-12-07&types=chore%2Cplant",
    );
  });

  it("round-trips both shapes through the query string", () => {
    for (const view of ["month", "week"] as const) {
      for (const month of ["2026-10", "2026-11", "2027-01"]) {
        for (const week of ["2026-10-26", "2026-11-23", "2026-12-28"]) {
          const state: CalendarState = { view, month, week, types: ["chore"] };
          expect(calendarStateFromParams(calendarParams(state, base), base)).toEqual(state);
        }
      }
    }
  });

  it("normalizes a mid-week address to its Monday", () => {
    const state = calendarStateFromParams(
      new URLSearchParams("view=week&week=2026-11-26"),
      base,
    );
    expect(state.week).toBe("2026-11-23");
  });

  it("falls back for missing or invalid parameters", () => {
    const params = new URLSearchParams("view=year&month=2026-13&week=2026-02-30");
    expect(calendarStateFromParams(params, base)).toEqual(base);
    expect(calendarStateFromParams(new URLSearchParams(), base)).toEqual(base);
  });

  it("scopes storage to the reader and the space", () => {
    expect(calendarStorageKey("user-1", "space-1")).toBe("thing:calendar:user-1:space-1");
  });

  it("reads a stored state back, so the last shape is the default", () => {
    const storage = memoryStorage();
    const key = calendarStorageKey("user-1", "space-1");
    const state: CalendarState = {
      view: "week",
      month: "2026-12",
      week: "2026-12-07",
      types: ["chore"],
    };
    writeCalendarState(storage, key, state);
    expect(readCalendarState(storage, key, base)).toEqual(state);
  });

  it("falls back for missing or malformed storage", () => {
    const key = calendarStorageKey("user-1", "space-1");
    expect(readCalendarState(memoryStorage(), key, base)).toEqual(base);
    expect(readCalendarState(memoryStorage({ [key]: "{" }), key, base)).toEqual(base);
    expect(readCalendarState(memoryStorage({ [key]: '"week"' }), key, base)).toEqual(base);
  });

  it("keeps the fields a partly corrupted stored state got right", () => {
    const key = calendarStorageKey("user-1", "space-1");
    const storage = memoryStorage({
      [key]: JSON.stringify({ view: "week", month: "2026-11", week: "nope" }),
    });
    expect(readCalendarState(storage, key, base)).toEqual({
      view: "week",
      month: "2026-11",
      week: base.week,
      types: [],
    });
  });

  it("swallows a refused storage write", () => {
    const storage: CalendarStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(() => writeCalendarState(storage, "key", base)).not.toThrow();
  });

  it("normalizes type keys by trimming, deduplicating and sorting", () => {
    expect(normalizeCalendarTypes([" plant", "chore", "", "plant", "chore "])).toEqual([
      "chore",
      "plant",
    ]);
  });
});
