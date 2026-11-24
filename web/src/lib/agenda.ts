import type { AgendaRow } from "@/api/types";


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

/** The windows the List offers. */
export const AGENDA_HORIZONS = [7, 14, 30] as const;
export type AgendaHorizon = (typeof AGENDA_HORIZONS)[number];

/** The defaults the URL omits. */
export const DEFAULT_AGENDA_HORIZON: AgendaHorizon = 14;

/** Everything the Schedule page remembers: List horizon and types. */
export interface AgendaState {
  horizon: AgendaHorizon;
  /** Scheduled type keys; empty means every scheduled type. */
  types: string[];
}

/** The slice of `Storage` this module needs; a fake can stand in for it. */
export interface AgendaStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function isHorizon(value: unknown): value is AgendaHorizon {
  return value === 7 || value === 14 || value === 30;
}

/** Trimmed, deduplicated and sorted, so the same selection makes one link. */
export function normalizeAgendaTypes(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

/** The active types as a sentence: "Chore", "Chore and Plant". */
export function agendaTypeLabel(names: readonly string[]): string {
  if (names.length <= 1) {
    return names[0] ?? "";
  }
  return new Intl.ListFormat("en", { style: "long", type: "conjunction" }).format(names);
}

/** A first visit: the List at 14 days. */
export function defaultAgendaState(): AgendaState {
  return { horizon: DEFAULT_AGENDA_HORIZON, types: [] };
}

/**
 * The state a query string names, falling back to `base` for anything missing
 * or invalid. Unknown parameters are the caller's to ignore.
 */
export function agendaStateFromParams(params: URLSearchParams, base: AgendaState): AgendaState {
  const horizon = Number(params.get("horizon"));
  const types = params.get("types");
  return {
    horizon: isHorizon(horizon) ? horizon : base.horizon,
    types: types === null ? base.types : normalizeAgendaTypes(types.split(",")),
  };
}

/**
 * The query string for a state, writing only what differs from the defaults,
 * in a fixed order so the same state always makes the same link.
 */
export function agendaParams(state: AgendaState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.horizon !== DEFAULT_AGENDA_HORIZON) {
    params.set("horizon", String(state.horizon));
  }
  const types = normalizeAgendaTypes(state.types);
  if (types.length > 0) {
    params.set("types", types.join(","));
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
  const storedTypes = stored.types;
  return {
    horizon: isHorizon(stored.horizon) ? stored.horizon : base.horizon,
    types:
      Array.isArray(storedTypes) && storedTypes.every((value) => typeof value === "string")
        ? normalizeAgendaTypes(storedTypes)
        : base.types,
  };
}

/** Persists one state; a refused write is swallowed so the page still works. */
export function writeAgendaState(storage: AgendaStorage, key: string, state: AgendaState): void {
  try {
    storage.setItem(key, JSON.stringify({ ...state, types: normalizeAgendaTypes(state.types) }));
  } catch {
    // Storage is a convenience; the URL still carries the state.
  }
}
