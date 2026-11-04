import { Link } from "react-router";

import type { AgendaRow } from "@/api/types";
import { SnoozeMenu } from "@/components/agenda/snooze-menu";
import { AGENDA_SEGMENT, AGENDA_TOOLBAR } from "@/components/agenda/toolbar";
import { ClearFilterButton } from "@/components/agenda/type-filter";
import { ThumbRow, useHandedness } from "@/components/handedness";
import { Button } from "@/components/ui/controls";
import { agendaBuckets, AGENDA_HORIZONS, type AgendaHorizon } from "@/lib/agenda";
import { cn } from "@/lib/cn";
import { formatDay } from "@/lib/display";
import { duePhrase, dueTone } from "@/lib/schedule";

/** The List's 7/14/30-day switch, which the page places in its toolbar. */
export function AgendaHorizons({
  horizon,
  onChange,
  stretch = false,
}: {
  horizon: AgendaHorizon;
  onChange: (horizon: AgendaHorizon) => void;
  /** A phone gives each segment an equal share of the full-width toolbar. */
  stretch?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label="Horizon"
      className={cn(AGENDA_TOOLBAR, stretch && "w-full flex-1")}
    >
      {AGENDA_HORIZONS.map((days) => (
        <button
          key={days}
          type="button"
          aria-pressed={horizon === days}
          aria-label={`Show items due within ${days} days`}
          className={cn(AGENDA_SEGMENT, stretch && "flex-1")}
          onClick={() => onChange(days)}
        >
          {days}d
        </button>
      ))}
    </div>
  );
}

/** The List body: the server's rows bucketed by status, with the later count. */
export function AgendaList({
  rows,
  horizon,
  laterCount,
  onHorizonChange,
  spaceId,
  canEdit,
  verbs,
  pendingId,
  onComplete,
  onSnooze,
  filterLabel,
  onClearFilter,
}: {
  rows: AgendaRow[];
  horizon: AgendaHorizon;
  laterCount: number;
  onHorizonChange: (horizon: AgendaHorizon) => void;
  spaceId: string;
  canEdit: boolean;
  /** The type's completion verb, by type key. */
  verbs: Record<string, string>;
  /** The row whose completion or snooze is in flight, if any. */
  pendingId: string | null;
  onComplete: (row: AgendaRow) => void;
  onSnooze: (row: AgendaRow, days: number) => void;
  /** The active type names, or empty when every type is showing. */
  filterLabel?: string;
  onClearFilter?: () => void;
}) {
  const { overdue, due_today, upcoming } = agendaBuckets(rows);
  // A clear schedule is one calm sentence, not three ruled headings counting
  // zeroes. The buckets return as soon as anything is due.
  const clear =
    overdue.length === 0 && due_today.length === 0 && upcoming.length === 0;
  return (
    <div className="mt-6 grid gap-4">
      {filterLabel && rows.length === 0 ? (
        <div className="max-w-[52ch] rounded-[22px] border border-line bg-surface p-4 sm:p-5">
          <p className="text-[13px] text-muted">
            No {filterLabel} work in the next {horizon} days.
          </p>
          {onClearFilter ? <ClearFilterButton onClick={onClearFilter} /> : null}
        </div>
      ) : clear ? (
        <div className="rounded-[22px] border border-line bg-surface p-4 sm:p-5">
          <p className="text-[15px] text-ink">
            Nothing scheduled in the next {horizon} days.
          </p>
          <p className="mt-1 text-[13px] text-muted">
            {laterCount > 0
              ? `${laterCount} ${laterCount === 1 ? "record is" : "records are"} due later.`
              : "Snooze a record or set a due date to see it here."}
          </p>
        </div>
      ) : (
        <>
          <Bucket
            title="Overdue"
            rows={overdue}
            empty="Nothing is overdue."
            spaceId={spaceId}
            canEdit={canEdit}
            verbs={verbs}
            pendingId={pendingId}
            onComplete={onComplete}
            onSnooze={onSnooze}
          />
          <Bucket
            title="Today"
            rows={due_today}
            empty="Nothing is due today."
            spaceId={spaceId}
            canEdit={canEdit}
            verbs={verbs}
            pendingId={pendingId}
            onComplete={onComplete}
            onSnooze={onSnooze}
          />
          <Bucket
            title={`Next ${horizon} days`}
            rows={upcoming}
            empty={`Nothing is due in the next ${horizon} days.`}
            spaceId={spaceId}
            canEdit={canEdit}
            verbs={verbs}
            pendingId={pendingId}
            onComplete={onComplete}
            onSnooze={onSnooze}
          />
        </>
      )}
      {laterCount > 0 ? (
        horizon < 30 ? (
          <button
            type="button"
            className="w-fit font-mono text-[12px] text-faint underline decoration-line-strong underline-offset-2 transition-colors hover:text-ink pointer-coarse:min-h-11"
            onClick={() => onHorizonChange(30)}
          >
            {laterCount} more due later · show 30 days
          </button>
        ) : (
          <p className="font-mono text-[12px] text-faint">{laterCount} more due later</p>
        )
      ) : null}
    </div>
  );
}

function Bucket({
  title,
  rows,
  empty,
  spaceId,
  canEdit,
  verbs,
  pendingId,
  onComplete,
  onSnooze,
}: {
  title: string;
  rows: AgendaRow[];
  empty: string;
  spaceId: string;
  canEdit: boolean;
  verbs: Record<string, string>;
  pendingId: string | null;
  onComplete: (row: AgendaRow) => void;
  onSnooze: (row: AgendaRow, days: number) => void;
}) {
  return (
    <section
      aria-label={title}
      className="rounded-[22px] border border-line bg-surface px-4 py-3 sm:px-5 sm:py-4"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[17px] font-medium">{title}</h2>
        <span className="label tnum">{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <p className="pt-2 text-[13px] text-muted">{empty}</p>
      ) : (
        <ul>
          {rows.map((row) => (
            <AgendaEntry
              key={row.id}
              spaceId={spaceId}
              row={row}
              canEdit={canEdit}
              verb={verbs[row.type] ?? "Complete"}
              pendingId={pendingId}
              onComplete={onComplete}
              onSnooze={onSnooze}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function AgendaEntry({
  spaceId,
  row,
  canEdit,
  verb,
  pendingId,
  onComplete,
  onSnooze,
}: {
  spaceId: string;
  row: AgendaRow;
  canEdit: boolean;
  /** The type's completion verb, from `schedule_labels.complete`. */
  verb: string;
  /** The row whose completion or snooze is in flight, if any. */
  pendingId: string | null;
  onComplete: (row: AgendaRow) => void;
  onSnooze: (row: AgendaRow, days: number) => void;
}) {
  const { handedness } = useHandedness();
  const phrase = duePhrase(row.status, row.days_until_due);
  const leftHanded = handedness === "left";

  return (
    <li
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_fit-content(12rem)] items-center gap-x-4 border-b rule last:border-b-0 pointer-coarse:min-h-11",
        leftHanded
          ? "max-sm:grid-cols-[fit-content(45%)_minmax(0,1fr)]"
          : "max-sm:grid-cols-[minmax(0,1fr)_fit-content(45%)]",
      )}
    >
      {/* The content block is the link; the verb stays its own target beside it. */}
      <Link
        to={`/s/${spaceId}/o/${row.id}`}
        className={cn(
          "col-start-1 row-start-1 group block min-w-0 py-3 text-ink",
          leftHanded && "max-sm:col-start-2",
        )}
      >
        <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <span className="min-w-0 truncate text-[15px] font-medium group-hover:underline">
            {row.title}
          </span>
          <span className="font-mono text-[12px] text-faint">
            {row.type_icon ? (
              <span aria-hidden className="mr-1">
                {row.type_icon}
              </span>
            ) : null}
            {row.type_name || row.type}
          </span>
        </span>
        <span className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-[12px]">
          <span className="tnum text-muted">{formatDay(row.due_date)}</span>
          {phrase ? <span className={cn("tnum", dueTone(row.status))}>{phrase}</span> : null}
          {row.recurrence ? <span className="text-faint">{row.recurrence}</span> : null}
        </span>
      </Link>
      {canEdit ? (
        // The action cell keeps the grid's handedness flip; inside it the
        // snooze (secondary) precedes the verb (primary), and `ThumbRow` moves
        // the primary to the thumb edge in left mode — one reversal, once.
        <div
          className={cn(
            "col-start-2 row-start-1 flex min-w-0 items-center",
            leftHanded && "max-sm:col-start-1",
          )}
        >
          <ThumbRow className="min-w-0 items-center gap-0.5">
            <SnoozeMenu
              title={row.title}
              disabled={pendingId === row.id}
              onSnooze={(days) => onSnooze(row, days)}
            />
            <Button
              type="button"
              variant="ghost"
              aria-label={`${verb} ${row.title}`}
              title={verb}
              className="min-h-8 min-w-0 rounded-full bg-accent-wash px-3 text-[13px] text-accent-on-wash hover:bg-[color-mix(in_srgb,var(--color-accent)_20%,transparent)] hover:text-accent-on-wash pointer-coarse:min-h-11"
              disabled={pendingId === row.id}
              onClick={() => onComplete(row)}
            >
              {/* A user-set verb can be a sentence; the row keeps its width. */}
              <span className="min-w-0 truncate">
                {pendingId === row.id ? "Saving…" : verb}
              </span>
            </Button>
          </ThumbRow>
        </div>
      ) : null}
    </li>
  );
}
