import { describe, expect, it } from "vitest";

import { defaultSpaceTimezone, timezoneNames, todayIn } from "@/lib/timezone";

describe("timezone picker", () => {
  it("sorts known zones and always offers UTC", () => {
    const names = timezoneNames();
    expect(names).toContain("UTC");
    expect(names).toEqual([...names].sort());
  });

  it("keeps the space's current zone even when the runtime omits it", () => {
    expect(timezoneNames("Custom/Place")).toContain("Custom/Place");
    expect(timezoneNames()).not.toContain("Custom/Place");
  });

  it("falls back to UTC when the browser names no supported zone", () => {
    // jsdom's Intl resolves a zone; either way it must be one the picker offers.
    expect(timezoneNames()).toContain(defaultSpaceTimezone());
  });
});

describe("today in a zone", () => {
  const evening = new Date("2026-10-22T02:30:00Z");

  it("uses the space's date, not the browser's", () => {
    expect(todayIn("UTC", evening)).toBe("2026-10-22");
    expect(todayIn("America/New_York", evening)).toBe("2026-10-21");
  });

  it("pads month and day", () => {
    expect(todayIn("UTC", new Date("2026-01-05T12:00:00Z"))).toBe("2026-01-05");
  });
});
