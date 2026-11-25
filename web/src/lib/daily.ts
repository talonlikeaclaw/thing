import { shiftDay } from "@/lib/timezone";
import { isMonth } from "@/lib/views";

/**
 * The daily-note grammar: what a day title is, how days step, what a run of
 * written days counts, and how a day and a month read.
 *
 * Day arithmetic itself (`shiftDay`) sits with `todayIn` in `lib/timezone.ts`:
 * both are civil-day math, and both are built on UTC midnights so no browser
 * zone can move a day.
 */

const DAY_TITLE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Whether `title` is a day, and the only thing that makes a record a journal
 * entry: exactly `YYYY-MM-DD` for a real date. `2026-02-30`, `2026-13-01`,
 * `2026-1-2` and `"2026-02-03 "` are names, not days.
 */
export function isDayTitle(title: string): boolean {
  if (!DAY_TITLE.test(title)) {
    return false;
  }
  const at = new Date(`${title}T00:00:00Z`);
  return !Number.isNaN(at.getTime()) && at.toISOString().slice(0, 10) === title;
}

/**
 * Days of written notes the run may see. The calendar reads this window, so a
 * saturated run reads as `90+` rather than a number the read never covered.
 */
export const STREAK_DAYS = 90;

/**
 * The run of consecutive written days ending today — or ending yesterday, so
 * an unwritten today does not break a run before the day is over. Zero when
 * neither today nor yesterday is written.
 */
export function streakOf(written: ReadonlySet<string>, today: string): number {
  let day = written.has(today) ? today : shiftDay(today, -1);
  let run = 0;
  while (written.has(day)) {
    run += 1;
    day = shiftDay(day, -1);
  }
  return run;
}

const shortDay = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

const longDay = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/** One part of a formatted day, or `""` when the locale did not emit it. */
function partOf(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((part) => part.type === type)?.value ?? "";
}

function formatParts(
  formatter: Intl.DateTimeFormat,
  day: string,
): Intl.DateTimeFormatPart[] | null {
  const at = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(at.getTime()) ? null : formatter.formatToParts(at);
}

/**
 * A day in the short form every strip uses — `Sun 23 Nov` — with the parts in
 * that order whatever the reader's locale does with dates. A malformed day
 * reads as itself.
 */
export function dayLabel(day: string): string {
  const parts = formatParts(shortDay, day);
  if (!parts) {
    return day;
  }
  return `${partOf(parts, "weekday")} ${partOf(parts, "day")} ${partOf(parts, "month")}`.trim();
}

/**
 * A day without its month — `Sun 23` — for a chip that sits above the month it
 * belongs to. Used where the month is already named, so a narrow rail never
 * truncates the date it is stepping.
 */
export function dayNumberLabel(day: string): string {
  const parts = formatParts(shortDay, day);
  if (!parts) {
    return day;
  }
  return `${partOf(parts, "weekday")} ${partOf(parts, "day")}`.trim();
}

/**
 * The long form a day card leads with — `Sunday, 23 November 2026` — assembled
 * in the same fixed order, in UTC. A malformed day reads as itself.
 */
export function longDayLabel(day: string): string {
  const parts = formatParts(longDay, day);
  if (!parts) {
    return day;
  }
  const weekday = partOf(parts, "weekday");
  const date = `${partOf(parts, "day")} ${partOf(parts, "month")} ${partOf(parts, "year")}`;
  return weekday ? `${weekday}, ${date}` : date;
}

/**
 * The `?month=` a URL carries, when it is a real `YYYY-MM`; anything else is
 * reader input and falls back rather than reaching a calendar helper.
 */
export function monthParam(raw: string | null | undefined, fallback: string): string {
  return raw && isMonth(raw) ? raw : fallback;
}
