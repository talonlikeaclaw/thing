import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";

import { useThumbHandedness } from "@/components/handedness";
import { cn } from "@/lib/cn";
import { formatDay } from "@/lib/display";
import { isCoarsePointer } from "@/lib/media";
import { addMonths, groupByDate, monthGrid, monthLabel, monthOf } from "@/lib/views";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DEFAULT_MAX_CHIPS = 3;
const DAY_PANEL_WIDTH = 272;
const DAY_PANEL_MARGIN = 8;

export interface MonthGridProps<T> {
  month: string;
  today: string;
  items: readonly T[];
  /** The item's `YYYY-MM-DD` day; an empty string leaves it out of the grid. */
  dateOf(item: T): string;
  keyOf(item: T): string;
  /** Where a chip and a day-panel row link to. */
  hrefOf(item: T): string;
  /** The link's `title`, for a chip too narrow to show its text. */
  titleOf?(item: T): string;
  /** The chip's content, not its link. */
  renderChip(item: T): ReactNode;
  /** A whole day-panel row, when the default link + chip is not enough. */
  renderRow?(item: T): ReactNode;
  maxChips?: number;
  /** Shown between the month controls and the grid when there are no items. */
  above?: ReactNode;
  /** Shown after the grid, inside the same block. */
  footer?: ReactNode;
  /** Extra classes on the card, when the caller must change its spacing. */
  className?: string;
  onMonthChange(month: string): void;
}

/**
 * The Monday-first month grid both calendars render: month controls, the
 * weekday row, day cells with a chip cap and `+N more`, and the portalled day
 * panel. It owns geometry, focus and the tap-versus-navigate rule; the caller
 * owns what an item and its actions look like.
 *
 * Handedness never moves anything here: the caller's actions anchor to the
 * thumb edge themselves, and the grid, chips and controls keep reading order.
 */
export function MonthGrid<T>({
  month,
  today,
  items,
  dateOf,
  keyOf,
  hrefOf,
  titleOf,
  renderChip,
  renderRow,
  maxChips = DEFAULT_MAX_CHIPS,
  above,
  footer,
  className,
  onMonthChange,
}: MonthGridProps<T>) {
  const handedness = useThumbHandedness();
  const [dayOpen, setDayOpen] = useState<{
    date: string;
    coarse: boolean;
    top: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);
  const dayPanel = useRef<HTMLDivElement | null>(null);
  const dayAnchor = useRef<HTMLElement | null>(null);
  const todayCell = useRef<HTMLDivElement | null>(null);
  const currentMonth = monthOf(today);

  /**
   * `nearest` leaves a visible month alone on a wide screen and brings the
   * current week above the phone bar otherwise; the bar's height is the cell's
   * `scroll-margin-bottom`. Motion is never animated here: the calendar should
   * open where the reader already is, not travel there.
   */
  function scrollToToday() {
    todayCell.current?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
      behavior: "auto",
    });
  }

  useLayoutEffect(() => {
    if (month === currentMonth) {
      scrollToToday();
    }
  }, [month, currentMonth]);

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
      coarse: isCoarsePointer(),
      top,
      left: Math.min(
        Math.max(DAY_PANEL_MARGIN, rect.left),
        window.innerWidth - width - DAY_PANEL_MARGIN,
      ),
      width,
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
    // A fixed panel anchored to a cell would drift, so scrolling the page
    // closes it; the panel's own list must still scroll.
    const onViewportChange = (event: Event) => {
      if (event.target instanceof Node && dayPanel.current?.contains(event.target)) {
        return;
      }
      setDayOpen(null);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("scroll", onViewportChange, true);
    window.addEventListener("resize", onViewportChange);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("scroll", onViewportChange, true);
      window.removeEventListener("resize", onViewportChange);
    };
  }, [dayOpen]);

  const byDate = groupByDate(items, dateOf);
  const weeks = monthGrid(Number(month.slice(0, 4)), Number(month.slice(5, 7)));
  const label = monthLabel(month);

  return (
    /*
     * One card shell for both calendars: the Schedule and the type page render
     * the same matte sheet, month controls and day panel, so the grid is never
     * a bare band on one page and a card on the other. Data stays opaque; only
     * the day panel and the block's own chrome float.
     */
    <div
      className={cn(
        "mt-6 rounded-[22px] border border-line bg-surface p-4 sm:p-5",
        className,
      )}
    >
      <div
        className={cn(
          "flex flex-wrap items-baseline justify-between gap-2",
          handedness === "left" && "flex-row-reverse",
        )}
      >
        <h2 className="text-heading font-medium">{label}</h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Previous month"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-raised hover:text-ink pointer-coarse:h-11 pointer-coarse:w-11"
            onClick={() => onMonthChange(addMonths(month, -1))}
          >
            <ChevronLeft aria-hidden size={15} />
          </button>
          <button
            type="button"
            className="label rounded-[8px] px-2 py-1 text-muted transition-colors hover:bg-raised hover:text-ink pointer-coarse:min-h-11 pointer-coarse:min-w-11"
            onClick={() => {
              if (month === currentMonth) {
                scrollToToday();
                return;
              }
              // The month effect scrolls once the current grid has rendered.
              onMonthChange(currentMonth);
            }}
          >
            Today
          </button>
          <button
            type="button"
            aria-label="Next month"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-raised hover:text-ink pointer-coarse:h-11 pointer-coarse:w-11"
            onClick={() => onMonthChange(addMonths(month, 1))}
          >
            <ChevronRight aria-hidden size={15} />
          </button>
        </div>
      </div>

      {items.length === 0 ? above : null}

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
              ref={isToday ? todayCell : undefined}
              className={cn(
                "calendar-day relative min-h-[6.5rem] border-r border-b rule p-1.5",
                cell.inMonth ? "" : "bg-surface/40",
              )}
            >
              <div className="flex items-baseline justify-between gap-1">
                {/*
                  The day number opens the day panel on every pointer, so the
                  calendar's complete and menu actions are reachable without a
                  hover-only affordance inside a chip. A finger gets the same
                  panel by tapping the chip.
                */}
                <button
                  type="button"
                  aria-current={isToday ? "date" : undefined}
                  aria-haspopup="dialog"
                  aria-label={`Records on ${formatDay(cell.date)}`}
                  className={cn(
                    "tnum -ml-1 inline-flex min-h-6 min-w-6 items-center justify-center rounded-[6px] px-1 font-mono text-[11px] transition-colors hover:bg-raised hover:text-ink pointer-coarse:min-h-11 pointer-coarse:min-w-11",
                    cell.inMonth ? "text-muted" : "text-faint",
                    isToday ? "text-accent" : "",
                  )}
                  title={isToday ? "Today" : undefined}
                  onClick={(event) => openDay(cell.date, event.currentTarget)}
                >
                  {Number(cell.date.slice(8, 10))}
                </button>
                {isToday ? (
                  <span className="hidden font-mono text-[11px] tracking-[0.08em] text-accent sm:inline">
                    TODAY
                  </span>
                ) : null}
              </div>
              <ul className="mt-1 grid gap-0.5">
                {bucket.slice(0, maxChips).map((item) => (
                  <li key={keyOf(item)} className="min-w-0">
                    <Link
                      to={hrefOf(item)}
                      title={titleOf?.(item)}
                      className="block min-w-0 truncate rounded-[6px] border-l border-line-strong px-1 py-0.5 text-[length:var(--text-small)] text-ink transition-colors hover:bg-raised pointer-coarse:flex pointer-coarse:min-h-11 pointer-coarse:items-center pointer-coarse:py-0"
                      onClick={(event) => {
                        // A finger cannot aim at a ~50 px chip, so a tap
                        // opens the day and its full rows.
                        if (!isCoarsePointer()) {
                          return;
                        }
                        event.preventDefault();
                        openDay(cell.date, event.currentTarget);
                      }}
                    >
                      {renderChip(item)}
                    </Link>
                  </li>
                ))}
                {bucket.length > maxChips ? (
                  <li>
                    <button
                      type="button"
                      className="px-1 font-mono text-[11px] text-faint hover:text-ink pointer-coarse:min-h-11"
                      onClick={(event) => openDay(cell.date, event.currentTarget)}
                    >
                      +{bucket.length - maxChips} more
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
              aria-label={`Records on ${formatDay(dayOpen.date)}`}
              tabIndex={-1}
              className={cn(
                "glass-strong fixed z-50 flex flex-col overflow-hidden rounded-card text-[12px] focus:outline-none",
                dayOpen.coarse
                  ? // Clear the phone dock: 12px inset + 68px bar + 8px gap.
                    "inset-x-2 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] rounded-t-field p-3"
                  : "rounded-field p-2",
              )}
              style={
                dayOpen.coarse
                  ? { maxHeight: "min(60vh, 60dvh)" }
                  : {
                      top: dayOpen.top,
                      left: dayOpen.left,
                      width: dayOpen.width,
                      maxHeight: dayOpen.maxHeight,
                    }
              }
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setDayOpen(null);
                }
              }}
            >
              <div
                className={cn(
                  "flex shrink-0 items-baseline justify-between gap-2",
                  handedness === "left" && "flex-row-reverse",
                )}
              >
                <span className="label">{formatDay(dayOpen.date)}</span>
                <button
                  type="button"
                  aria-label="Close day"
                  className="inline-flex h-7 w-7 items-center justify-center text-faint hover:text-ink pointer-coarse:h-11 pointer-coarse:w-11"
                  onClick={() => setDayOpen(null)}
                >
                  <X aria-hidden size={13} />
                </button>
              </div>
              {(byDate.get(dayOpen.date) ?? []).length === 0 ? (
                <p className="px-1 py-1 text-[12px] text-faint">No records on this day.</p>
              ) : null}
              <ul className="mt-1 grid min-h-0 gap-0.5 overflow-y-auto overscroll-contain">
                {(byDate.get(dayOpen.date) ?? []).map((item) => (
                  <li key={keyOf(item)} className="flex min-w-0 items-center gap-1">
                    {renderRow ? (
                      renderRow(item)
                    ) : (
                      <Link
                        to={hrefOf(item)}
                        title={titleOf?.(item)}
                        className="min-w-0 flex-1 truncate px-1 py-1 hover:bg-raised pointer-coarse:min-h-11"
                        onClick={() => setDayOpen(null)}
                      >
                        {renderChip(item)}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>,
            document.body,
          )
        : null}

      {footer}
    </div>
  );
}
