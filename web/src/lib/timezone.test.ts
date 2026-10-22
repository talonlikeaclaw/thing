import { describe, expect, it } from "vitest";

import { defaultSpaceTimezone, timezoneNames } from "@/lib/timezone";

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
