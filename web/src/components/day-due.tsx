import { Link } from "react-router";

import { useAgenda } from "@/api/queries";
import { cn } from "@/lib/cn";
import { duePhrase, dueTone } from "@/lib/schedule";

interface DayDueProps {
  spaceId: string;
  /** The day whose outstanding rows are listed, `YYYY-MM-DD`. */
  day: string;
  /** The column the caller gives it: a grid cell on the card, the margin here. */
  className?: string;
}

/**
 * The day's outstanding rows, as a read. Shared with the day card so the card
 * can give its margin the column only when there is something to put in it;
 * both callers hit the same cached agenda query.
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
 * heading says **Due that day**, never "done that day".
 */
export function DayDue({ spaceId, day, className }: DayDueProps) {
  const rows = useDayDue(spaceId, day).data?.rows ?? [];
  if (rows.length === 0) {
    return null;
  }
  return (
    <section aria-label="Due that day" className={cn("min-w-0", className)}>
      <h2 className="flex flex-wrap items-baseline gap-2 text-heading font-medium">
        Due that day
        <span className="font-mono text-[length:var(--text-small)] font-normal text-faint tnum">
          {rows.length}
        </span>
      </h2>
      <ul className="mt-1">
        {rows.map((row) => {
          const phrase = duePhrase(row.status, row.days_until_due);
          return (
            <li key={row.id} className="border-b rule last:border-b-0">
              <Link to={`/s/${spaceId}/o/${row.id}`} className="group block min-w-0 py-2.5">
                <span className="block min-w-0 truncate text-[15px] font-medium text-ink group-hover:underline">
                  {row.title}
                </span>
                <span className="mt-1 flex flex-wrap items-baseline gap-x-2 font-mono text-[12px]">
                  <span className="text-faint">
                    {row.type_icon ? (
                      <span aria-hidden className="mr-1">
                        {row.type_icon}
                      </span>
                    ) : null}
                    {row.type_name || row.type}
                  </span>
                  {phrase ? (
                    <span className={cn("tnum", dueTone(row.status))}>{phrase}</span>
                  ) : null}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
