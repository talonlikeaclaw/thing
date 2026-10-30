import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";

import type { ObjectSummary, PropertyDef, ViewDef } from "@/api/types";
import { Button } from "@/components/ui/controls";
import { CardActions } from "@/components/views/card-actions";
import { cn } from "@/lib/cn";
import { addMonths, monthGrid, monthOf, recordsByDate } from "@/lib/views";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MAX_CHIPS = 3;
const DAY_PANEL_WIDTH = 272;
const DAY_PANEL_MARGIN = 8;

/** Day cells are ~50 px wide on a phone; a tap has to be told from a scroll. */
function coarsePointer(): boolean {
  return typeof window.matchMedia === "function"
    ? window.matchMedia("(pointer: coarse)").matches
    : false;
}

interface CalendarViewProps {
  spaceId: string;
  view: ViewDef;
  rows: ObjectSummary[];
  properties: PropertyDef[];
  month: string;
  today: string;
  /** The same type's table view, when one exists. */
  tableHref?: string;
  canEdit: boolean;
  completing: boolean;
  pendingRows: ReadonlySet<string>;
  verb: string;
  onComplete: (row: ObjectSummary) => void;
  onDuplicate: (row: ObjectSummary) => void;
  onTrash: (row: ObjectSummary) => void;
  onOpenSettings: () => void;
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
  canEdit,
  completing,
  pendingRows,
  verb,
  onComplete,
  onDuplicate,
  onTrash,
  onOpenSettings,
  onMonthChange,
}: CalendarViewProps) {
  const [dayOpen, setDayOpen] = useState<{
    date: string;
    top: number;
    left: number;
    maxHeight: number;
  } | null>(null);
  const dayPanel = useRef<HTMLDivElement | null>(null);
  const dayAnchor = useRef<HTMLElement | null>(null);

  /**
   * The day list is portalled and clamped into the viewport, so it flips on a
   * cell at the right or bottom edge instead of hanging out of the window.
   */
  function openDay(date: string, anchor: HTMLElement) {
    const rect = anchor.getBoundingClientRect();
    const top = Math.max(
      DAY_PANEL_MARGIN,
      Math.min(rect.bottom + 4, window.innerHeight - DAY_PANEL_MARGIN - 96),
    );
    const width = Math.min(DAY_PANEL_WIDTH, window.innerWidth - DAY_PANEL_MARGIN * 2);
    dayAnchor.current = anchor;
    setDayOpen({
      date,
      top,
      left: Math.min(
        Math.max(DAY_PANEL_MARGIN, rect.left),
        window.innerWidth - width - DAY_PANEL_MARGIN,
      ),
      maxHeight: window.innerHeight - top - DAY_PANEL_MARGIN,
    });
  }

  useLayoutEffect(() => {
    if (dayOpen) {
      dayPanel.current?.focus();
      return;
    }
    dayAnchor.current?.focus({ preventScroll: true });
    dayAnchor.current = null;
  }, [dayOpen]);

  useEffect(() => {
    if (!dayOpen) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !dayPanel.current?.contains(target)) {
        setDayOpen(null);
      }
    };
    // A fixed panel anchored to a cell would drift; scrolling closes it.
    const onViewportChange = () => setDayOpen(null);
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("scroll", onViewportChange, true);
    window.addEventListener("resize", onViewportChange);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("scroll", onViewportChange, true);
      window.removeEventListener("resize", onViewportChange);
    };
  }, [dayOpen]);
  const dateProperty = view.date_property
    ? properties.find((property) => property.key === view.date_property)
    : undefined;

  if (!dateProperty) {
    return (
      <div className="mt-6 grid max-w-[52ch] gap-3 border-t rule pt-4">
        <p className="text-muted">
          This calendar needs a date property to place records on a day.
        </p>
        {canEdit ? (
          <Button
            type="button"
            variant="ghost"
            className="min-h-8 w-fit px-3 text-[12px] pointer-coarse:min-h-11"
            onClick={onOpenSettings}
          >
            Open view settings
          </Button>
        ) : (
          <p className="text-[13px] text-faint">
            Ask an editor to choose a date property in View settings.
          </p>
        )}
      </div>
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

      {dated === 0 ? (
        <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t rule pt-3">
          <p className="text-[13px] text-muted">
            No record in this view has a {dateProperty.name} yet, so the month is
            empty. Add a date in the table or choose another date property in view
            settings.
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
                "relative min-h-[6.5rem] border-r border-b rule p-1.5",
                cell.inMonth ? "" : "bg-surface/40",
              )}
            >
              <div className="flex items-baseline justify-between gap-1">
                <span
                  aria-current={isToday ? "date" : undefined}
                  className={cn(
                    "font-mono text-[11px] tnum",
                    cell.inMonth ? "text-muted" : "text-faint",
                    isToday ? "text-accent" : "",
                  )}
                  title={isToday ? "Today" : undefined}
                >
                  {Number(cell.date.slice(8, 10))}
                </span>
                {isToday ? (
                  <span className="hidden font-mono text-[11px] tracking-[0.08em] text-accent sm:inline">
                    TODAY
                  </span>
                ) : null}
              </div>
              <ul className="mt-1 grid gap-0.5">
                {bucket.slice(0, MAX_CHIPS).map((row) => (
                  <li key={row.id} className="group min-w-0">
                    <div className="flex min-w-0 items-center gap-0.5">
                      <Link
                        to={`/s/${spaceId}/o/${row.id}`}
                        title={row.title}
                        className="min-w-0 flex-1 truncate rounded-[3px] border-l border-line-strong px-1 py-0.5 text-[12px] text-ink transition-colors hover:bg-raised"
                        onClick={(event) => {
                          // A finger cannot aim at the actions inside a ~50 px
                          // chip, so a tap opens the day and its full rows.
                          if (!coarsePointer()) {
                            return;
                          }
                          event.preventDefault();
                          openDay(cell.date, event.currentTarget);
                        }}
                      >
                        {row.title}
                      </Link>
                      <span className="opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 pointer-coarse:hidden">
                        <CardActions
                          spaceId={spaceId}
                          row={row}
                          canEdit={canEdit}
                          completing={completing}
                          pending={pendingRows.has(row.id)}
                          showComplete={
                            row.schedule !== undefined && row.schedule.status !== "done"
                          }
                          verb={verb}
                          onComplete={() => onComplete(row)}
                          onDuplicate={() => onDuplicate(row)}
                          onTrash={() => onTrash(row)}
                        />
                      </span>
                    </div>
                  </li>
                ))}
                {bucket.length > MAX_CHIPS ? (
                  <li>
                    <button
                      type="button"
                      className="px-1 font-mono text-[11px] text-faint hover:text-ink pointer-coarse:min-h-11"
                      onClick={(event) => openDay(cell.date, event.currentTarget)}
                    >
                      +{bucket.length - MAX_CHIPS} more
                    </button>
                  </li>
                ) : null}
              </ul>
            </div>
          );
        })}
      </div>

      {dayOpen
        ? createPortal(
            <div
              ref={dayPanel}
              role="dialog"
              aria-label={`Records on ${dayOpen.date}`}
              tabIndex={-1}
              className="fixed z-50 overflow-y-auto overscroll-contain rounded-field border border-line bg-surface p-2 text-[12px] focus:outline-none"
              style={{
                top: dayOpen.top,
                left: dayOpen.left,
                width: Math.min(DAY_PANEL_WIDTH, window.innerWidth - DAY_PANEL_MARGIN * 2),
                maxHeight: dayOpen.maxHeight,
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setDayOpen(null);
                }
              }}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="label">{dayOpen.date}</span>
                <button
                  type="button"
                  aria-label="Close day"
                  className="inline-flex h-7 w-7 items-center justify-center text-faint hover:text-ink pointer-coarse:h-11 pointer-coarse:w-11"
                  onClick={() => setDayOpen(null)}
                >
                  <X aria-hidden size={13} />
                </button>
              </div>
              <ul className="mt-1 grid gap-0.5">
                {(byDate.get(dayOpen.date) ?? []).map((row) => (
                  <li key={row.id} className="flex min-w-0 items-center gap-1">
                    <Link
                      to={`/s/${spaceId}/o/${row.id}`}
                      title={row.title}
                      className="min-w-0 flex-1 truncate px-1 py-1 hover:bg-raised pointer-coarse:min-h-11"
                      onClick={() => setDayOpen(null)}
                    >
                      {row.title}
                    </Link>
                    <CardActions
                      spaceId={spaceId}
                      row={row}
                      canEdit={canEdit}
                      completing={completing}
                      pending={pendingRows.has(row.id)}
                      showComplete={row.schedule !== undefined && row.schedule.status !== "done"}
                      verb={verb}
                      onComplete={() => onComplete(row)}
                      onDuplicate={() => onDuplicate(row)}
                      onTrash={() => onTrash(row)}
                    />
                  </li>
                ))}
              </ul>
            </div>,
            document.body,
          )
        : null}

      <p className="mt-2 text-[12px] text-faint">
        {undated === 0
          ? "Every record in this view has a date."
          : `${undated} ${undated === 1 ? "record has" : "records have"} no ${dateProperty.name}.`}
      </p>
    </div>
  );
}
