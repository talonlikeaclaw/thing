import { Link } from "react-router";

import type { AgendaRow, ObjectSummary } from "@/api/types";
import { DayDueRow } from "@/components/calendar/day-due-row";
import { DayNoteChip, DayWriteNote } from "@/components/calendar/day-note-chip";
import { CalendarControls } from "@/components/views/calendar-controls";
import { WEEKDAYS } from "@/components/views/month-grid";
import { DayWork } from "@/components/day-work";
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
  /**
   * The week's reads have not settled: the card keeps its controls and states
   * that it is reading, rather than inviting a write into an empty guess.
   */
  loading: boolean;
  canEdit: boolean;
  /** A journal exists and this reader may write it: the day slot offers a write. */
  canWriteDay: boolean;
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
 * Seven columns need a deadline's width to hold a title and a verb: they start
 * at `xl`. Two days share a row from `md`, and a phone stacks all seven,
 * because a column narrower than a card truncates every row it holds. One DOM
 * either way, so nothing is announced twice.
 */
export function WeekGrid({
  spaceId,
  week,
  today,
  notes,
  dueByDate,
  loading,
  canEdit,
  canWriteDay,
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
      {loading ? (
        <p role="status" className="mt-2 border-t rule pt-3 text-[13px] text-muted">
          Reading the week…
        </p>
      ) : (
        <div className="mt-2 grid grid-cols-1 border-t border-l rule md:grid-cols-2 xl:grid-cols-7">
          {weekDays(week).map((day, index) => {
            const dayNotes = byDay.get(day) ?? [];
            const rows = dueByDate.get(day) ?? [];
            const isToday = day === today;
            return (
              <section
                key={day}
                aria-label={longDayLabel(day)}
                className="min-w-0 border-r border-b rule p-2 xl:min-h-[15rem]"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-1">
                  <span className="flex items-baseline gap-1.5">
                    <span className="label">{WEEKDAYS[index]}</span>
                    {/*
                      The day's number is its address: every column opens the
                      day page, which answers with the note or the write card.
                    */}
                    <Link
                      to={`/s/${spaceId}/daily/${day}`}
                      aria-label={`Open ${longDayLabel(day)}`}
                      className="tnum inline-flex items-center justify-center px-1 font-mono text-[12px] transition-colors hover:text-accent hover:underline pointer-coarse:min-h-11 pointer-coarse:min-w-11"
                    >
                      <time dateTime={day} className={isToday ? "text-accent" : "text-muted"}>
                        {Number(day.slice(8, 10))}
                      </time>
                    </Link>
                  </span>
                  {isToday ? (
                    <span className="font-mono text-[11px] tracking-[0.08em] text-accent">
                      TODAY
                    </span>
                  ) : null}
                </div>
                <ul className="mt-1 grid gap-1">
                  {dayNotes.map((note) => (
                    <li key={note.id} className="min-w-0">
                      <DayNoteChip spaceId={spaceId} note={note} />
                    </li>
                  ))}
                </ul>
                {canWriteDay && dayNotes.length === 0 ? (
                  <DayWriteNote spaceId={spaceId} day={day} className="mt-1">
                    {/* A stacked day has room for the sentence; a seven-column
                        week does not. */}
                    <span className="min-w-0 truncate leading-tight xl:hidden">
                      Write this day&apos;s note
                    </span>
                    <span className="hidden min-w-0 truncate leading-tight xl:inline">
                      Write note
                    </span>
                  </DayWriteNote>
                ) : null}
                {rows.length > 0 ? (
                  /*
                   * The work is its own layer under the day's note: a tray
                   * with its own heading, so outstanding rows never float as
                   * loose blocks between the note and the next day's column.
                   * The heading is the short word because the column above it
                   * already names the day.
                   */
                  <DayWork label="Due" count={rows.length} className="mt-1.5">
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
                  </DayWork>
                ) : null}
              </section>
            );
          })}
          {/* Seven days over two columns leave one cell over: the filler keeps
              that row's frame closed instead of stopping at the card's edge. */}
          <div aria-hidden className="hidden border-r border-b rule md:block xl:hidden" />
        </div>
      )}
    </div>
  );
}
