import { describe, expect, it } from "vitest";

import type { AgendaRow, ScheduleStatus } from "@/api/types";

import { agendaBuckets } from "@/lib/agenda";

function row(
  title: string,
  status: ScheduleStatus,
  due: string,
  daysUntildue: number,
): AgendaRow {
  return {
    id: title,
    type: "chore",
    type_name: "Chore",
    title,
    rev: 1,
    due_date: due,
    status,
    days_until_due: daysUntildue,
  };
}

/**
 * A window reply as the server sends it: one sorted array of outstanding rows.
 * The v0.4.4 shape is the same rows in three arrays; the projection must match.
 */
const rows: AgendaRow[] = [
  row("Overdue A", "overdue", "2026-10-26", -2),
  row("Overdue B", "overdue", "2026-10-27", -1),
  row("Today", "today", "2026-10-28", 0),
  row("Upcoming A", "upcoming", "2026-10-29", 1),
  row("Upcoming B", "upcoming", "2026-11-02", 5),
];

describe("agendaBuckets", () => {
  it("partitions by the server's status without reordering", () => {
    const buckets = agendaBuckets(rows);

    expect(buckets.overdue.map((item) => item.title)).toEqual(["Overdue A", "Overdue B"]);
    expect(buckets.due_today.map((item) => item.title)).toEqual(["Today"]);
    expect(buckets.upcoming.map((item) => item.title)).toEqual(["Upcoming A", "Upcoming B"]);
    expect(buckets.overdue[0]).toBe(rows[0]);
  });

  it("renders the same rows the old three arrays carried", () => {
    const buckets = agendaBuckets(rows);
    const flattened = [...buckets.overdue, ...buckets.due_today, ...buckets.upcoming];

    expect(flattened).toEqual(rows);
  });

  it("drops statuses the List does not show", () => {
    const finished = [
      row("Done", "done", "2026-10-20", -8),
      row("Unscheduled", "unscheduled", "2026-10-20", -8),
    ];
    const buckets = agendaBuckets(finished);

    expect(buckets.overdue).toEqual([]);
    expect(buckets.due_today).toEqual([]);
    expect(buckets.upcoming).toEqual([]);
  });

  it("returns three empty buckets for an empty reply", () => {
    expect(agendaBuckets([])).toEqual({ overdue: [], due_today: [], upcoming: [] });
  });
});
