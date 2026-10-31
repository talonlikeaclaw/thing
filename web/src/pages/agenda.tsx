import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";

import {
  useAgenda,
  useCompleteObject,
  useMe,
  useSpace,
  useTypeDetails,
  useTypes,
} from "@/api/queries";
import type { AgendaRow } from "@/api/types";
import { AgendaCalendar } from "@/components/agenda/agenda-calendar";
import { AgendaHorizons, AgendaList } from "@/components/agenda/agenda-list";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { ErrorState } from "@/components/error-state";
import { useToast } from "@/components/ui/toast";
import {
  agendaParams,
  agendaStateFromParams,
  agendaStorageKey,
  defaultAgendaState,
  gridWindow,
  isMonth,
  readAgendaState,
  writeAgendaState,
  type AgendaState,
} from "@/lib/agenda";
import { cn } from "@/lib/cn";
import { readError } from "@/lib/display";
import { useRouteMeta } from "@/lib/route";
import { completeLabel } from "@/lib/schedule";
import { todayIn } from "@/lib/timezone";

/** `/s/:spaceId/agenda` — every scheduled row, as a List or a Calendar. */
export function AgendaPage() {
  const { spaceId } = useParams();
  const [params, setParams] = useSearchParams();
  const me = useMe();
  const space = useSpace(spaceId);
  const types = useTypes(spaceId);

  useRouteMeta("Schedule");

  const spaceToday = space.data ? todayIn(space.data.timezone) : "";
  const base = useMemo(() => defaultAgendaState(spaceToday), [spaceToday]);
  const storageKey = me.data && spaceId ? agendaStorageKey(me.data.id, spaceId) : null;
  const [booted, setBooted] = useState(false);

  /**
   * The URL is the state; storage is only the fallback for a bare one. Once
   * the user and the space are known, a bare URL is rewritten with the
   * remembered state under `replace`, so the address bar is always shareable
   * and Back only walks the states the user made.
   */
  useEffect(() => {
    if (booted || !storageKey || !space.data) {
      return;
    }
    const stored = readAgendaState(window.localStorage, storageKey, base);
    if (params.toString() === "" && agendaParams(stored, base).toString() !== "") {
      setParams(agendaParams(stored, base), { replace: true });
    } else {
      writeAgendaState(window.localStorage, storageKey, agendaStateFromParams(params, base));
    }
    setBooted(true);
  }, [booted, storageKey, space.data, base, params, setParams]);

  const state = agendaStateFromParams(params, base);
  const query =
    state.view === "calendar" && isMonth(state.month)
      ? gridWindow(state.month)
      : { days: state.horizon };
  // The first read waits for the URL to settle, so a bare link makes one
  // request rather than a default one it immediately replaces.
  const agenda = useAgenda(booted ? spaceId : undefined, query);

  // Scheduled types carry the completion verb on their definition; one cached
  // request per type, not one per row.
  const scheduledKeys = (types.data ?? [])
    .filter((type) => type.schedule)
    .map((type) => type.key);
  const typeDetails = useTypeDetails(spaceId ?? "", scheduledKeys);

  const complete = useCompleteObject(spaceId ?? "");
  const toast = useToast();

  function update(patch: Partial<AgendaState>) {
    const next = { ...state, ...patch };
    if (storageKey) {
      writeAgendaState(window.localStorage, storageKey, next);
    }
    setParams(agendaParams(next, base), { replace: false });
  }

  function onComplete(row: AgendaRow) {
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

  if (!booted || types.isPending || agenda.isPending) {
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
  const pendingId = complete.isPending ? (complete.variables?.id ?? null) : null;
  const today = schedule.today || spaceToday;

  return (
    <div className="settle">
      <Breadcrumbs
        items={[{ label: detail.name, to: `/s/${detail.id}` }, { label: "Schedule" }]}
      />
      <div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <h1 className="text-[26px] font-medium tracking-[-0.02em]">Schedule</h1>
          <div role="group" aria-label="View" className="flex items-center gap-1">
            {(
              [
                ["list", "List"],
                ["calendar", "Calendar"],
              ] as const
            ).map(([view, label]) => (
              <button
                key={view}
                type="button"
                aria-pressed={state.view === view}
                className={cn(
                  "label rounded-[3px] px-2 py-1 transition-colors hover:text-ink aria-pressed:bg-raised aria-pressed:text-ink pointer-coarse:min-h-11 pointer-coarse:min-w-11",
                  state.view === view ? "" : "text-faint",
                )}
                onClick={() => update({ view })}
              >
                {label}
              </button>
            ))}
          </div>
          {state.view === "list" ? (
            <div className="ml-auto flex max-sm:basis-full max-sm:ml-0">
              <AgendaHorizons horizon={state.horizon} onChange={(horizon) => update({ horizon })} />
            </div>
          ) : null}
        </div>
        <p className="mt-2 font-mono text-[12px] text-faint">
          {schedule.timezone} · today {today}
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
        ) : state.view === "calendar" ? (
          <AgendaCalendar
            spaceId={detail.id}
            month={state.month}
            today={today}
            rows={schedule.rows}
            canEdit={canEdit}
            verbs={verbs}
            pendingId={pendingId}
            onComplete={onComplete}
            onMonthChange={(month) => update({ month })}
          />
        ) : (
          <AgendaList
            rows={schedule.rows}
            horizon={state.horizon}
            laterCount={schedule.later_count ?? 0}
            onHorizonChange={(horizon) => update({ horizon })}
            spaceId={detail.id}
            canEdit={canEdit}
            verbs={verbs}
            pendingId={pendingId}
            onComplete={onComplete}
          />
        )}
      </div>
    </div>
  );
}
