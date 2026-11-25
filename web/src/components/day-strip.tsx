import { ChevronLeft, ChevronRight } from "lucide-react";
import { Link, useNavigate } from "react-router";

import { usePageShortcuts } from "@/components/page-shortcuts";
import { cn } from "@/lib/cn";
import { dayLabel, dayNumberLabel } from "@/lib/daily";
import { useGlobalHotkeys, type ShortcutDescriptor } from "@/lib/hotkeys";
import { shiftDay } from "@/lib/timezone";

const step =
  "inline-flex min-h-9 max-w-full min-w-0 items-center gap-1 rounded-full border border-line-interactive/70 bg-raised/40 px-2 text-[13px] whitespace-nowrap text-muted transition-colors hover:border-line-strong hover:bg-raised hover:text-ink pointer-coarse:min-h-11 sm:px-3";
/** The middle slot when the day is today: the chip's own pressed state. */
const todayChip = "border-accent/40 bg-accent-wash text-accent-on-wash";

/** The three keys a journal answers; the `?` sheet reads this list. */
export const JOURNAL_SHORTCUTS: ShortcutDescriptor[] = [
  { id: "journal-previous", key: "[", keys: "[", label: "Previous day", scope: "Journal" },
  { id: "journal-next", key: "]", keys: "]", label: "Next day", scope: "Journal" },
  { id: "journal-today", key: "t", keys: "T", label: "Today's note", scope: "Journal" },
];

const NO_SHORTCUTS: ShortcutDescriptor[] = [];

interface DayStripProps {
  spaceId: string;
  /** The day on screen, as the journal titles it: `YYYY-MM-DD`. */
  day: string;
  /** The space's civil today, so the middle slot knows when it is one. */
  today: string;
}

/**
 * `‹ Sun 22 Nov · Today · Mon 24 Nov ›` — the day rail a journal day and a
 * journal record share, and the page's own glass header.
 *
 * Stepping is calendar-adjacent, not "next written": the chevrons are always
 * the previous and the next day, because that is what a reader predicts. The
 * middle slot names Today and is a link everywhere except on Today itself,
 * where it is the state it names. The month under the rail is the header's
 * closing line, as the Schedule closes on its timezone and the Calendar on its
 * count.
 *
 * The header is not sticky: a record's property column sticks under the shell
 * header, and a second sticky layer would cover it. The day page is one sheet,
 * so there is nothing to scroll under the chrome.
 */
export function DayStrip({ spaceId, day, today }: DayStripProps) {
  const previous = shiftDay(day, -1);
  const next = shiftDay(day, 1);
  return (
    <header className="glass mb-4 rounded-[22px] px-4 py-3 sm:px-5 sm:py-4">
      <nav aria-label="Day" className="grid grid-cols-[1fr_auto_1fr] items-center gap-1">
        <Link
          to={`/s/${spaceId}/daily/${previous}`}
          aria-label={`Previous day, ${dayLabel(previous)}`}
          className={cn(step, "justify-self-start")}
        >
          <ChevronLeft aria-hidden size={15} className="shrink-0" />
          <time className="truncate tnum" dateTime={previous}>
            <span className="sm:hidden">{dayNumberLabel(previous)}</span>
            <span className="max-sm:hidden">{dayLabel(previous)}</span>
          </time>
        </Link>
        {day === today ? (
          <span aria-current="date" className={cn(step, todayChip, "justify-self-center")}>
            Today
          </span>
        ) : (
          <Link
            to={`/s/${spaceId}/daily/${today}`}
            className={cn(step, "justify-self-center")}
          >
            Today
          </Link>
        )}
        <Link
          to={`/s/${spaceId}/daily/${next}`}
          aria-label={`Next day, ${dayLabel(next)}`}
          className={cn(step, "justify-self-end")}
        >
          <time className="truncate tnum" dateTime={next}>
            <span className="sm:hidden">{dayNumberLabel(next)}</span>
            <span className="max-sm:hidden">{dayLabel(next)}</span>
          </time>
          <ChevronRight aria-hidden size={15} className="shrink-0" />
        </Link>
      </nav>
    </header>
  );
}

/**
 * The rail's keys, for the surface that is showing a day. `[` and `]` step to
 * the adjacent day and `t` returns to today; all three are reads, so none of
 * them writes a note. They stay out of the way while a field or an overlay has
 * the keyboard, which is why the day page's own notes never eat a typed `t`.
 */
export function useDayHotkeys({
  spaceId,
  day,
  today,
}: {
  spaceId: string;
  /** The day on screen, or `null` when the surface is not a journal day. */
  day: string | null;
  /** The space's civil today; empty until the space has loaded. */
  today: string;
}) {
  const navigate = useNavigate();
  const current = day ?? "";
  const enabled = day !== null && today !== "";

  usePageShortcuts(enabled ? JOURNAL_SHORTCUTS : NO_SHORTCUTS);
  useGlobalHotkeys(
    [
      {
        key: "[",
        run: () => {
          navigate(`/s/${spaceId}/daily/${shiftDay(current, -1)}`);
        },
      },
      {
        key: "]",
        run: () => {
          navigate(`/s/${spaceId}/daily/${shiftDay(current, 1)}`);
        },
      },
      {
        key: "t",
        run: () => {
          navigate(`/s/${spaceId}/daily/${today}`);
        },
      },
    ],
    enabled,
  );
}
