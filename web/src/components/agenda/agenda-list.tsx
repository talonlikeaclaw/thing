import { Link } from "react-router";

import type { AgendaRow } from "@/api/types";
import { useHandedness } from "@/components/handedness";
import { Button } from "@/components/ui/controls";
import { agendaBuckets, AGENDA_HORIZONS, type AgendaHorizon } from "@/lib/agenda";
import { cn } from "@/lib/cn";
import { duePhrase, dueTone } from "@/lib/schedule";

/** The List's 7/14/30-day switch, which the page places in its header. */
export function AgendaHorizons({
  horizon,
  onChange,
}: {
  horizon: AgendaHorizon;
  onChange: (horizon: AgendaHorizon) => void;
}) {
  return (
    <div role="group" aria-label="Horizon" className="flex items-center gap-1">
      {AGENDA_HORIZONS.map((days) => (
        <button
          key={days}
          type="button"
          aria-pressed={horizon === days}
          aria-label={`Show items due within ${days} days`}
          className={cn(
            "label rounded-[3px] px-2 py-1 transition-colors hover:text-ink aria-pressed:bg-raised aria-pressed:text-ink pointer-coarse:min-h-11 pointer-coarse:min-w-11",
            horizon === days ? "" : "text-faint",
          )}
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
}: {
  rows: AgendaRow[];
  horizon: AgendaHorizon;
  laterCount: number;
  onHorizonChange: (horizon: AgendaHorizon) => void;
  spaceId: string;
  canEdit: boolean;
  /** The type's completion verb, by type key. */
  verbs: Record<string, string>;
  /** The row whose completion is in flight, if any. */
  pendingId: string | null;
  onComplete: (row: AgendaRow) => void;
}) {
  const { overdue, due_today, upcoming } = agendaBuckets(rows);
  return (
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
      />
      {laterCount > 0 ? (
        horizon < 30 ? (
          <button
            type="button"
            className="mt-4 font-mono text-[12px] text-faint underline decoration-line-strong underline-offset-2 transition-colors hover:text-ink pointer-coarse:min-h-11"
            onClick={() => onHorizonChange(30)}
          >
            {laterCount} more due later · show 30 days
          </button>
        ) : (
          <p className="mt-4 font-mono text-[12px] text-faint">{laterCount} more due later</p>
        )
      ) : null}
    </>
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
}: {
  title: string;
  rows: AgendaRow[];
  empty: string;
  spaceId: string;
  canEdit: boolean;
  verbs: Record<string, string>;
  pendingId: string | null;
  onComplete: (row: AgendaRow) => void;
}) {
  return (
    <section aria-label={title} className="mt-8">
      <div className="flex items-baseline justify-between border-b rule pb-2">
        <h2 className="text-[17px] font-medium">{title}</h2>
        <span className="label tnum">{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <p className="py-3 text-[13px] text-muted">{empty}</p>
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
}: {
  spaceId: string;
  row: AgendaRow;
  canEdit: boolean;
  /** The type's completion verb, from `schedule_labels.complete`. */
  verb: string;
  /** The row whose completion is in flight, if any. */
  pendingId: string | null;
  onComplete: (row: AgendaRow) => void;
}) {
  const { handedness } = useHandedness();
  const phrase = duePhrase(row.status, row.days_until_due);
  const leftHanded = handedness === "left";

  return (
    <li
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_fit-content(12rem)] items-center gap-x-4 border-b rule pointer-coarse:min-h-11",
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
          <span className="tnum text-muted">{row.due_date}</span>
          {phrase ? <span className={cn("tnum", dueTone(row.status))}>{phrase}</span> : null}
          {row.recurrence ? <span className="text-faint">{row.recurrence}</span> : null}
        </span>
      </Link>
      {canEdit ? (
        <Button
          type="button"
          variant="ghost"
          aria-label={`${verb} ${row.title}`}
          title={verb}
          className={cn(
            "row-start-1 min-h-8 min-w-0 px-3 text-[13px] pointer-coarse:min-h-11",
            leftHanded && "max-sm:col-start-1",
          )}
          disabled={pendingId === row.id}
          onClick={() => onComplete(row)}
        >
          {/* A user-set verb can be a sentence; the row keeps its width. */}
          <span className="min-w-0 truncate">
            {pendingId === row.id ? "Saving…" : verb}
          </span>
        </Button>
      ) : null}
    </li>
  );
}
