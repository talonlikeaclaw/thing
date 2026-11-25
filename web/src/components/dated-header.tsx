import type { ReactNode } from "react";

import { ThumbRow } from "@/components/handedness";
import { cn } from "@/lib/cn";
import { useCompactWidth } from "@/lib/media";

/**
 * The one header the Schedule and the Calendar share, and the same glass card
 * the Journal's day rail wears.
 *
 * Its controls wrap by rule rather than by accident: a phone gives the leading
 * switch the whole row and everything else the row below it, flush with the
 * same leading edge, so no pill is left hanging at a ragged right margin. A
 * fine pointer keeps the set on one line, the switch leading and the rest at
 * the trailing edge. The closing line is the page's own fact — the range's
 * count, or the space's zone and today.
 */
export function DatedHeader({
  title,
  controls,
  trailing,
  line,
  settling = false,
}: {
  title: string;
  /** The leading switch: the range, the month or the week. */
  controls: ReactNode;
  /**
   * The filters and the door to the other reading, as a list: `ThumbRow`
   * reverses a list for a left-handed phone, and it cannot reorder a node it
   * only sees as one opaque child.
   */
  trailing?: ReactNode[];
  /** The header's closing mono line. */
  line: ReactNode;
  /**
   * The line is showing a read in progress rather than the page's own fact.
   * It is not announced then: the card states the read, and the placeholder
   * would only repeat the space's zone back to the reader.
   */
  settling?: boolean;
}) {
  const compact = useCompactWidth();
  return (
    <header className="glass rounded-[22px] px-4 py-3 sm:px-5 sm:py-4 lg:sticky lg:top-[calc(var(--shell-header-h)+0.5rem)] lg:z-20">
      <h1 className="display text-display">{title}</h1>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        {controls}
        {trailing ? (
          /*
            The filter and the door are the row's thumb-zone controls: a
            left-handed phone reverses their DOM order through `ThumbRow`, so
            paint, Tab and the screen reader agree, and the door sits at the
            thumb edge. A phone gives the pair the whole row.
          */
          <ThumbRow className={cn("flex-wrap items-center gap-2", compact && "w-full")}>
            {trailing}
          </ThumbRow>
        ) : null}
      </div>
      <p
        className="mt-2.5 flex flex-wrap items-baseline gap-x-2 gap-y-1 font-mono text-[12px] text-faint"
        aria-live={settling ? undefined : "polite"}
      >
        {line}
      </p>
    </header>
  );
}
