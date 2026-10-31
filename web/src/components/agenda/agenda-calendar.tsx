import { Link } from "react-router";

import type { AgendaRow } from "@/api/types";
import { ThumbRow } from "@/components/handedness";
import { Button } from "@/components/ui/controls";
import { MonthGrid } from "@/components/views/month-grid";
import { cn } from "@/lib/cn";
import { duePhrase, dueTone } from "@/lib/schedule";
import { monthLabel } from "@/lib/views";

/**
 * The Calendar across every scheduled type: one month grid over the agenda's
 * rows, with a day panel that reads like the List's rows and completes with the
 * same verb.
 */
export function AgendaCalendar({
  spaceId,
  month,
  today,
  rows,
  canEdit,
  verbs,
  pendingId,
  onComplete,
  onMonthChange,
}: {
  spaceId: string;
  month: string;
  /** The space's civil date, from the space or the agenda read. */
  today: string;
  rows: AgendaRow[];
  canEdit: boolean;
  /** The type's completion verb, by type key. */
  verbs: Record<string, string>;
  /** The row whose completion is in flight, if any. */
  pendingId: string | null;
  onComplete: (row: AgendaRow) => void;
  onMonthChange: (month: string) => void;
}) {
  return (
    <MonthGrid
      month={month}
      today={today}
      items={rows}
      dateOf={(row) => row.due_date}
      keyOf={(row) => row.id}
      hrefOf={(row) => `/s/${spaceId}/o/${row.id}`}
      titleOf={(row) => row.title}
      renderChip={(row) => (
        <>
          {row.type_icon ? (
            <span aria-hidden className="mr-1">
              {row.type_icon}
            </span>
          ) : null}
          {row.title}
        </>
      )}
      renderActions={() => null}
      renderRow={(row) => {
        const phrase = duePhrase(row.status, row.days_until_due);
        const verb = verbs[row.type] ?? "Complete";
        return (
          <ThumbRow className="min-w-0 flex-1 items-center gap-1">
            <Link
              to={`/s/${spaceId}/o/${row.id}`}
              title={row.title}
              className="min-w-0 flex-1 px-1 py-1 hover:bg-raised pointer-coarse:min-h-11"
            >
              <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="min-w-0 truncate text-[13px] text-ink">
                  {row.type_icon ? (
                    <span aria-hidden className="mr-1">
                      {row.type_icon}
                    </span>
                  ) : null}
                  {row.title}
                </span>
                <span className="font-mono text-[11px] text-faint">
                  {row.type_name || row.type}
                </span>
              </span>
              <span className="mt-0.5 flex flex-wrap items-baseline gap-x-2 font-mono text-[11px]">
                <span className="tnum text-muted">{row.due_date}</span>
                {phrase ? (
                  <span className={cn("tnum", dueTone(row.status))}>{phrase}</span>
                ) : null}
                {row.recurrence ? <span className="text-faint">{row.recurrence}</span> : null}
              </span>
            </Link>
            {canEdit ? (
              <Button
                type="button"
                variant="ghost"
                aria-label={`${verb} ${row.title}`}
                title={verb}
                className="min-h-8 min-w-0 px-2 text-[13px] pointer-coarse:min-h-11"
                disabled={pendingId === row.id}
                onClick={() => onComplete(row)}
              >
                <span className="min-w-0 truncate">
                  {pendingId === row.id ? "Saving…" : verb}
                </span>
              </Button>
            ) : null}
          </ThumbRow>
        );
      }}
      above={
        rows.length === 0 ? (
          <p className="mt-3 border-t rule pt-3 text-[13px] text-muted">
            Nothing scheduled in {monthLabel(month)}.
          </p>
        ) : null
      }
      onMonthChange={onMonthChange}
    />
  );
}
