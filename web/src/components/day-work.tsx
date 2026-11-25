import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/** The heading a due group prints: what the day still owes, and how much. */
export function DayWorkHeading({
  label,
  count,
  className,
}: {
  label: string;
  count: number;
  /** The group's padding, when the caller frames it. */
  className?: string;
}) {
  return (
    <div className={cn("flex items-baseline justify-between gap-2", className)}>
      <span className="label text-muted">{label}</span>
      <span className="tnum font-mono text-[11px] text-faint">{count}</span>
    </div>
  );
}

/**
 * One day's outstanding rows as a single group, so the dated surfaces read in
 * layers — the day's note, then the work the day still owes — instead of a run
 * of loose rows between a note and the next day.
 *
 * `framed` draws the recessed tray a calendar cell needs. The record's day
 * margin is already a divided column, so it takes the heading and the rows
 * alone and never a second card inside the sheet.
 */
export function DayWork({
  label,
  count,
  framed = true,
  className,
  children,
}: {
  /** `Due` in a calendar column, `Due today` or `Due that day` elsewhere. */
  label: string;
  count: number;
  framed?: boolean;
  className?: string;
  /** The rows, each an `<li>`. */
  children: ReactNode;
}) {
  return (
    <section
      aria-label={label}
      className={cn(
        "min-w-0",
        framed && "rounded-[12px] border border-line bg-inset/40 p-1",
        className,
      )}
    >
      <DayWorkHeading
        label={label}
        count={count}
        className={framed ? "px-2 pt-0.5 pb-1" : "pb-1"}
      />
      <ul className="grid">{children}</ul>
    </section>
  );
}
