import { useMemo } from "react";

import { useAgenda } from "@/api/queries";
import { DayDueRow } from "@/components/calendar/day-due-row";
import { DayWork } from "@/components/day-work";
import { useAgendaActions } from "@/lib/agenda-actions";

interface DayDueProps {
  spaceId: string;
  /** The day whose outstanding rows are listed, `YYYY-MM-DD`. */
  day: string;
  /** The space's civil today, so the day's own list says it is today's. */
  today: string;
  /** An editor completes and snoozes a row where it is listed. */
  canEdit?: boolean;
  /** The column the caller gives it: a grid cell on the card, the margin here. */
  className?: string;
}

/**
 * The day's outstanding rows, as both a read and an action surface. Shared
 * with the day card so the card can give its margin the column only when there
 * is something to put in it; both callers hit the same cached agenda query.
 */
export function useDayDue(spaceId: string | undefined, day: string) {
  return useAgenda(spaceId, { from: day, to: day });
}

/**
 * The day's own context: the scheduled rows still outstanding on it, read
 * through the agenda's range mode. One component for the day card and the note
 * the day becomes, so the margin a reader learns before writing is the margin
 * they find after — the day's work sits where a record keeps its properties.
 *
 * A completed row is not listed, because the agenda never lists one; the
 * heading names the day it is on — **Due today** for today, **Due that day**
 * for any other — and never says "done that day". An editor gets the calendar
 * row's own grammar, so a row is completed or snoozed where it is read.
 */
export function DayDue({ spaceId, day, today, canEdit = false, className }: DayDueProps) {
  const rows = useDayDue(spaceId, day).data?.rows ?? [];
  const typeKeys = useMemo(
    () => (canEdit ? [...new Set(rows.map((row) => row.type))] : []),
    [canEdit, rows],
  );
  const { verbs, pendingId, onComplete, onSnooze } = useAgendaActions(spaceId, typeKeys);
  if (rows.length === 0) {
    return null;
  }
  const heading = day === today ? "Due today" : "Due that day";
  return (
    <DayWork label={heading} count={rows.length} framed={false} className={className}>
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
  );
}
