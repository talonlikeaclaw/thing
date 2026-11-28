import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router";

import { useAgenda, useMe, useSpace, useTypes } from "@/api/queries";
import type { AgendaQuery } from "@/api/types";
import { AgendaHorizons, AgendaList } from "@/components/agenda/agenda-list";
import { AgendaDoor } from "@/components/agenda/door";
import { TypeFilter } from "@/components/agenda/type-filter";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { ErrorState } from "@/components/error-state";
import { PageHeader } from "@/components/ui/page";
import {
  agendaParams,
  agendaStateFromParams,
  agendaStorageKey,
  agendaTypeLabel,
  defaultAgendaState,
  normalizeAgendaTypes,
  readAgendaState,
  writeAgendaState,
  type AgendaState,
} from "@/lib/agenda";
import { useAgendaActions } from "@/lib/agenda-actions";
import { formatDay } from "@/lib/display";
import { useKeptDatedScroll } from "@/lib/kept-scroll";
import { useRouteMeta } from "@/lib/route";
import { todayIn } from "@/lib/timezone";

/** `/s/:spaceId/agenda` — every scheduled row, as a List; the calendar moved to `/calendar`. */
export function AgendaPage() {
  const { spaceId } = useParams();
  const [params, setParams] = useSearchParams();
  const me = useMe();
  const space = useSpace(spaceId);
  const types = useTypes(spaceId);

  useRouteMeta("Schedule");

  const spaceToday = space.data ? todayIn(space.data.timezone) : "";
  const base = useMemo(() => defaultAgendaState(), []);
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
    if (params.toString() === "" && agendaParams(stored).toString() !== "") {
      setParams(agendaParams(stored), { replace: true });
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
    setParams(agendaParams(next), { replace: true });
  }, [booted, types.data, state, effectiveTypes, storageKey, base, setParams]);

  const typeFilter = effectiveTypes.length > 0 ? { types: effectiveTypes } : {};
  const query: AgendaQuery = { days: state.horizon, ...typeFilter };
  // The first read waits for the URL and the type list to settle, so a bare
  // link makes one request rather than a default one it immediately replaces,
  // and a stale type key never reaches the server.
  const agenda = useAgenda(booted && types.data ? spaceId : undefined, query);
  // The door from the Calendar notes where the reader was; this page holds it.
  useKeptDatedScroll();

  const { verbs, pendingId, onComplete, onSnooze } = useAgendaActions(
    spaceId ?? "",
    scheduledKeys,
  );

  // The calendar moved to the space's own Calendar. An old Schedule link
  // lands there, keeping the month and the type filter it carried.
  if (params.get("view") === "calendar") {
    const next = new URLSearchParams();
    const month = params.get("month");
    if (month) {
      next.set("month", month);
    }
    const types = params.get("types");
    if (types) {
      next.set("types", types);
    }
    const search = next.toString();
    return (
      <Navigate to={`/s/${spaceId}/calendar${search ? `?${search}` : ""}`} replace />
    );
  }

  function update(patch: Partial<AgendaState>) {
    const next = { ...state, ...patch, types: normalizeAgendaTypes(patch.types ?? state.types) };
    if (storageKey) {
      writeAgendaState(window.localStorage, storageKey, next);
    }
    setParams(agendaParams(next), { replace: false });
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
  const today = schedule?.today || spaceToday;
  // The header is chrome, so it is the page's one glass panel: it floats over
  // the list while that scrolls under it. The page's name and buttons share the
  // title row, the filter sits right-aligned beneath them, and the line closes
  // the card.
  const header = (
    <PageHeader
      title="Schedule"
      titleActions={[
        <AgendaHorizons
          key="range"
          horizon={state.horizon}
          onChange={(horizon) => update({ horizon })}
        />,
        // The same rows as a calendar: one door between the two readings of
        // the space's dated layer.
        <AgendaDoor
          key="door"
          to={`/s/${detail.id}/calendar`}
          label="Calendar"
        />,
      ]}
      controls={
        scheduledTypes.length > 0 ? (
          <TypeFilter
            types={scheduledTypes}
            selected={effectiveTypes}
            onChange={(nextTypes) => update({ types: nextTypes })}
            allLabel="All scheduled types"
            title="Filter the schedule"
          />
        ) : undefined
      }
      controlsClassName="w-full"
      line={
        <>
          {schedule?.timezone ?? detail.timezone} · today {formatDay(today)}
        </>
      }
      sticky
    />
  );

  return (
    <div className="settle">
      <Breadcrumbs
        items={[{ label: detail.name, to: `/s/${detail.id}` }, { label: "Schedule" }]}
      />
      <div>
        {header}

        {agenda.error ? (
          <div className="mt-6">
            <ErrorState
              error={agenda.error}
              subject="Schedule"
              onRetry={() => {
                void agenda.refetch();
              }}
            />
          </div>
        ) : scheduledTypes.length === 0 ? (
          <div className="mt-6 max-w-[52ch] rounded-[22px] border border-line bg-surface p-4 sm:p-5">
            <p className="text-muted">
              No type is scheduled — open Types & properties and turn on Schedule for a
              type.
            </p>
            <Link
              to={`/s/${detail.id}/schema`}
              className="mt-3 inline-flex min-h-10 w-fit items-center rounded-full border border-line-interactive/70 bg-raised/40 px-4 text-sm text-ink transition-colors hover:border-line-strong pointer-coarse:min-h-11"
            >
              Open Types & properties
            </Link>
          </div>
        ) : !schedule ? (
          <p className="mt-6 text-[13px] text-muted">Reading the schedule…</p>
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
            onSnooze={onSnooze}
            filterLabel={filterLabel}
            onClearFilter={() => update({ types: [] })}
            dayLinks={Boolean(detail.daily_type)}
          />
        )}
      </div>
    </div>
  );
}
