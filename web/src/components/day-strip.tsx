import { ChevronLeft, ChevronRight } from "lucide-react";
import { Link, useNavigate } from "react-router";

import { usePageShortcuts } from "@/components/page-shortcuts";
import { cn } from "@/lib/cn";
import { dayLabel } from "@/lib/daily";
import { useGlobalHotkeys, type ShortcutDescriptor } from "@/lib/hotkeys";
import { shiftDay } from "@/lib/timezone";

const step =
  "inline-flex min-h-9 items-center gap-1 rounded-full px-2 whitespace-nowrap text-muted transition-colors hover:bg-raised hover:text-ink pointer-coarse:min-h-11";

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
 * journal record share. Stepping is calendar-adjacent, not "next written": the
 * chevrons are always the previous and the next day, because that is what a
 * reader predicts. The middle slot names Today and is a link everywhere except
 * on Today itself, where it is the state it names.
 */
export function DayStrip({ spaceId, day, today }: DayStripProps) {
  const previous = shiftDay(day, -1);
  const next = shiftDay(day, 1);
  return (
    <nav aria-label="Day" className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-1">
      <Link
        to={`/s/${spaceId}/daily/${previous}`}
        aria-label={`Previous day, ${dayLabel(previous)}`}
        className={cn(step, "justify-self-start")}
      >
        <ChevronLeft aria-hidden size={15} />
        <time className="tnum" dateTime={previous}>
          {dayLabel(previous)}
        </time>
      </Link>
      {day === today ? (
        <span aria-current="date" className="label justify-self-center text-accent">
          Today
        </span>
      ) : (
        <Link to={`/s/${spaceId}/daily/${today}`} className={cn(step, "justify-self-center")}>
          Today
        </Link>
      )}
      <Link
        to={`/s/${spaceId}/daily/${next}`}
        aria-label={`Next day, ${dayLabel(next)}`}
        className={cn(step, "justify-self-end")}
      >
        <time className="tnum" dateTime={next}>
          {dayLabel(next)}
        </time>
        <ChevronRight aria-hidden size={15} />
      </Link>
    </nav>
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
