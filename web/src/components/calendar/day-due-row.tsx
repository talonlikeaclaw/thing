import { Link } from "react-router";

import type { AgendaRow } from "@/api/types";
import { SnoozeMenu } from "@/components/agenda/snooze-menu";
import { ThumbRow } from "@/components/handedness";
import { Button } from "@/components/ui/controls";
import { cn } from "@/lib/cn";
import { duePhrase, dueTone } from "@/lib/schedule";

/**
 * One outstanding scheduled row inside a calendar: the month's day panel and
 * a week's day column show the same anatomy — title, its type and due phrase,
 * then the completion verb and the snooze menu for an editor. The actions sit
 * on the thumb edge through `ThumbRow`, as they do on the Schedule.
 *
 * The row is an `<li>` in the caller's `DayWork` group, never a bare block, so
 * a day's work reads as one layer under the day's note.
 */
export function DayDueRow({
  spaceId,
  row,
  canEdit,
  verb,
  pending,
  onComplete,
  onSnooze,
  className,
}: {
  spaceId: string;
  row: AgendaRow;
  canEdit: boolean;
  /** The type's completion verb, falling back to Complete. */
  verb: string;
  pending: boolean;
  onComplete: (row: AgendaRow) => void;
  onSnooze: (row: AgendaRow, days: number) => void;
  className?: string;
}) {
  const phrase = duePhrase(row.status, row.days_until_due);
  return (
    <li className={cn("min-w-0 rounded-[10px] p-1", className)}>
      <Link
        to={`/s/${spaceId}/o/${row.id}`}
        title={row.title}
        className="block min-w-0 rounded-[8px] px-1 py-1 transition-colors hover:bg-surface/70 pointer-coarse:min-h-11"
      >
        <span className="flex min-w-0 items-baseline gap-1.5">
          {row.type_icon ? (
            <span aria-hidden className="shrink-0">
              {row.type_icon}
            </span>
          ) : null}
          <span className="min-w-0 truncate text-[13px] text-ink">{row.title}</span>
        </span>
        <span className="mt-0.5 flex flex-wrap items-baseline gap-x-2 font-mono text-[11px]">
          <span className="text-faint">{row.type_name || row.type}</span>
          {phrase ? <span className={cn("tnum", dueTone(row.status))}>{phrase}</span> : null}
        </span>
      </Link>
      {canEdit ? (
        <ThumbRow className="mt-0.5 items-center gap-1 px-1">
          <SnoozeMenu
            title={row.title}
            disabled={pending}
            onSnooze={(days) => onSnooze(row, days)}
          />
          <Button
            type="button"
            variant="ghost"
            aria-label={`${verb} ${row.title}`}
            title={verb}
            className="min-h-8 min-w-0 flex-1 rounded-full bg-accent-wash px-2 text-[13px] text-accent-on-wash hover:bg-[color-mix(in_srgb,var(--color-accent)_20%,transparent)] hover:text-accent-on-wash pointer-coarse:min-h-11"
            disabled={pending}
            onClick={() => onComplete(row)}
          >
            <span className="min-w-0 truncate">{pending ? "Saving…" : verb}</span>
          </Button>
        </ThumbRow>
      ) : null}
    </li>
  );
}
