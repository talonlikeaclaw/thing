import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Navigate, useLocation, useParams, useSearchParams } from "react-router";

import {
  useAgenda,
  useMe,
  useObjects,
  useSpace,
  useTypes,
} from "@/api/queries";
import type { AgendaRow, ObjectsQuery } from "@/api/types";
import { AgendaDoor } from "@/components/agenda/door";
import { AgendaSwitch } from "@/components/agenda/switch";
import { TypeFilter } from "@/components/agenda/type-filter";
import { DayDueRow } from "@/components/calendar/day-due-row";
import { DayNoteChip, DayWriteNote } from "@/components/calendar/day-note-chip";
import { WeekGrid } from "@/components/calendar/week-grid";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { DatedHeader } from "@/components/dated-header";
import { DayWork } from "@/components/day-work";
import { ErrorState } from "@/components/error-state";
import { EmptyState } from "@/components/ui/page";
import { MonthGrid } from "@/components/views/month-grid";
import { useAgendaActions } from "@/lib/agenda-actions";
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
import { formatDay } from "@/lib/display";
import { useKeptDatedScroll } from "@/lib/kept-scroll";
import { useCompactWidth } from "@/lib/media";
import { useRouteMeta } from "@/lib/route";
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
  /*
   * A write belongs to a space with a journal: the month's day panel and the
   * week's day column offer it under the same condition, so a space that only
   * schedules work never shows seven links to a page that can only say it has
   * no daily type.
   */
  const canWriteDay = canEdit && Boolean(dailyType && type);
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

  /*
   * Any day of a week names that week, so `?week=2026-11-25` and
   * `?week=2026-11-23` would otherwise be two addresses for one grid. The
   * Monday is the one the page keeps, so a copied link always resolves to the
   * same seven days for everyone.
   */
  const rawWeek = params.get("week") ?? "";
  const weekOff = isDayTitle(rawWeek) && weekStart(rawWeek) !== rawWeek;
  useEffect(() => {
    if (!booted || !weekOff) {
      return;
    }
    const next = new URLSearchParams(params);
    next.set("week", weekStart(rawWeek));
    setParams(next, { replace: true });
  }, [booted, weekOff, rawWeek, params, setParams]);

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
   * A placeholder is the other shape's or month's page, still on screen while
   * this read lands, so only a settled read paints a cell or a day. A space
   * without a journal has no notes read at all; its absence must not hold the
   * due layer hostage.
   */
  const notesEnabled = Boolean(dailyType && type);
  const rangeSettled = (notesEnabled ? settled(notesRead) : true) && settled(agenda);
  // The door from the Schedule notes where the reader was; this page holds it.
  useKeptDatedScroll();
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
  const { verbs, pendingId, onComplete, onSnooze } = useAgendaActions(
    spaceId ?? "",
    scheduledKeys,
  );

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

  if (!booted || space.isPending || types.isPending) {
    return <p className="text-[13px] text-muted">Reading the calendar…</p>;
  }

  /*
   * The month and the week are four reads: the space, its types, its notes and
   * its agenda. A failure in any of them is stated and retried here, because a
   * silently failed notes read otherwise paints an empty month for ever.
   */
  const error = space.error ?? types.error ?? notesRead.error ?? agenda.error;
  if (error) {
    return (
      <ErrorState
        error={error}
        subject="Calendar"
        onRetry={() => {
          void space.refetch();
          void types.refetch();
          void notesRead.refetch();
          void agenda.refetch();
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
  const notes = rangeSettled
    ? notesRead.data?.objects.filter((note) => isDayTitle(note.title)) ?? []
    : [];
  const dueRows = rangeSettled ? (agenda.data?.rows ?? []) : [];
  const dueByDate = groupByDate(dueRows, (row) => row.due_date);
  const writtenDays = new Set(notes.map((note) => note.title));

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

  /** The empty note slot in the day panel: the same row the week draws. */
  function writeLink(day: string) {
    return (
      <DayWriteNote spaceId={spaceDetailId} day={day} className="mt-1">
        Write this day&apos;s note
      </DayWriteNote>
    );
  }

  /**
   * The month's one day panel: the day's notes are listed above it, then its
   * outstanding rows with their verbs, then the write action when a note is
   * missing. A viewer gets the reads without the actions. The work is one
   * framed group under the notes, the same layer the week's day column draws.
   */
  function panelActions(day: string): ReactNode {
    const rows = dueByDate.get(day) ?? [];
    const offer = rangeSettled && canWriteDay && !writtenDays.has(day);
    if (rows.length === 0 && !offer) {
      return null;
    }
    return (
      <div className="grid gap-1">
        {rows.length > 0 ? (
          <DayWork
            label={day === today ? "Due today" : "Due that day"}
            count={rows.length}
          >
            {rows.map(dueRow)}
          </DayWork>
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
    <>
      <span className="tnum">
        {writtenThisMonth.size} of {daysInMonth(state.month)} days written in{" "}
        {monthName(state.month)}
      </span>
      {run > 0 && state.month === monthOf(today) ? (
        <span className="whitespace-nowrap">
          <span aria-hidden>· </span>
          <span className="tnum">
            {run >= STREAK_DAYS ? `${STREAK_DAYS}+ day run` : `${run}-day run`}
          </span>
        </span>
      ) : null}
    </>
  ) : (
    <>
      <span className="tnum">{writtenThisWeek.size} of 7 days written this week</span>
      {dueRows.length > 0 ? (
        <span className="whitespace-nowrap">
          <span aria-hidden>· </span>
          <span className="tnum">{dueRows.length} due</span>
        </span>
      ) : null}
    </>
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
    <AgendaSwitch
      label="View"
      value={state.view}
      stretch={compact}
      options={[
        { value: "month", label: "Month" },
        { value: "week", label: "Week" },
      ]}
      onChange={switchView}
    />
  );

  return (
    <div className="settle">
      <Breadcrumbs items={[{ label: detail.name, to: basePath }, { label: "Calendar" }]} />
      {/*
        One glass header and one control grammar, as the Schedule has: the
        page's name, its leading switch, the filter and the door, then the line
        that closes them. The month or week under it is the data, so it stays on
        the matte card and never scrolls inside the chrome.
      */}
      <DatedHeader
        title="Calendar"
        controls={viewSwitch}
        trailing={[
          ...(scheduledTypes.length > 0
            ? [
                <TypeFilter
                  key="filter"
                  types={scheduledTypes}
                  selected={effectiveTypes}
                  onChange={(next) => apply({ ...state, types: normalizeCalendarTypes(next) })}
                  allLabel="All scheduled types"
                  title="Filter the calendar"
                  stretch={compact}
                />,
              ]
            : []),
          // The same rows as a list: one door between the two readings of the
          // space's dated layer.
          <AgendaDoor
            key="door"
            to={`${basePath}/agenda`}
            label="Schedule"
            stretch={compact && scheduledTypes.length > 0}
          />,
        ]}
        settling={!rangeSettled}
        line={
          /* While the notes and the work load, the line says what the room
             is; once they land it becomes the month's or week's own count. The
             card states that it is reading, so the header never repeats it. */
          stats ?? (
            <span>
              {detail.timezone} · today {formatDay(today)}
            </span>
          )
        }
      />
      {dailyType && !type && types.data ? (
        <p className="mt-2 text-[12px] text-muted">
          The space&apos;s daily note type ({dailyType}) is missing; an owner can choose another
          in space settings.
        </p>
      ) : null}
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
          // The day's panel lists its note as the same chip a week's day
          // column draws, so a day reads the same in both calendar shapes.
          renderRow={(note) => <DayNoteChip spaceId={spaceDetailId} note={note} />}
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
          dayHref={(day) => `${basePath}/daily/${day}`}
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
          loading={!rangeSettled}
          canEdit={canEdit}
          canWriteDay={canWriteDay}
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

