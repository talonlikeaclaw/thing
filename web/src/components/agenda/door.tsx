import { Link } from "react-router";

import { AGENDA_SEGMENT, AGENDA_TOOLBAR } from "@/components/agenda/toolbar";
import { cn } from "@/lib/cn";
import { keepDatedScroll } from "@/lib/kept-scroll";

/**
 * The one door between the Schedule and the Calendar, in the same pill frame
 * as the filter beside it. On a phone it shares the row with that filter, so
 * the two read as one split control rather than a lone pill drifting at the
 * edge.
 *
 * `preventScrollReset` is the point: the two are one place read two ways, so
 * switching keeps the reader's position and the header — the door included —
 * never jumps to the top under the thumb.
 */
export function AgendaDoor({
  to,
  label,
  stretch = false,
}: {
  to: string;
  /** The destination's name, which is also the link's text. */
  label: string;
  /** Fill the row's share, matching a stretched filter. */
  stretch?: boolean;
}) {
  return (
    <span className={cn(AGENDA_TOOLBAR, "shrink-0", stretch && "flex-1")}>
      <Link
        to={to}
        preventScrollReset
        className={cn(AGENDA_SEGMENT, "flex-1")}
        onClick={keepDatedScroll}
      >
        {label}
      </Link>
    </span>
  );
}
