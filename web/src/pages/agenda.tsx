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
import { readError } from "@/lib/display";
import { completeLabel, duePhrase, dueTone } from "@/lib/schedule";

const HORIZONS = [7, 14, 30] as const;

/** `/s/:spaceId/agenda` — everything due, bucketed by the server's calendar day. */
export function AgendaPage() {
  const { spaceId } = useParams();
  const [horizon, setHorizon] = useState<number>(14);
  const space = useSpace(spaceId);
  const types = useTypes(spaceId);
  const agenda = useAgenda(spaceId, horizon);
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
                className={cn(
                  "label rounded-[3px] px-2 py-1 transition-colors hover:text-ink aria-pressed:bg-raised aria-pressed:text-ink pointer-coarse:min-h-11",
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
              rows={schedule.overdue}
              empty="Nothing is overdue."
              spaceId={detail.id}
              canEdit={canEdit}
              verbs={verbs}
            />
            <Bucket
              title="Today"
              rows={schedule.due_today}
              empty="Nothing is due today."
              spaceId={detail.id}
              canEdit={canEdit}
              verbs={verbs}
            />
            <Bucket
              title={`Next ${horizon} days`}
              rows={schedule.upcoming}
              empty={`Nothing is due in the next ${horizon} days.`}
              spaceId={detail.id}
              canEdit={canEdit}
              verbs={verbs}
            />
            {schedule.later_count > 0 ? (
              <p className="mt-4 font-mono text-[12px] text-faint">
                {schedule.later_count} more due later
              </p>
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
        onSuccess: ({ object }) => {
          const nextDue = object.schedule?.due_date;
          toast.showToast(nextDue ? `Next due ${nextDue}.` : "Marked done.");
        },
        onError: (error) => {
          toast.showToast(`Could not complete — ${readError(error)}`, "danger");
        },
      },
    );
  }

  return (
    <li className="grid gap-x-4 gap-y-2 border-b rule py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center pointer-coarse:min-h-11">
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <Link
            to={`/s/${spaceId}/o/${row.id}`}
            className="min-w-0 truncate text-[15px] font-medium hover:underline"
          >
            {row.title}
          </Link>
          <span className="font-mono text-[12px] text-faint">
            {row.type_icon ? (
              <span aria-hidden className="mr-1">
                {row.type_icon}
              </span>
            ) : null}
            {row.type_name} · {row.type}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-[12px]">
          <span className="tnum text-muted">{row.due_date}</span>
          {phrase ? <span className={cn("tnum", dueTone(row.status))}>{phrase}</span> : null}
          {row.recurrence ? <span className="text-faint">{row.recurrence}</span> : null}
        </div>
      </div>
      {canEdit ? (
        <Button
          type="button"
          variant="ghost"
          aria-label={`${verb} ${row.title}`}
          className={cn(
            "min-h-8 px-3 text-[13px] pointer-coarse:min-h-11",
            handedness === "left" ? "justify-self-start" : "justify-self-end",
          )}
          disabled={complete.isPending}
          onClick={onComplete}
        >
          {complete.isPending ? "Saving…" : verb}
        </Button>
      ) : null}
    </li>
  );
}
