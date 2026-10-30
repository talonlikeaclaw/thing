import { useState } from "react";
import { Link, useParams } from "react-router";

import { useAgenda, useCompleteObject, useSpace, useTypeDetails, useTypes } from "@/api/queries";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { useHandedness } from "@/components/handedness";
import { ErrorState } from "@/components/error-state";
import { useRouteMeta } from "@/lib/route";
import type { AgendaRow } from "@/api/types";
import { Button } from "@/components/ui/controls";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { agendaBuckets } from "@/lib/agenda";
import { readError } from "@/lib/display";
import { completeLabel, duePhrase, dueTone } from "@/lib/schedule";

const HORIZONS = [7, 14, 30] as const;

/** `/s/:spaceId/agenda` — everything due, bucketed by the server's calendar day. */
export function AgendaPage() {
  const { spaceId } = useParams();
  const [horizon, setHorizon] = useState<number>(14);
  const space = useSpace(spaceId);
  const types = useTypes(spaceId);
  const agenda = useAgenda(spaceId, { days: horizon });
  // Scheduled types carry the completion verb on their definition; one cached
  // request per type, not one per row.
  const scheduledKeys = (types.data ?? [])
    .filter((type) => type.schedule)
    .map((type) => type.key);
  const typeDetails = useTypeDetails(spaceId ?? "", scheduledKeys);

  useRouteMeta("Schedule");

  if (types.isPending || agenda.isPending) {
    return <p className="text-[13px] text-muted">Reading the schedule…</p>;
  }

  const error = types.error ?? agenda.error;
  if (error) {
    return (
      <ErrorState
        error={error}
        subject="Schedule"
        onRetry={() => {
          void types.refetch();
          void agenda.refetch();
        }}
      />
    );
  }

  const detail = space.data;
  const typesData = types.data;
  const schedule = agenda.data;
  if (!detail || !typesData || !schedule) {
    return <p className="text-[13px] text-muted">Reading the schedule…</p>;
  }

  const scheduled = typesData.filter((type) => type.schedule);
  const { overdue, due_today, upcoming } = agendaBuckets(schedule.rows);
  const laterCount = schedule.later_count ?? 0;
  const canEdit = detail.role !== "viewer";
  const verbs: Record<string, string> = Object.fromEntries(
    typeDetails.details.map((def) => [def.key, completeLabel(def.schedule_labels)]),
  );

  return (
    <div className="settle">
      <Breadcrumbs
        items={[{ label: detail.name, to: `/s/${detail.id}` }, { label: "Schedule" }]}
      />
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <h1 className="text-[26px] font-medium tracking-[-0.02em]">Schedule</h1>
          <div role="group" aria-label="Horizon" className="flex items-center gap-1">
            {HORIZONS.map((days) => (
              <button
                key={days}
                type="button"
                aria-pressed={horizon === days}
                aria-label={`Show items due within ${days} days`}
                className={cn(
                  "label rounded-[3px] px-2 py-1 transition-colors hover:text-ink aria-pressed:bg-raised aria-pressed:text-ink pointer-coarse:min-h-11 pointer-coarse:min-w-11",
                  horizon === days ? "" : "text-faint",
                )}
                onClick={() => setHorizon(days)}
              >
                {days}d
              </button>
            ))}
          </div>
        </div>
        <p className="mt-2 font-mono text-[12px] text-faint">
          {schedule.timezone} · today {schedule.today}
        </p>

        {scheduled.length === 0 ? (
          <div className="mt-8 max-w-[52ch] border-t rule pt-4">
            <p className="text-muted">
              No type is scheduled — open Schema and turn on Schedule for a type.
            </p>
            <Link
              to={`/s/${detail.id}/schema`}
              className="mt-3 inline-flex min-h-10 w-fit items-center rounded-field border border-line px-4 text-sm text-ink transition-colors hover:border-line-strong pointer-coarse:min-h-11"
            >
              Open Schema
            </Link>
          </div>
        ) : (
          <>
            <Bucket
              title="Overdue"
              rows={overdue}
              empty="Nothing is overdue."
              spaceId={detail.id}
              canEdit={canEdit}
              verbs={verbs}
            />
            <Bucket
              title="Today"
              rows={due_today}
              empty="Nothing is due today."
              spaceId={detail.id}
              canEdit={canEdit}
              verbs={verbs}
            />
            <Bucket
              title={`Next ${horizon} days`}
              rows={upcoming}
              empty={`Nothing is due in the next ${horizon} days.`}
              spaceId={detail.id}
              canEdit={canEdit}
              verbs={verbs}
            />
            {laterCount > 0 ? (
              horizon < 30 ? (
                <button
                  type="button"
                  className="mt-4 font-mono text-[12px] text-faint underline decoration-line-strong underline-offset-2 transition-colors hover:text-ink pointer-coarse:min-h-11"
                  onClick={() => setHorizon(30)}
                >
                  {laterCount} more due later · show 30 days
                </button>
              ) : (
                <p className="mt-4 font-mono text-[12px] text-faint">
                  {laterCount} more due later
                </p>
              )
            ) : null}
          </>
        )}
      </div>
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
}: {
  title: string;
  rows: AgendaRow[];
  empty: string;
  spaceId: string;
  canEdit: boolean;
  verbs: Record<string, string>;
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
}: {
  spaceId: string;
  row: AgendaRow;
  canEdit: boolean;
  /** The type's completion verb, from `schedule_labels.complete`. */
  verb: string;
}) {
  const complete = useCompleteObject(spaceId);
  const toast = useToast();
  const { handedness } = useHandedness();
  const phrase = duePhrase(row.status, row.days_until_due);

  function onComplete() {
    complete.mutate(
      { id: row.id, rev: row.rev },
      {
        onSuccess: ({ object: saved, previous }) => {
          const nextDue = saved.schedule?.due_date;
          toast.showToast(
            nextDue ? `Next due ${nextDue} for “${saved.title}”.` : `“${saved.title}” marked done.`,
            "plain",
            {
              label: "Undo",
              onAction: () => {
                void complete
                  .undo(saved, previous)
                  .then(() => toast.showToast("Completion undone."))
                  .catch((error) =>
                    toast.showToast(`Could not undo — ${readError(error)}`, "danger"),
                  );
              },
            },
          );
        },
        onError: (error) => {
          toast.showToast(`Could not complete — ${readError(error)}`, "danger");
        },
      },
    );
  }

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
          disabled={complete.isPending}
          onClick={onComplete}
        >
          {/* A user-set verb can be a sentence; the row keeps its width. */}
          <span className="min-w-0 truncate">
            {complete.isPending ? "Saving…" : verb}
          </span>
        </Button>
      ) : null}
    </li>
  );
}
