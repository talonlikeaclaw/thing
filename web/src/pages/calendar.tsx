import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, Navigate, useLocation, useParams, useSearchParams } from "react-router";

import {
  useAgenda,
  useCompleteObject,
  useMe,
  useObjects,
  useSnoozeObject,
  useSpace,
  useTypeDetails,
  useTypes,
} from "@/api/queries";
import type { AgendaRow, ObjectsQuery } from "@/api/types";
import { TypeFilter } from "@/components/agenda/type-filter";
import { AGENDA_SEGMENT, AGENDA_TOOLBAR } from "@/components/agenda/toolbar";
import { DayDueRow } from "@/components/calendar/day-due-row";
import { WeekGrid } from "@/components/calendar/week-grid";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { ErrorState } from "@/components/error-state";
import { ThumbRow } from "@/components/handedness";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { useToast } from "@/components/ui/toast";
import { MonthGrid } from "@/components/views/month-grid";
import { cn } from "@/lib/cn";
import {
  calendarParams,
  calendarStateFromParams,
  calendarStorageKey,
  defaultCalendarState,
  normalizeCalendarTypes,
  readCalendarState,
  weekRange,
  weekStart,
  writeCalendarState,
  type CalendarState,
  type CalendarView,
} from "@/lib/calendar";
import { isDayTitle, STREAK_DAYS, streakOf } from "@/lib/daily";
import { readError } from "@/lib/display";
import { useCompactWidth } from "@/lib/media";
import { useRouteMeta } from "@/lib/route";
import { completeLabel } from "@/lib/schedule";
import { shiftDay, todayIn } from "@/lib/timezone";
import { gridRange, groupByDate, monthName, monthOf } from "@/lib/views";

/** One read covers the month grid's leading and trailing days too. */
const CALENDAR_ROWS = 500;

/** The days one `YYYY-MM` has, read in UTC so no browser zone can move them. */
function daysInMonth(month: string): number {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7));
  return new Date(Date.UTC(year, index, 0)).getUTCDate();
}

/** Whether a read is the answer the URL names, not the previous one's page. */
function settled(query: { isSuccess: boolean; isPlaceholderData: boolean }): boolean {
  return query.isSuccess && !query.isPlaceholderData;
}

/**
 * `/s/:spaceId/calendar` — the space's month and week.
 *
 * The calendar is one surface with two layers: each day's journal note, when
 * the space names a daily type, and its outstanding scheduled rows. A month
 * shows the shape; a week shows the detail, seven days Monday first with their
 * titles and actions visible. The day panel is the same at both shapes, so a
 * day is learned once.
 */
export function CalendarPage() {
  const { spaceId } = useParams();
  const [params, setParams] = useSearchParams();
  const me = useMe();
  const space = useSpace(spaceId);
  const types = useTypes(spaceId);
  const toast = useToast();
  const compact = useCompactWidth();

  useRouteMeta("Calendar");

  const today = space.data ? todayIn(space.data.timezone) : "";
  const base = useMemo(() => defaultCalendarState(today || "1970-01-01"), [today]);
  const storageKey = me.data && spaceId ? calendarStorageKey(me.data.id, spaceId) : null;
  const [booted, setBooted] = useState(false);

  /**
   * The URL is the state; storage is the fallback for a bare one. "User can
   * decide" is the reader's last shape: a bare `/calendar` opens on the month
   * or the week they chose last, and Back only walks the states they made.
   */
  useEffect(() => {
    if (booted || !storageKey || !space.data) {
      return;
    }
    const stored = readCalendarState(window.localStorage, storageKey, base);
    if (params.toString() === "" && calendarParams(stored, base).toString() !== "") {
      setParams(calendarParams(stored, base), { replace: true });
    } else {
      writeCalendarState(window.localStorage, storageKey, calendarStateFromParams(params, base));
    }
    setBooted(true);
  }, [booted, storageKey, space.data, base, params, setParams]);

  const state = calendarStateFromParams(params, base);
  const dailyType = space.data?.daily_type ?? null;
  const type = types.data?.find((summary) => summary.key === dailyType);
  const canEdit = space.data ? space.data.role !== "viewer" : false;
  const scheduledTypes = (types.data ?? []).filter((summary) => summary.schedule);
  const scheduledKeys = scheduledTypes.map((summary) => summary.key);
  // A stale key from a link or storage narrows nothing: the page keeps only
  // the types this space still schedules, then repairs the URL and storage.
  const effectiveTypes = state.types.filter((key) => scheduledKeys.includes(key));
  const reading = Boolean(spaceId && space.data);
  const range = state.view === "month" ? gridRange(state.month) : weekRange(state.week);
  const typeFilter = effectiveTypes.length > 0 ? { types: effectiveTypes } : {};

  useEffect(() => {
    if (!booted || !types.data || effectiveTypes.length === state.types.length) {
      return;
    }
    const next = { ...state, types: effectiveTypes };
    if (storageKey) {
      writeCalendarState(window.localStorage, storageKey, next);
    }
    setParams(calendarParams(next, base), { replace: true });
  }, [booted, types.data, state, effectiveTypes, storageKey, base, setParams]);

  const notesRead = useObjects(reading && type ? spaceId : undefined, {
    type: dailyType ?? "",
    filter: {
      op: "and",
      conditions: [
        { property: "title", condition: "greater_or_equal", value: range.from },
        { property: "title", condition: "less_or_equal", value: range.to },
      ],
    },
    sorts: [{ property: "title", direction: "asc" }],
    limit: CALENDAR_ROWS,
  } satisfies ObjectsQuery);
  const agenda = useAgenda(reading ? spaceId : undefined, {
    from: range.from,
    to: range.to,
    ...typeFilter,
  });
  /**
   * The run's window: 90 days ending today, read only for the month's stats.
   * A saturated window reads `90+` rather than a number the read never saw.
   */
  const runRead = useObjects(
    reading && type && state.view === "month" && today ? spaceId : undefined,
    {
      type: dailyType ?? "",
      filter: {
        op: "and",
        conditions: [
          {
            property: "title",
            condition: "greater_or_equal",
            value: today ? shiftDay(today, -(STREAK_DAYS - 1)) : "",
          },
          { property: "title", condition: "less_or_equal", value: today },
        ],
      },
      limit: STREAK_DAYS,
    } satisfies ObjectsQuery,
  );
  // Scheduled types carry the completion verb on their definition; one cached
  // request per type, not one per row.
  const typeDetails = useTypeDetails(spaceId ?? "", scheduledKeys);

  const complete = useCompleteObject(spaceId ?? "");
  const snooze = useSnoozeObject(spaceId ?? "");

  function apply(next: CalendarState) {
    if (storageKey) {
      writeCalendarState(window.localStorage, storageKey, next);
    }
    setParams(calendarParams(next, base), { replace: false });
  }

  /** The same place in the other shape: the week's month, or the month's first week. */
  function switchView(view: CalendarView) {
    if (view === state.view) {
      return;
    }
    if (view === "week") {
      apply({
        ...state,
        view,
        week:
          state.month === monthOf(today)
            ? base.week
            : weekStart(`${state.month}-01`),
      });
      return;
    }
    apply({ ...state, view, month: monthOf(state.week) });
  }

  function onSnooze(row: AgendaRow, days: number) {
    snooze.mutate(
      { id: row.id, rev: row.rev, days },
      {
        onSuccess: ({ object: saved, dueDateBefore }) => {
          const nextDue = saved.schedule?.due_date;
          toast.showToast(
            nextDue ? `Snoozed “${saved.title}” to ${nextDue}.` : `“${saved.title}” snoozed.`,
            "plain",
            {
              label: "Undo",
              onAction: () => {
                void snooze
                  .undo(saved, dueDateBefore)
                  .then(() => toast.showToast("Snooze undone."))
                  .catch((error) =>
                    toast.showToast(`Could not undo — ${readError(error)}`, "danger"),
                  );
              },
            },
          );
        },
        onError: (error) => {
          toast.showToast(`Could not snooze — ${readError(error)}`, "danger");
        },
      },
    );
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

  if (!booted || space.isPending || types.isPending) {
    return <p className="text-[13px] text-muted">Reading the calendar…</p>;
  }

  const error = space.error ?? types.error;
  if (error) {
    return (
      <ErrorState
        error={error}
        subject="Calendar"
        onRetry={() => {
          void space.refetch();
          void types.refetch();
        }}
      />
    );
  }

  const detail = space.data;
  if (!detail) {
    return null;
  }

  const spaceDetailId = detail.id;
  const basePath = `/s/${spaceDetailId}`;
  /**
   * A placeholder is the other shape's or month's page, still on screen while
   * this read lands, so only a settled read paints a cell or a day.
   */
  // A space without a journal has no notes read at all; its absence must not
  // hold the due layer hostage.
  const notesEnabled = Boolean(dailyType && type);
  const rangeSettled = (notesEnabled ? settled(notesRead) : true) && settled(agenda);
  const notes = rangeSettled
    ? notesRead.data?.objects.filter((note) => isDayTitle(note.title)) ?? []
    : [];
  const dueRows = rangeSettled ? (agenda.data?.rows ?? []) : [];
  const dueByDate = groupByDate(dueRows, (row) => row.due_date);
  const writtenDays = new Set(notes.map((note) => note.title));
  const verbs: Record<string, string> = Object.fromEntries(
    typeDetails.details.map((def) => [def.key, completeLabel(def.schedule_labels)]),
  );
  // One busy row at a time: the verb and the alarm both disable together.
  const pendingId =
    (complete.isPending ? complete.variables?.id : undefined) ??
    (snooze.isPending ? snooze.variables?.id : undefined) ??
    null;

  function dueRow(row: AgendaRow) {
    return (
      <DayDueRow
        key={row.id}
        spaceId={spaceDetailId}
        row={row}
        canEdit={canEdit}
        verb={verbs[row.type] ?? "Complete"}
        pending={pendingId === row.id}
        onComplete={onComplete}
        onSnooze={onSnooze}
      />
    );
  }

  function writeLink(day: string) {
    return (
      <Link
        to={`${basePath}/daily/${day}`}
        className="inline-flex min-h-8 items-center px-1 font-mono text-[11px] uppercase tracking-[0.06em] text-accent hover:underline pointer-coarse:min-h-11"
      >
        Write this day&apos;s note
      </Link>
    );
  }

  /**
   * The month's one day panel: the day's notes are listed above it, then its
   * outstanding rows with their verbs, then the write action when a note is
   * missing. A viewer gets the reads without the actions.
   */
  function panelActions(day: string): ReactNode {
    const rows = dueByDate.get(day) ?? [];
    const offer = rangeSettled && canEdit && Boolean(dailyType && type) && !writtenDays.has(day);
    if (rows.length === 0 && !offer) {
      return null;
    }
    return (
      <div className="grid gap-1">
        {rows.length > 0 ? (
          <>
            <span className="label px-1">Due that day</span>
            <div className="grid gap-0.5">{rows.map(dueRow)}</div>
          </>
        ) : null}
        {offer ? writeLink(day) : null}
      </div>
    );
  }

  const run =
    state.view === "month" && settled(runRead)
      ? streakOf(
          new Set(
            (runRead.data?.objects ?? [])
              .filter((note) => isDayTitle(note.title))
              .map((note) => note.title),
          ),
          today,
        )
      : 0;
  const writtenThisMonth = new Set(
    notes.filter((note) => monthOf(note.title) === state.month).map((note) => note.title),
  );
  const writtenThisWeek = new Set(notes.map((note) => note.title));

  const stats = !rangeSettled ? null : state.view === "month" ? (
    <p className="mt-3 flex flex-wrap items-baseline gap-x-2 font-mono text-[12px] text-faint">
      <span className="tnum">
        {writtenThisMonth.size} of {daysInMonth(state.month)} days written in{" "}
        {monthName(state.month)}
      </span>
      {run > 0 ? (
        <>
          <span aria-hidden>·</span>
          <span className="tnum">
            {run >= STREAK_DAYS ? `${STREAK_DAYS}+ day run` : `${run}-day run`}
          </span>
        </>
      ) : null}
    </p>
  ) : (
    <p className="mt-3 flex flex-wrap items-baseline gap-x-2 font-mono text-[12px] text-faint">
      <span className="tnum">{writtenThisWeek.size} of 7 days written this week</span>
      {dueRows.length > 0 ? (
        <>
          <span aria-hidden>·</span>
          <span className="tnum">{dueRows.length} due</span>
        </>
      ) : null}
    </p>
  );

  const nothing = rangeSettled && notes.length === 0 && dueRows.length === 0;
  const noJournal = !dailyType || !type;
  const noSchedule = scheduledTypes.length === 0;
  const emptySentence =
    noJournal && noSchedule
      ? "Nothing is dated in this space yet. An owner can choose a daily note type in space settings, or turn Schedule on for a type."
      : state.view === "month"
        ? `Nothing written or due in ${monthName(state.month)}.`
        : "Nothing written or due this week.";

  const viewSwitch = (
    <div role="group" aria-label="View" className={AGENDA_TOOLBAR}>
      {(
        [
          ["month", "Month"],
          ["week", "Week"],
        ] as const
      ).map(([view, label]) => (
        <button
          key={view}
          type="button"
          aria-pressed={state.view === view}
          className={AGENDA_SEGMENT}
          onClick={() => switchView(view)}
        >
          {label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="settle">
      <Breadcrumbs items={[{ label: detail.name, to: basePath }, { label: "Calendar" }]} />
      <PageHeader title="Calendar" />
      <ThumbRow
        className={cn(
          "mt-3 flex-wrap items-center gap-2",
          compact ? "w-full" : "justify-start",
        )}
      >
        {viewSwitch}
        {scheduledTypes.length > 0 ? (
          <TypeFilter
            types={scheduledTypes}
            selected={effectiveTypes}
            onChange={(next) => apply({ ...state, types: normalizeCalendarTypes(next) })}
            allLabel="All scheduled types"
            title="Filter the calendar"
          />
        ) : null}
      </ThumbRow>
      {dailyType && !type && types.data ? (
        <p className="mt-2 text-[12px] text-muted">
          The space&apos;s daily note type ({dailyType}) is missing; an owner can choose another
          in space settings.
        </p>
      ) : null}
      {stats}
      {nothing && (!noJournal || !noSchedule) && state.view === "week" ? (
        <div className="mt-3 max-w-[52ch]">
          <EmptyState sentence={emptySentence} />
        </div>
      ) : null}

      {state.view === "month" ? (
        <MonthGrid
          month={state.month}
          today={today}
          items={notes}
          dateOf={(note) => note.title}
          keyOf={(note) => note.id}
          hrefOf={(note) => `${basePath}/o/${note.id}`}
          titleOf={(note) => note.title}
          renderChip={(note) => (
            <>
              {note.icon ? (
                <span aria-hidden className="mr-1">
                  {note.icon}
                </span>
              ) : null}
              Note
              <span className="sr-only">: {note.title}</span>
            </>
          )}
          maxChips={1}
          dayMarker={(day) => {
            const count = dueByDate.get(day)?.length ?? 0;
            return count === 0 ? null : (
              <span className="tnum font-mono text-[11px] whitespace-nowrap text-faint">
                {count} due
              </span>
            );
          }}
          dayActions={panelActions}
          above={
            !rangeSettled ? (
              <p role="status" className="mt-3 border-t rule pt-3 text-[13px] text-muted">
                Reading the month…
              </p>
            ) : nothing ? (
              <div className="mt-3 max-w-[52ch] border-t rule pt-3">
                <p className="text-[13px] text-muted">{emptySentence}</p>
                {!noJournal && notes.length === 0 ? (
                  <p className="mt-1 text-[13px] text-muted">
                    A note belongs to this calendar only while its title is the day it records.
                  </p>
                ) : null}
              </div>
            ) : null
          }
          onMonthChange={(month) => apply({ ...state, month })}
        />
      ) : (
        <WeekGrid
          spaceId={spaceDetailId}
          week={state.week}
          today={today}
          notes={notes}
          dueByDate={dueByDate}
          canEdit={canEdit}
          verbs={verbs}
          pendingId={pendingId}
          onComplete={onComplete}
          onSnooze={onSnooze}
          onWeekChange={(week) => apply({ ...state, week })}
          onToday={() => apply({ ...state, week: base.week })}
        />
      )}
    </div>
  );
}

/**
 * The old journal month's address, kept as a redirect to the space Calendar.
 * The query string travels, so a bookmarked `?month=` still opens that month.
 */
export function DailyCalendarRedirect() {
  const { spaceId } = useParams();
  const at = useLocation();
  return <Navigate to={`/s/${spaceId}/calendar${at.search}`} replace />;
}

