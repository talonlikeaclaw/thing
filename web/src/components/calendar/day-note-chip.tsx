import { ChevronRight, FileText, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";

import type { ObjectSummary } from "@/api/types";
import { cn } from "@/lib/cn";

/**
 * A day's journal note, drawn as the control it is: a lit edge on a raised
 * fill, the record's own icon or a document glyph, the word `Note`, and a
 * chevron at the trailing edge. The week's day column and the month's day
 * panel share it, so a note is one anatomy wherever a day lists it.
 */
export function DayNoteChip({ spaceId, note }: { spaceId: string; note: ObjectSummary }) {
  return (
    <Link
      to={`/s/${spaceId}/o/${note.id}`}
      title={note.title}
      className="group flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-[10px] border border-line-interactive/70 bg-raised/40 px-2 py-1.5 text-[13px] text-ink transition-colors hover:border-line-strong hover:bg-raised pointer-coarse:min-h-11"
    >
      {note.icon ? (
        <span aria-hidden className="shrink-0">
          {note.icon}
        </span>
      ) : (
        <FileText aria-hidden size={13} className="shrink-0 text-faint" />
      )}
      <span className="min-w-0 truncate">Note</span>
      <ChevronRight
        aria-hidden
        size={13}
        className="ml-auto shrink-0 text-faint transition-colors group-hover:text-ink"
      />
      <span className="sr-only">: {note.title}</span>
    </Link>
  );
}

/**
 * The slot the note chip would fill, empty: a dashed row of the same width,
 * radius and padding, so a day without a note offers the write action where
 * the note would sit rather than as a small pill inside it.
 */
export function DayWriteNote({
  spaceId,
  day,
  className,
  children,
}: {
  spaceId: string;
  /** The day the write page opens, `YYYY-MM-DD`. */
  day: string;
  className?: string;
  /** The label; a week's seven columns pass a short one behind `xl`. */
  children: ReactNode;
}) {
  return (
    <Link
      to={`/s/${spaceId}/daily/${day}`}
      aria-label="Write this day's note"
      className={cn(
        "flex min-h-10 w-full min-w-0 items-center gap-1.5 rounded-[10px] border border-dashed border-line-interactive/70 px-2 py-1.5 text-[12px] text-accent transition-colors hover:border-line-strong hover:bg-raised/60 pointer-coarse:min-h-11",
        className,
      )}
    >
      <Plus aria-hidden size={12} className="shrink-0" />
      {children}
    </Link>
  );
}

