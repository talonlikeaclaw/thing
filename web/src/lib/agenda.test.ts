import { describe, expect, it } from "vitest";

import type { AgendaRow, ScheduleStatus } from "@/api/types";

import {
  agendaBuckets,
  agendaParams,
  agendaStateFromParams,
  agendaStorageKey,
  defaultAgendaState,
  gridWindow,
  readAgendaState,
  writeAgendaState,
  type AgendaState,
  type AgendaStorage,
} from "@/lib/agenda";

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

function memoryStorage(initial: Record<string, string> = {}): AgendaStorage & {
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

const base = defaultAgendaState("2026-10-30");

describe("agenda page state", () => {
  it("starts on the List at 14 days in the current month", () => {
    expect(base).toEqual({ view: "list", horizon: 14, month: "2026-10" });
  });

  it("writes no parameters for the defaults", () => {
    expect(agendaParams(base, base).toString()).toBe("");
  });

  it("writes non-default state in a fixed order", () => {
    const state: AgendaState = { view: "calendar", horizon: 30, month: "2026-11" };
    expect(agendaParams(state, base).toString()).toBe(
      "view=calendar&horizon=30&month=2026-11",
    );
  });

  it("round-trips every view, horizon and month through the query string", () => {
    for (const view of ["list", "calendar"] as const) {
      for (const horizon of [7, 14, 30] as const) {
        for (const month of ["2026-10", "2026-11", "2027-01"]) {
          const state: AgendaState = { view, horizon, month };
          const params = agendaParams(state, base);
          expect(agendaStateFromParams(params, base)).toEqual(state);
        }
      }
    }
  });

  it("falls back to the base for missing or invalid parameters", () => {
    const params = new URLSearchParams("view=board&horizon=99&month=2026-13");
    expect(agendaStateFromParams(params, base)).toEqual(base);
    expect(agendaStateFromParams(new URLSearchParams(), base)).toEqual(base);
    expect(
      agendaStateFromParams(new URLSearchParams("view=calendar&month=2026-11"), base),
    ).toEqual({ view: "calendar", horizon: 14, month: "2026-11" });
  });

  it("scopes storage to the user and the space", () => {
    expect(agendaStorageKey("user-1", "space-1")).toBe("thing:agenda:user-1:space-1");
  });

  it("reads a stored state back", () => {
    const storage = memoryStorage();
    const key = agendaStorageKey("user-1", "space-1");
    const state: AgendaState = { view: "calendar", horizon: 7, month: "2026-11" };
    writeAgendaState(storage, key, state);
    expect(readAgendaState(storage, key, base)).toEqual(state);
  });

  it("falls back to the base for missing or malformed storage", () => {
    const key = agendaStorageKey("user-1", "space-1");
    expect(readAgendaState(memoryStorage(), key, base)).toEqual(base);
    expect(readAgendaState(memoryStorage({ [key]: "{" }), key, base)).toEqual(base);
    expect(readAgendaState(memoryStorage({ [key]: '"calendar"' }), key, base)).toEqual(base);
  });

  it("keeps the valid fields of a partly corrupted stored state", () => {
    const key = agendaStorageKey("user-1", "space-1");
    const storage = memoryStorage({
      [key]: JSON.stringify({ view: "calendar", horizon: "7", month: "2026-11" }),
    });
    expect(readAgendaState(storage, key, base)).toEqual({
      view: "calendar",
      horizon: 14,
      month: "2026-11",
    });
  });

  it("swallows a refused storage write", () => {
    const storage: AgendaStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(() => writeAgendaState(storage, "key", base)).not.toThrow();
  });

  it("computes the inclusive grid window for a month", () => {
    expect(gridWindow("2026-10")).toEqual({ from: "2026-09-28", to: "2026-11-01" });
    expect(gridWindow("2026-02")).toEqual({ from: "2026-01-26", to: "2026-03-01" });
  });
});
