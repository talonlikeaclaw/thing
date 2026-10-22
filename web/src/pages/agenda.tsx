import { useState } from "react";
import { Link, useParams } from "react-router";

import { useAgenda, useCompleteObject, useSpace, useTypes } from "@/api/queries";
import type { AgendaRow } from "@/api/types";
import { SpaceNav } from "@/components/space-nav";
import { Button, FormError } from "@/components/ui/controls";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { readError } from "@/lib/display";
import { duePhrase, dueTone } from "@/lib/schedule";
import { useSpaceEvents } from "@/lib/use-space-events";

const HORIZONS = [7, 14, 30] as const;

/** `/s/:spaceId/agenda` — everything due, bucketed by the server's calendar day. */
export function AgendaPage() {
  const { spaceId } = useParams();
  const [horizon, setHorizon] = useState<number>(14);
  const space = useSpace(spaceId);
  const types = useTypes(spaceId);
  const agenda = useAgenda(spaceId, horizon);

  useSpaceEvents(spaceId);

  if (space.isPending || types.isPending || agenda.isPending) {
    return <p className="text-[13px] text-muted">Reading the schedule…</p>;
  }

  const error = space.error ?? types.error ?? agenda.error;
  if (error) {
    return (
      <div className="grid max-w-[52ch] gap-3">
        <FormError message={readError(error)} />
        <Button
          variant="ghost"
          className="w-fit"
          onClick={() => {
            void space.refetch();
            void types.refetch();
            void agenda.refetch();
          }}
        >
          Retry
        </Button>
      </div>
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

  return (
    <div className="settle grid gap-8 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10">
      <SpaceNav
        spaceId={detail.id}
        types={typesData}
        selected="schedule"
        role={detail.role}
      />
      <div className="min-w-0">
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
        <p className="mt-2 font-mono text-[11px] text-faint">
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
            />
            <Bucket
              title="Today"
              rows={schedule.due_today}
              empty="Nothing is due today."
              spaceId={detail.id}
              canEdit={canEdit}
            />
            <Bucket
              title={`Next ${horizon} days`}
              rows={schedule.upcoming}
              empty={`Nothing is due in the next ${horizon} days.`}
              spaceId={detail.id}
              canEdit={canEdit}
            />
            {schedule.later_count > 0 ? (
              <p className="mt-4 font-mono text-[11px] text-faint">
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
}: {
  title: string;
  rows: AgendaRow[];
  empty: string;
  spaceId: string;
  canEdit: boolean;
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
            <AgendaEntry key={row.id} spaceId={spaceId} row={row} canEdit={canEdit} />
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
}: {
  spaceId: string;
  row: AgendaRow;
  canEdit: boolean;
}) {
  const complete = useCompleteObject(spaceId);
  const toast = useToast();
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
          <span className="font-mono text-[10px] text-faint">
            {row.type_icon ? (
              <span aria-hidden className="mr-1">
                {row.type_icon}
              </span>
            ) : null}
            {row.type_name} · {row.type}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-[11px]">
          <span className="tnum text-muted">{row.due_date}</span>
          {phrase ? <span className={cn("tnum", dueTone(row.status))}>{phrase}</span> : null}
          {row.recurrence ? <span className="text-faint">{row.recurrence}</span> : null}
        </div>
      </div>
      {canEdit ? (
        <Button
          type="button"
          variant="ghost"
          aria-label={`Complete ${row.title}`}
          className="min-h-8 justify-self-start px-3 text-[13px] sm:justify-self-end pointer-coarse:min-h-11"
          disabled={complete.isPending}
          onClick={onComplete}
        >
          {complete.isPending ? "Saving…" : "Complete"}
        </Button>
      ) : null}
    </li>
  );
}
