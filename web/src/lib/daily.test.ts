import { describe, expect, it } from "vitest";

import { dayLabel, isDayTitle, longDayLabel, monthParam, STREAK_DAYS, streakOf } from "@/lib/daily";
import { shiftDay } from "@/lib/timezone";

describe("a day title", () => {
  it("is exactly an ISO day", () => {
    expect(isDayTitle("2026-11-23")).toBe(true);
    expect(isDayTitle("2026-01-01")).toBe(true);
  });

  it("accepts a leap day only in a leap year", () => {
    expect(isDayTitle("2028-02-29")).toBe(true);
    expect(isDayTitle("2026-02-29")).toBe(false);
  });

  it("refuses a day the calendar does not have", () => {
    expect(isDayTitle("2026-02-30")).toBe(false);
    expect(isDayTitle("2026-13-01")).toBe(false);
    expect(isDayTitle("2026-00-10")).toBe(false);
    expect(isDayTitle("2026-04-31")).toBe(false);
  });

  it("refuses an unpadded or padded-about name", () => {
    expect(isDayTitle("2026-1-2")).toBe(false);
    expect(isDayTitle("2026-02-03 ")).toBe(false);
    expect(isDayTitle(" 2026-02-03")).toBe(false);
    expect(isDayTitle("2026-02-03T00:00:00Z")).toBe(false);
    expect(isDayTitle("")).toBe(false);
    expect(isDayTitle("not a day")).toBe(false);
  });
});

describe("the run of written days", () => {
  it("counts back from today when today is written", () => {
    const written = new Set(["2026-11-23", "2026-11-22", "2026-11-21"]);
    expect(streakOf(written, "2026-11-23")).toBe(3);
  });

  it("counts back from yesterday when today is not written yet", () => {
    const written = new Set(["2026-11-22", "2026-11-21"]);
    expect(streakOf(written, "2026-11-23")).toBe(2);
  });

  it("is zero when neither today nor yesterday is written", () => {
    expect(streakOf(new Set(["2026-11-21"]), "2026-11-23")).toBe(0);
    expect(streakOf(new Set(), "2026-11-23")).toBe(0);
  });

  it("stops at the first gap", () => {
    const written = new Set(["2026-11-23", "2026-11-22", "2026-11-20", "2026-11-19"]);
    expect(streakOf(written, "2026-11-23")).toBe(2);
  });

  it("counts a leap day across the month boundary", () => {
    const written = new Set(["2028-03-01", "2028-02-29", "2028-02-28"]);
    expect(streakOf(written, "2028-03-01")).toBe(3);
  });

  it("reads a saturated window as the window", () => {
    const today = "2026-11-23";
    const written = new Set(Array.from({ length: STREAK_DAYS }, (_, index) => shiftDay(today, -index)));
    expect(streakOf(written, today)).toBe(STREAK_DAYS);
  });

  it("reads a full run ending yesterday as the window", () => {
    const today = "2026-11-23";
    const written = new Set(
      Array.from({ length: STREAK_DAYS }, (_, index) => shiftDay(today, -index - 1)),
    );
    expect(streakOf(written, today)).toBe(STREAK_DAYS);
  });
});

describe("day labels", () => {
  const at = new Date("2026-11-23T00:00:00Z");
  const part = (options: Intl.DateTimeFormatOptions, type: Intl.DateTimeFormatPartTypes) =>
    new Intl.DateTimeFormat(undefined, { ...options, timeZone: "UTC" })
      .formatToParts(at)
      .find((entry) => entry.type === type)?.value ?? "";

  it("reads a day as weekday, day, month in that order", () => {
    const weekday = part({ weekday: "short" }, "weekday");
    const month = part({ month: "short" }, "month");
    expect(dayLabel("2026-11-23")).toBe(`${weekday} 23 ${month}`);
  });

  it("reads the long form with the year last", () => {
    const weekday = part({ weekday: "long" }, "weekday");
    const month = part({ month: "long" }, "month");
    expect(longDayLabel("2026-11-23")).toBe(`${weekday}, 23 ${month} 2026`);
  });

  it("keeps a day on its own date, never the browser's", () => {
    expect(dayLabel("2026-11-23")).toContain("23");
    expect(longDayLabel("2026-11-23")).toContain("2026");
  });

  it("reads a malformed day as itself", () => {
    expect(dayLabel("not a day")).toBe("not a day");
    expect(longDayLabel("")).toBe("");
  });
});

describe("the month parameter", () => {
  it("keeps a real month and falls back otherwise", () => {
    expect(monthParam("2026-10", "2026-11")).toBe("2026-10");
    expect(monthParam("2026-13", "2026-11")).toBe("2026-11");
    expect(monthParam("2026-1", "2026-11")).toBe("2026-11");
    expect(monthParam("", "2026-11")).toBe("2026-11");
    expect(monthParam(null, "2026-11")).toBe("2026-11");
    expect(monthParam(undefined, "2026-11")).toBe("2026-11");
  });
});
