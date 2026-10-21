import { describe, expect, it } from "vitest";

import type { RecurrenceValue } from "@/api/types";
import {
  completeLabel,
  dueCellLabel,
  dueTone,
  isScheduleKey,
  labeledScheduleProperties,
  normalizeRecurrence,
  recurrenceDraft,
  recurrenceEquals,
  recurrenceSummary,
  scheduleLabel,
  SCHEDULE_PROPERTY_DEFS,
  weekdayName,
} from "@/lib/schedule";

const everyThree: RecurrenceValue = { kind: "days", every: 3 };

describe("recurrence labels", () => {
  it("names every kind exactly as the server does", () => {
    expect(recurrenceSummary({ kind: "days", every: 1 })).toBe("Every day");
    expect(recurrenceSummary(everyThree)).toBe("Every 3 days");
    expect(recurrenceSummary({ kind: "weekly", every: 2, weekday: 1 })).toBe(
      "Every 2 weeks on Monday",
    );
    expect(recurrenceSummary({ kind: "monthly", every: 1, day: 31 })).toBe(
      "Every month on day 31",
    );
  });

  it("refuses anything that is not a recurrence mapping", () => {
    expect(recurrenceSummary("every 3 days")).toBe("");
    expect(recurrenceSummary({ kind: "yearly", every: 1 })).toBe("");
    expect(weekdayName(0)).toBe("Sunday");
    expect(weekdayName(7)).toBe("");
  });
});

describe("recurrence editor", () => {
  it("seeds the draft from a saved value and from nothing", () => {
    expect(recurrenceDraft({ kind: "weekly", every: 2, weekday: 4 })).toEqual({
      kind: "weekly",
      every: "2",
      weekday: "4",
      day: "",
    });
    expect(recurrenceDraft(undefined)).toEqual({
      kind: "days",
      every: "1",
      weekday: "",
      day: "",
    });
  });

  it("normalizes only the fields the chosen kind uses", () => {
    expect(
      normalizeRecurrence({ kind: "days", every: "3", weekday: "2", day: "9" }),
    ).toEqual({ ok: true, value: { kind: "days", every: 3 } });
    expect(
      normalizeRecurrence({ kind: "weekly", every: "2", weekday: "1", day: "9" }),
    ).toEqual({ ok: true, value: { kind: "weekly", every: 2, weekday: 1 } });
    expect(
      normalizeRecurrence({ kind: "monthly", every: "1", weekday: "2", day: "31" }),
    ).toEqual({ ok: true, value: { kind: "monthly", every: 1, day: 31 } });
  });

  it("rejects an out-of-range interval instead of sending it", () => {
    for (const every of ["0", "1001", "1.5", "", "three"]) {
      const result = normalizeRecurrence({ kind: "days", every, weekday: "", day: "" });
      expect(result.ok).toBe(false);
    }
  });

  it("requires the field its kind needs", () => {
    expect(normalizeRecurrence({ kind: "weekly", every: "1", weekday: "", day: "" })).toEqual({
      ok: false,
      error: "Choose the weekday this repeat lands on.",
    });
    expect(normalizeRecurrence({ kind: "monthly", every: "1", weekday: "", day: "32" })).toEqual({
      ok: false,
      error: "The day of month must be between 1 and 31.",
    });
  });

  it("compares the whole mapping, not just the interval", () => {
    expect(recurrenceEquals(everyThree, { kind: "days", every: 3 })).toBe(true);
    expect(recurrenceEquals(everyThree, { kind: "days", every: 4 })).toBe(false);
    expect(recurrenceEquals(everyThree, null)).toBe(false);
  });
});

describe("due presentation", () => {
  it("maps status to the one colour it carries", () => {
    expect(dueTone("overdue")).toBe("text-danger");
    expect(dueTone("today")).toBe("text-warning");
    expect(dueTone("upcoming")).toBe("text-muted");
    expect(dueTone("done")).toBe("text-muted");
  });

  it("resolves per-type labels without changing generated keys", () => {
    const labels = {
      due: "Next watering",
      last_completed: "Last watered",
      complete: "Water",
    };
    expect(scheduleLabel(labels, "due_date", "Due")).toBe("Next watering");
    expect(scheduleLabel(labels, "last_completed_at", "Last completed")).toBe(
      "Last watered",
    );
    expect(scheduleLabel(labels, "recurrence", "Repeats")).toBe("Repeats");
    expect(completeLabel(labels)).toBe("Water");
    expect(completeLabel(undefined)).toBe("Complete");
    expect(
      labeledScheduleProperties(SCHEDULE_PROPERTY_DEFS, labels).map((property) => [
        property.key,
        property.name,
      ]),
    ).toEqual([
      ["due_date", "Next watering"],
      ["recurrence", "Repeats"],
      ["last_completed_at", "Last watered"],
    ]);
  });

  it("renders relative overdue and today labels and the date otherwise", () => {
    expect(
      dueCellLabel({ status: "overdue", days_until_due: -3 }, "2026-10-18"),
    ).toBe("Overdue 3d");
    expect(dueCellLabel({ status: "today", days_until_due: 0 }, "2026-10-21")).toBe("Today");
    expect(
      dueCellLabel({ status: "upcoming", days_until_due: 4 }, "2026-10-25"),
    ).toBe("2026-10-25");
    expect(dueCellLabel(undefined, "2026-10-25")).toBe("2026-10-25");
  });

  it("knows the generated keys", () => {
    expect(isScheduleKey("due_date")).toBe(true);
    expect(isScheduleKey("recurrence")).toBe(true);
    expect(isScheduleKey("last_completed_at")).toBe(true);
    expect(isScheduleKey("due")).toBe(false);
  });
});
