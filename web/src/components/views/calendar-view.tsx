import { ChevronLeft, ChevronRight } from "lucide-react";
import { Link } from "react-router";

import type { ObjectSummary, PropertyDef, ViewDef } from "@/api/types";
import { cn } from "@/lib/cn";
import { addMonths, monthGrid, monthOf, recordsByDate } from "@/lib/views";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MAX_CHIPS = 3;

interface CalendarViewProps {
  spaceId: string;
  view: ViewDef;
  rows: ObjectSummary[];
  properties: PropertyDef[];
  month: string;
  today: string;
  /** The same type's table view, when one exists. */
  tableHref?: string;
  onMonthChange: (month: string) => void;
}

/** A Monday-first month grid placing records on the view's date property. */
export function CalendarView({
  spaceId,
  view,
  rows,
  properties,
  month,
  today,
  tableHref,
  onMonthChange,
}: CalendarViewProps) {
  const dateProperty = view.date_property
    ? properties.find((property) => property.key === view.date_property)
    : undefined;

  if (!dateProperty) {
    return (
      <p className="mt-6 max-w-[52ch] border-t rule pt-4 text-muted">
        This calendar names no date property. Edit the type file so the view has a{" "}
        <span className="font-mono text-[12px]">date_property</span>.
      </p>
    );
  }

  const byDate = recordsByDate(rows, dateProperty.key);
  const dated = [...byDate.values()].reduce((sum, bucket) => sum + bucket.length, 0);
  const undated = rows.length - dated;
  const weeks = monthGrid(
    Number(month.slice(0, 4)),
    Number(month.slice(5, 7)),
  );
  const label = new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}-01T00:00:00Z`));

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-medium">{label}</h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Previous month"
            className="inline-flex h-8 w-8 items-center justify-center rounded-[3px] text-muted transition-colors hover:bg-raised hover:text-ink pointer-coarse:h-11 pointer-coarse:w-11"
            onClick={() => onMonthChange(addMonths(month, -1))}
          >
            <ChevronLeft aria-hidden size={15} />
          </button>
          <button
            type="button"
            className="label rounded-[3px] px-2 py-1 text-muted transition-colors hover:bg-raised hover:text-ink pointer-coarse:min-h-11"
            onClick={() => onMonthChange(monthOf(today))}
          >
            Today
          </button>
          <button
            type="button"
            aria-label="Next month"
            className="inline-flex h-8 w-8 items-center justify-center rounded-[3px] text-muted transition-colors hover:bg-raised hover:text-ink pointer-coarse:h-11 pointer-coarse:w-11"
            onClick={() => onMonthChange(addMonths(month, 1))}
          >
            <ChevronRight aria-hidden size={15} />
          </button>
        </div>
      </div>

      {rows.length > 0 && dated === 0 ? (
        <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t rule pt-3">
          <p className="text-[13px] text-muted">
            No record in this view has a {dateProperty.name} yet.
          </p>
          {tableHref ? (
            <Link
              to={tableHref}
              className="text-[13px] text-accent underline decoration-accent/50 underline-offset-2 hover:decoration-accent pointer-coarse:min-h-11 pointer-coarse:content-center"
            >
              Open the table
            </Link>
          ) : null}
        </div>
      ) : null}

      <div className="mt-2 grid grid-cols-7 border-t border-l rule">
        {WEEKDAYS.map((day) => (
          <div key={day} className="border-r border-b rule px-1.5 py-1">
            <span className="label">{day}</span>
          </div>
        ))}
        {weeks.flat().map((cell) => {
          const bucket = byDate.get(cell.date) ?? [];
          const isToday = cell.date === today;
          return (
            <div
              key={cell.date}
              className={cn(
                "min-h-[6.5rem] border-r border-b rule p-1.5",
                cell.inMonth ? "" : "bg-surface/40",
              )}
            >
              <div className="flex items-baseline justify-between gap-1">
                <span
                  className={cn(
                    "font-mono text-[11px] tnum",
                    cell.inMonth ? "text-muted" : "text-faint",
                    isToday ? "text-accent" : "",
                  )}
                >
                  {Number(cell.date.slice(8, 10))}
                </span>
                {isToday ? (
                  <span className="font-mono text-[8px] tracking-[0.08em] text-accent">
                    TODAY
                  </span>
                ) : null}
              </div>
              <ul className="mt-1 grid gap-0.5">
                {bucket.slice(0, MAX_CHIPS).map((row) => (
                  <li key={row.id} className="min-w-0">
                    <Link
                      to={`/s/${spaceId}/o/${row.id}`}
                      title={row.title}
                      className="block truncate rounded-[3px] border-l border-line-strong px-1 py-0.5 text-[12px] text-ink transition-colors hover:bg-raised"
                    >
                      {row.title}
                    </Link>
                  </li>
                ))}
                {bucket.length > MAX_CHIPS ? (
                  <li className="px-1 font-mono text-[10px] text-faint">
                    +{bucket.length - MAX_CHIPS} more
                  </li>
                ) : null}
              </ul>
            </div>
          );
        })}
      </div>

      <p className="mt-2 text-[12px] text-faint">
        {undated === 0
          ? "Every record in this view has a date."
          : `${undated} ${undated === 1 ? "record has" : "records have"} no ${dateProperty.name}.`}
      </p>
    </div>
  );
}
