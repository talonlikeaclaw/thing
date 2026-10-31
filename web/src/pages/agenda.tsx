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
import type { AgendaQuery, AgendaRow } from "@/api/types";
import { AgendaCalendar } from "@/components/agenda/agenda-calendar";
import { AgendaHorizons, AgendaList } from "@/components/agenda/agenda-list";
import { TypeFilter } from "@/components/agenda/type-filter";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { ErrorState } from "@/components/error-state";
import { ThumbRow, useHandedness } from "@/components/handedness";
import { useToast } from "@/components/ui/toast";
import {
  agendaParams,
  agendaStateFromParams,
  agendaStorageKey,
  agendaTypeLabel,
  defaultAgendaState,
  gridWindow,
  isMonth,
  normalizeAgendaTypes,
  readAgendaState,
  writeAgendaState,
  type AgendaState,
} from "@/lib/agenda";
import { cn } from "@/lib/cn";
import { readError } from "@/lib/display";
import { useCompactWidth } from "@/lib/media";
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
  const scheduledTypes = (types.data ?? []).filter((type) => type.schedule);
  const scheduledKeys = scheduledTypes.map((type) => type.key);
  // A stale key from a link or storage narrows nothing: the page keeps only
  // the types this space still schedules, then repairs the URL and storage.
  const effectiveTypes = state.types.filter((key) => scheduledKeys.includes(key));
  const filterLabel = agendaTypeLabel(
    scheduledTypes
      .filter((type) => effectiveTypes.includes(type.key))
      .map((type) => type.name),
  );

  useEffect(() => {
    if (!booted || !types.data || effectiveTypes.length === state.types.length) {
      return;
    }
    const next = { ...state, types: effectiveTypes };
    if (storageKey) {
      writeAgendaState(window.localStorage, storageKey, next);
    }
    setParams(agendaParams(next, base), { replace: true });
  }, [booted, types.data, state, effectiveTypes, storageKey, base, setParams]);

  const typeFilter = effectiveTypes.length > 0 ? { types: effectiveTypes } : {};
  const query: AgendaQuery =
    state.view === "calendar" && isMonth(state.month)
      ? { ...gridWindow(state.month), ...typeFilter }
      : { days: state.horizon, ...typeFilter };
  // The first read waits for the URL and the type list to settle, so a bare
  // link makes one request rather than a default one it immediately replaces,
  // and a stale type key never reaches the server.
  const agenda = useAgenda(booted && types.data ? spaceId : undefined, query);

  // Scheduled types carry the completion verb on their definition; one cached
  // request per type, not one per row.
  const typeDetails = useTypeDetails(spaceId ?? "", scheduledKeys);

  const complete = useCompleteObject(spaceId ?? "");
  const toast = useToast();
  const { handedness } = useHandedness();
  const compact = useCompactWidth();

  function update(patch: Partial<AgendaState>) {
    const next = { ...state, ...patch, types: normalizeAgendaTypes(patch.types ?? state.types) };
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

  if (!booted || types.isPending) {
    return <p className="text-[13px] text-muted">Reading the schedule…</p>;
  }

  if (types.error) {
    return (
      <ErrorState
        error={types.error}
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
  if (!detail || !typesData) {
    return <p className="text-[13px] text-muted">Reading the schedule…</p>;
  }

  const schedule = agenda.data;
  const canEdit = detail.role !== "viewer";
  const verbs: Record<string, string> = Object.fromEntries(
    typeDetails.details.map((def) => [def.key, completeLabel(def.schedule_labels)]),
  );
  const pendingId = complete.isPending ? (complete.variables?.id ?? null) : null;
  const today = schedule?.today || spaceToday;
  const viewSwitch = (
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
  );
  const titleHeading = (
    <h1 className="text-[26px] font-medium tracking-[-0.02em]">Schedule</h1>
  );
  const headerTitle = (
    <div
      className={cn(
        "flex min-w-0 flex-wrap items-center gap-x-6 gap-y-2",
        compact && "w-full justify-between",
      )}
    >
      {handedness === "left" ? (
        <>
          {viewSwitch}
          {titleHeading}
        </>
      ) : (
        <>
          {titleHeading}
          {viewSwitch}
        </>
      )}
    </div>
  );
  // The controls are an action row: canonical order puts the primary filter
  // last, and `ThumbRow` moves it to the left thumb edge in left mode.
  const headerTools = (
    <ThumbRow className={cn("flex-wrap items-center gap-2", compact && "w-full")}>
      {state.view === "list" ? (
        <AgendaHorizons
          horizon={state.horizon}
          onChange={(horizon) => update({ horizon })}
        />
      ) : null}
      {scheduledTypes.length > 0 ? (
        <TypeFilter
          types={scheduledTypes}
          selected={effectiveTypes}
          onChange={(nextTypes) => update({ types: nextTypes })}
        />
      ) : null}
    </ThumbRow>
  );

  return (
    <div className="settle">
      <Breadcrumbs
        items={[{ label: detail.name, to: `/s/${detail.id}` }, { label: "Schedule" }]}
      />
      <div>
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          {handedness === "left" && !compact ? (
            <>
              {headerTools}
              {headerTitle}
            </>
          ) : (
            <>
              {headerTitle}
              {headerTools}
            </>
          )}
        </div>
        <p className="mt-2 font-mono text-[12px] text-faint">
          {schedule?.timezone ?? detail.timezone} · today {today}
        </p>

        {agenda.error ? (
          <div className="mt-8">
            <ErrorState
              error={agenda.error}
              subject="Schedule"
              onRetry={() => {
                void agenda.refetch();
              }}
            />
          </div>
        ) : scheduledTypes.length === 0 ? (
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
        ) : !schedule ? (
          <p className="mt-8 text-[13px] text-muted">Reading the schedule…</p>
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
            filterLabel={filterLabel}
            onClearFilter={() => update({ types: [] })}
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
            filterLabel={filterLabel}
            onClearFilter={() => update({ types: [] })}
          />
        )}
      </div>
    </div>
  );
}
