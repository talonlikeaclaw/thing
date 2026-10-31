import type { AgendaRow } from "@/api/types";
import { monthGrid, monthOf } from "@/lib/views";

/** The three List buckets, in display order. */
export interface AgendaBuckets {
  overdue: AgendaRow[];
  due_today: AgendaRow[];
  upcoming: AgendaRow[];
}

/**
 * Splits the server's rows into the List's buckets by the status the server
 * classified, preserving the server's order inside each bucket. The rows are a
 * projection, not a second response: the calendar reads the same array.
 */
export function agendaBuckets(rows: AgendaRow[]): AgendaBuckets {
  const buckets: AgendaBuckets = { overdue: [], due_today: [], upcoming: [] };
  for (const row of rows) {
    if (row.status === "overdue") {
      buckets.overdue.push(row);
    } else if (row.status === "today") {
      buckets.due_today.push(row);
    } else if (row.status === "upcoming") {
      buckets.upcoming.push(row);
    }
  }
  return buckets;
}

/** The two ways Schedule shows one set of rows. */
export type AgendaView = "list" | "calendar";

/** The windows the List offers. */
export const AGENDA_HORIZONS = [7, 14, 30] as const;
export type AgendaHorizon = (typeof AGENDA_HORIZONS)[number];

/** The defaults the URL omits. */
export const DEFAULT_AGENDA_HORIZON: AgendaHorizon = 14;

/** Everything the Schedule page remembers: view, List horizon and month. */
export interface AgendaState {
  view: AgendaView;
  horizon: AgendaHorizon;
  /** `YYYY-MM` for the Calendar; kept while the List is showing. */
  month: string;
}

/** The slice of `Storage` this module needs; a fake can stand in for it. */
export interface AgendaStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Whether `value` is a `YYYY-MM` month the calendar helpers can read. */
export function isMonth(value: string): boolean {
  return MONTH.test(value);
}

function isHorizon(value: unknown): value is AgendaHorizon {
  return value === 7 || value === 14 || value === 30;
}

/** A first visit: the List at 14 days, on the month containing `today`. */
export function defaultAgendaState(today: string): AgendaState {
  return { view: "list", horizon: DEFAULT_AGENDA_HORIZON, month: monthOf(today) };
}

/**
 * The state a query string names, falling back to `base` for anything missing
 * or invalid. Unknown parameters are the caller's to ignore.
 */
export function agendaStateFromParams(params: URLSearchParams, base: AgendaState): AgendaState {
  const view = params.get("view");
  const horizon = Number(params.get("horizon"));
  const month = params.get("month") ?? "";
  return {
    view: view === "list" || view === "calendar" ? view : base.view,
    horizon: isHorizon(horizon) ? horizon : base.horizon,
    month: isMonth(month) ? month : base.month,
  };
}

/**
 * The query string for a state, writing only what differs from the defaults
 * `base` names, in a fixed order so the same state always makes the same link.
 */
export function agendaParams(state: AgendaState, base: AgendaState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.view !== "list") {
    params.set("view", state.view);
  }
  if (state.horizon !== DEFAULT_AGENDA_HORIZON) {
    params.set("horizon", String(state.horizon));
  }
  if (state.month !== base.month) {
    params.set("month", state.month);
  }
  return params;
}

/** The browser-local key for one user in one space. */
export function agendaStorageKey(userId: string, spaceId: string): string {
  return `thing:agenda:${userId}:${spaceId}`;
}

/**
 * The remembered state, or `base` for anything missing, malformed or refused.
 * A field the stored value gets wrong falls back on its own; this never throws.
 */
export function readAgendaState(
  storage: AgendaStorage,
  key: string,
  base: AgendaState,
): AgendaState {
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return base;
  }
  if (!raw) {
    return base;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return base;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return base;
  }
  const stored = parsed as Record<string, unknown>;
  return {
    view:
      stored.view === "list" || stored.view === "calendar" ? stored.view : base.view,
    horizon: isHorizon(stored.horizon) ? stored.horizon : base.horizon,
    month: typeof stored.month === "string" && isMonth(stored.month) ? stored.month : base.month,
  };
}

/** Persists one state; a refused write is swallowed so the page still works. */
export function writeAgendaState(storage: AgendaStorage, key: string, state: AgendaState): void {
  try {
    storage.setItem(key, JSON.stringify(state));
  } catch {
    // Storage is a convenience; the URL still carries the state.
  }
}

/**
 * The inclusive date range one month grid needs: its first cell through its
 * last, so the adjacent-month days are filled.
 */
export function gridWindow(month: string): { from: string; to: string } {
  const cells = monthGrid(Number(month.slice(0, 4)), Number(month.slice(5, 7))).flat();
  return { from: cells[0]?.date ?? "", to: cells[cells.length - 1]?.date ?? "" };
}
