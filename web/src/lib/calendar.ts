import { isDayTitle } from "@/lib/daily";
import { shiftDay } from "@/lib/timezone";
import { isMonth, monthOf, monthName } from "@/lib/views";

/**
 * The space Calendar's state: which shape of time is showing, which month or
 * week, and which scheduled types narrow the due rows.
 *
 * A month is the space's default shape; the week is the detail zoom. The week
 * is a calendar week from Monday to Sunday, so it always predicts the same
 * seven days the month grid's first column does.
 */

/** The calendar's two shapes. */
export type CalendarView = "month" | "week";

/** Everything the Calendar page remembers. */
export interface CalendarState {
  view: CalendarView;
  /** `YYYY-MM` for the month view; kept while the week is showing. */
  month: string;
  /** The Monday of the week, `YYYY-MM-DD`; kept while the month is showing. */
  week: string;
  /** Scheduled type keys; empty means every scheduled type. */
  types: string[];
}

/** The slice of `Storage` this module needs; a fake can stand in for it. */
export interface CalendarStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The Monday of the week `day` falls in; `""` for a day that is not one. */
export function weekStart(day: string): string {
  if (!isDayTitle(day)) {
    return "";
  }
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return shiftDay(day, -((weekday + 6) % 7));
}

/** The seven days of a calendar week, Monday first; empty for a bad week. */
export function weekDays(week: string): string[] {
  if (!isDayTitle(week)) {
    return [];
  }
  return Array.from({ length: 7 }, (_, index) => shiftDay(week, index));
}

/** The inclusive bounds one week paints, for the list and agenda reads. */
export function weekRange(week: string): { from: string; to: string } {
  return { from: week, to: isDayTitle(week) ? shiftDay(week, 6) : "" };
}

/**
 * A week as `23–29 November 2026`, naming the month once when both ends share
 * it and both years only when the week crosses a new year.
 */
export function weekLabel(week: string): string {
  if (!isDayTitle(week)) {
    return "";
  }
  const end = shiftDay(week, 6);
  const startDay = Number(week.slice(8, 10));
  const endDay = Number(end.slice(8, 10));
  const startYear = week.slice(0, 4);
  const endYear = end.slice(0, 4);
  if (week.slice(0, 7) === end.slice(0, 7)) {
    return `${startDay}–${endDay} ${monthName(week.slice(0, 7))} ${startYear}`;
  }
  if (startYear === endYear) {
    return `${startDay} ${monthName(week.slice(0, 7))} – ${endDay} ${monthName(end.slice(0, 7))} ${startYear}`;
  }
  return `${startDay} ${monthName(week.slice(0, 7))} ${startYear} – ${endDay} ${monthName(end.slice(0, 7))} ${endYear}`;
}

/** Trimmed, deduplicated and sorted, so the same selection makes one link. */
export function normalizeCalendarTypes(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

/** A first visit: the month containing `today`, and that day's week. */
export function defaultCalendarState(today: string): CalendarState {
  return { view: "month", month: monthOf(today), week: weekStart(today), types: [] };
}

/**
 * The state a query string names, falling back to `base` for anything missing
 * or invalid. A `week` is normalized to its Monday, so every address of the
 * same week is one address.
 */
export function calendarStateFromParams(
  params: URLSearchParams,
  base: CalendarState,
): CalendarState {
  const view = params.get("view");
  const month = params.get("month") ?? "";
  const week = params.get("week") ?? "";
  const types = params.get("types");
  return {
    view: view === "month" || view === "week" ? view : base.view,
    month: isMonth(month) ? month : base.month,
    week: isDayTitle(week) ? weekStart(week) : base.week,
    types: types === null ? base.types : normalizeCalendarTypes(types.split(",")),
  };
}

/**
 * The query string for a state, writing only what differs from the defaults
 * `base` names, in a fixed order so the same state always makes the same link.
 */
export function calendarParams(state: CalendarState, base: CalendarState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.view !== base.view) {
    params.set("view", state.view);
  }
  if (state.month !== base.month) {
    params.set("month", state.month);
  }
  if (state.week !== base.week) {
    params.set("week", state.week);
  }
  const types = normalizeCalendarTypes(state.types);
  if (types.length > 0) {
    params.set("types", types.join(","));
  }
  return params;
}

/** The browser-local key for one reader in one space. */
export function calendarStorageKey(userId: string, spaceId: string): string {
  return `thing:calendar:${userId}:${spaceId}`;
}

/**
 * The remembered state, or `base` for anything missing, malformed or refused.
 * The reader's last shape is the default a bare `/calendar` opens with.
 */
export function readCalendarState(
  storage: CalendarStorage,
  key: string,
  base: CalendarState,
): CalendarState {
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
    view: stored.view === "month" || stored.view === "week" ? stored.view : base.view,
    month: typeof stored.month === "string" && isMonth(stored.month) ? stored.month : base.month,
    week:
      typeof stored.week === "string" && isDayTitle(stored.week)
        ? weekStart(stored.week)
        : base.week,
    types:
      Array.isArray(storedTypes) && storedTypes.every((value) => typeof value === "string")
        ? normalizeCalendarTypes(storedTypes)
        : base.types,
  };
}

/** Persists one state; a refused write is swallowed so the page still works. */
export function writeCalendarState(
  storage: CalendarStorage,
  key: string,
  state: CalendarState,
): void {
  try {
    storage.setItem(
      key,
      JSON.stringify({ ...state, types: normalizeCalendarTypes(state.types) }),
    );
  } catch {
    // Storage is a convenience; the URL still carries the state.
  }
}
