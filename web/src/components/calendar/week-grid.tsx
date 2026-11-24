import { Link } from "react-router";

import type { AgendaRow, ObjectSummary } from "@/api/types";
import { DayDueRow } from "@/components/calendar/day-due-row";
import { CalendarControls } from "@/components/views/calendar-controls";
import { WEEKDAYS } from "@/components/views/month-grid";
import { cn } from "@/lib/cn";
import { weekDays, weekLabel } from "@/lib/calendar";
import { longDayLabel } from "@/lib/daily";
import { shiftDay } from "@/lib/timezone";
import { groupByDate } from "@/lib/views";

interface WeekGridProps {
  spaceId: string;
  /** The Monday of the week on screen. */
  week: string;
  /** The space's civil today. */
  today: string;
  /** The week's journal notes, as the month's chips would show them. */
  notes: readonly ObjectSummary[];
  /** The week's outstanding scheduled rows, by due day. */
  dueByDate: ReadonlyMap<string, AgendaRow[]>;
  canEdit: boolean;
  /** The completion verb by type key. */
  verbs: Record<string, string>;
  /** The row whose completion or snooze is in flight, if any. */
  pendingId: string | null;
  onComplete: (row: AgendaRow) => void;
  onSnooze: (row: AgendaRow, days: number) => void;
  onWeekChange: (week: string) => void;
  onToday: () => void;
}

/**
 * The week shape of the space Calendar: seven days, Monday first, each
 * carrying the same layers as the month — its notes and its outstanding rows.
 *
 * From `lg` the days are seven columns, so a whole week reads in one line;
 * below `lg` they stack into seven day sections, because a phone-width column
 * cannot hold a title. One DOM either way, so nothing is announced twice.
 */
export function WeekGrid({
  spaceId,
  week,
  today,
  notes,
  dueByDate,
  canEdit,
  verbs,
  pendingId,
  onComplete,
  onSnooze,
  onWeekChange,
  onToday,
}: WeekGridProps) {
  const byDay = groupByDate(notes, (note) => note.title);
  return (
    <div className="mt-6 rounded-[22px] border border-line bg-surface p-4 sm:p-5">
      <CalendarControls
        label={weekLabel(week)}
        previousLabel="Previous week"
        nextLabel="Next week"
        onPrevious={() => onWeekChange(shiftDay(week, -7))}
        onNext={() => onWeekChange(shiftDay(week, 7))}
        onToday={onToday}
      />
      <div className="mt-2 grid grid-cols-1 border-t border-l rule lg:grid-cols-7">
        {weekDays(week).map((day, index) => {
          const dayNotes = byDay.get(day) ?? [];
          const rows = dueByDate.get(day) ?? [];
          const isToday = day === today;
          return (
            <section
              key={day}
              aria-label={longDayLabel(day)}
              className="min-w-0 border-r border-b rule p-2 lg:min-h-[15rem]"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-1">
                <span className="flex items-baseline gap-1.5">
                  <span className="label">{WEEKDAYS[index]}</span>
                  <time
                    dateTime={day}
                    className={cn(
                      "tnum font-mono text-[12px]",
                      isToday ? "text-accent" : "text-muted",
                    )}
                  >
                    {Number(day.slice(8, 10))}
                  </time>
                </span>
                {isToday ? (
                  <span className="font-mono text-[11px] tracking-[0.08em] text-accent">
                    TODAY
                  </span>
                ) : null}
              </div>
              <ul className="mt-1 grid gap-0.5">
                {dayNotes.map((note) => (
                  <li key={note.id} className="min-w-0">
                    <Link
                      to={`/s/${spaceId}/o/${note.id}`}
                      title={note.title}
                      className="block min-w-0 truncate rounded-[6px] border-l border-line-strong px-1 py-0.5 text-[13px] text-ink transition-colors hover:bg-raised max-sm:px-0.5 pointer-coarse:flex pointer-coarse:min-h-11 pointer-coarse:items-center pointer-coarse:py-0"
                    >
                      {note.icon ? (
                        <span aria-hidden className="mr-1">
                          {note.icon}
                        </span>
                      ) : null}
                      Note
                      <span className="sr-only">: {note.title}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              {canEdit && dayNotes.length === 0 ? (
                <Link
                  to={`/s/${spaceId}/daily/${day}`}
                  className="mt-1 inline-flex min-h-8 items-center px-1 font-mono text-[11px] uppercase tracking-[0.06em] text-accent hover:underline pointer-coarse:min-h-11"
                >
                  Write this day&apos;s note
                </Link>
              ) : null}
              {rows.length > 0 ? (
                <div className="mt-1 grid gap-0.5">
                  {rows.map((row) => (
                    <DayDueRow
                      key={row.id}
                      spaceId={spaceId}
                      row={row}
                      canEdit={canEdit}
                      verb={verbs[row.type] ?? "Complete"}
                      pending={pendingId === row.id}
                      onComplete={onComplete}
                      onSnooze={onSnooze}
                    />
                  ))}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}
