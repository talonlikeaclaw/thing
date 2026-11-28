import { AlignLeft } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useParams } from "react-router";

import {
  useCreateObject,
  useObjects,
  useProperties,
  useSpace,
  useType,
  useTypes,
} from "@/api/queries";
import type { Filter } from "@/api/types";
import { Breadcrumbs, type Crumb } from "@/components/breadcrumbs";
import { DayDue, useDayDue } from "@/components/day-due";
import { DayRail, useDayHotkeys } from "@/components/day-strip";
import { ErrorState } from "@/components/error-state";
import { Button } from "@/components/ui/controls";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { ThingIcon } from "@/components/thing-icon";
import { cn } from "@/lib/cn";
import { dayLabel, isDayTitle, longDayLabel } from "@/lib/daily";
import { withDefaults } from "@/lib/defaults";
import { readError } from "@/lib/display";
import { useRouteMeta } from "@/lib/route";
import { todayIn } from "@/lib/timezone";
import { monthLabel, monthOf } from "@/lib/views";

/**
 * `/s/:spaceId/daily` — the space's standing appointment: today.
 *
 * The canonical URL of a day is `/daily/:date`, so this route resolves the
 * space's civil day and replaces itself with it rather than rendering a second
 * address for the same note.
 */
export function DailyPage() {
  const { spaceId } = useParams();
  const space = useSpace(spaceId);

  useRouteMeta("Today");

  if (space.isPending) {
    return <p className="text-[13px] text-muted">Reading today's note…</p>;
  }

  if (space.error) {
    return (
      <ErrorState
        error={space.error}
        subject="Today"
        onRetry={() => {
          void space.refetch();
        }}
      />
    );
  }

  if (!space.data) {
    return null;
  }

  return <Navigate to={`/s/${space.data.id}/daily/${todayIn(space.data.timezone)}`} replace />;
}

/** The day's trail: the space, then Today, then the day — or Today itself. */
function dayCrumbs(
  space: { id: string; name: string },
  day: string,
  isToday: boolean,
): Crumb[] {
  const base = `/s/${space.id}`;
  if (isToday) {
    return [{ label: space.name, to: base }, { label: "Today" }];
  }
  return [
    { label: space.name, to: base },
    { label: "Today", to: `${base}/daily` },
    { label: day },
  ];
}

/**
 * `/s/:spaceId/daily/:date` — one day of the journal.
 *
 * The day is the URL, and the note is the record of the space's `daily_type`
 * whose title is that day. Today — the standing appointment — is written on
 * arrival, once, for an editor; every other day is offered as a day card and
 * created only when the reader asks, so stepping through a month never leaves
 * empty notes behind.
 */
export function DailyDayPage() {
  const { spaceId, date } = useParams();
  const day = date ?? "";
  const dayIsDate = isDayTitle(day);
  const space = useSpace(spaceId);
  const types = useTypes(spaceId);
  const create = useCreateObject(spaceId ?? "");
  const createNote = create.mutate;
  /** The day the automatic write was started for; a ref, so a re-render keeps it. */
  const attempted = useRef<string | null>(null);
  /** A refused write belongs to the day it was refused on, never to the next. */
  const [refused, setRefused] = useState<{ day: string; message: string } | null>(null);
  /**
   * The day a write was started for. `create.isPending` ends when the POST
   * answers, but the day's read has not heard about the note yet; without this
   * the card would offer the button again for one round trip, and a second
   * press would write a second note under the same title.
   */
  const [writingDay, setWritingDay] = useState<string | null>(null);
  const writeStarted = useRef(0);

  const dailyType = space.data?.daily_type ?? null;
  const type = types.data?.find((summary) => summary.key === dailyType);
  const today = space.data ? todayIn(space.data.timezone) : "";
  const isToday = dayIsDate && day === today;

  useRouteMeta(dayIsDate ? dayLabel(day) : "Today");
  useDayHotkeys({ spaceId: spaceId ?? "", day: dayIsDate ? day : null, today });

  const filter: Filter = {
    op: "and",
    conditions: [{ property: "title", condition: "equal", value: day }],
  };
  const list = useObjects(spaceId && dayIsDate && type ? spaceId : undefined, {
    type: dailyType ?? "",
    filter,
    sorts: [{ property: "updated_at", direction: "asc" }],
    limit: 1,
  });
  const def = useType(type ? spaceId : undefined, type ? dailyType ?? undefined : undefined);
  const properties = useProperties(spaceId);
  /**
   * The same agenda read `DayDue` makes, taken here so the card knows whether
   * its margin has anything to hold: a day with nothing outstanding keeps one
   * full-width column instead of a blank half beside the writing.
   */
  const due = useDayDue(dayIsDate && type ? spaceId : undefined, day);
  const hasDue = (due.data?.rows.length ?? 0) > 0;
  const canEdit = space.data ? space.data.role !== "viewer" : false;
  /**
   * A placeholder is the previous day's read, still on screen while this day's
   * loads, so only a settled read is this day's answer: a stale row would open
   * the wrong note, and an unsettled one would write a note that already exists.
   */
  const readSettled = list.isSuccess && !list.isPlaceholderData;
  const existing = readSettled ? list.data.objects[0] : undefined;
  /** The type's own defaults are half of what a write needs. */
  const ready = Boolean(def.data && properties.data);
  const createError = refused && refused.day === day ? refused.message : null;
  /** A write in flight or awaiting the read that will carry its result. */
  const busy = create.isPending || writingDay === day;

  /**
   * Writes the day and leaves the redirect to the read: the create invalidates
   * the list, this day's row arrives, and `existing` replaces the URL. Nothing
   * writes twice — the mutation's own pending flag holds the buttons, and the
   * automatic path records the day it started on.
   */
  function writeNote() {
    const definition = def.data;
    const library = properties.data;
    if (
      busy ||
      !readSettled ||
      !definition ||
      !library ||
      !canEdit ||
      !type ||
      !dailyType
    ) {
      return;
    }
    setRefused(null);
    setWritingDay(day);
    writeStarted.current = Date.now();
    createNote(
      {
        type: dailyType,
        title: day,
        properties: withDefaults(definition, library, {}),
        body: "",
      },
      {
        onError: (error) => {
          setWritingDay(null);
          setRefused({ day, message: readError(error) });
        },
      },
    );
  }

  /*
   * The write ends when a read that started after it lands: the note is found
   * and the page replaces itself, or the read is still empty and the action is
   * offered again. Clearing on the mutation alone would reopen the window the
   * day is held for.
   */
  useEffect(() => {
    if (
      writingDay === null ||
      create.isPending ||
      !readSettled ||
      list.dataUpdatedAt <= writeStarted.current
    ) {
      return;
    }
    setWritingDay(null);
  }, [writingDay, create.isPending, readSettled, list.dataUpdatedAt]);

  // A held day belongs to the day it was started on; stepping away releases it.
  useEffect(() => {
    if (writingDay !== null && writingDay !== day) {
      setWritingDay(null);
    }
  }, [day, writingDay]);

  // Today is written without asking, once: `/daily` is the space's standing
  // appointment. Any other day waits for the reader, so navigation is a read.
  // `attempted` is keyed by the day rather than reset on mount, because a
  // re-run engine must not write the same note twice.
  useEffect(() => {
    if (
      !isToday ||
      !readSettled ||
      existing ||
      createError ||
      create.isPending ||
      attempted.current === day ||
      !canEdit ||
      !ready ||
      !type ||
      !dailyType
    ) {
      return;
    }
    attempted.current = day;
    writeNote();
  }, [
    isToday,
    readSettled,
    existing,
    createError,
    create.isPending,
    canEdit,
    ready,
    type,
    dailyType,
    day,
    createNote,
  ]);

  if (space.isPending || types.isPending) {
    return <p className="text-[13px] text-muted">Reading this day's note…</p>;
  }

  /*
   * The day's own read belongs to the same refusal as the space's: a failed
   * list read otherwise leaves the card saying "Reading this day's note…"
   * for ever, and an empty answer is indistinguishable from a broken one.
   */
  const error = space.error ?? types.error ?? def.error ?? properties.error ?? list.error;
  if (error) {
    return (
      <ErrorState
        error={error}
        subject={isToday ? "Today" : "This day"}
        onRetry={() => {
          void space.refetch();
          void types.refetch();
          void def.refetch();
          void properties.refetch();
          void list.refetch();
        }}
      />
    );
  }

  if (!space.data) {
    return null;
  }

  const base = `/s/${space.data.id}`;

  if (!dayIsDate) {
    return (
      <div className="settle max-w-[76rem]">
        <Breadcrumbs
          items={[
            { label: space.data.name, to: base },
            { label: "Today", to: `${base}/daily` },
            { label: day },
          ]}
        />
        <PageHeader
          title="Not a day"
          sentence={`“${day}” is not a date. A day's note is addressed as YYYY-MM-DD, for a day that exists.`}
          actions={
            <Link
              to={`${base}/daily`}
              className="text-[13px] text-accent underline-offset-4 hover:underline"
            >
              Open today
            </Link>
          }
        />
      </div>
    );
  }

  if (!dailyType) {
    return (
      <div className="settle max-w-[76rem]">
        <Breadcrumbs items={dayCrumbs(space.data, day, isToday)} />
        <PageHeader title={longDayLabel(day)} meta={day} />
        <EmptyState
          sentence="No type is set as this space's daily note yet. An owner chooses one in space settings."
          action={
            <Link
              to={`${base}/settings`}
              className="text-[13px] text-accent underline-offset-4 hover:underline"
            >
              Open space settings
            </Link>
          }
        />
      </div>
    );
  }

  if (!type) {
    return (
      <div className="settle max-w-[76rem]">
        <Breadcrumbs items={dayCrumbs(space.data, day, isToday)} />
        <PageHeader title={longDayLabel(day)} meta={day} />
        <EmptyState
          sentence={`This space's daily note type (${dailyType}) is missing; an owner can choose another in space settings.`}
          action={
            <Link
              to={`${base}/settings`}
              className="text-[13px] text-accent underline-offset-4 hover:underline"
            >
              Open space settings
            </Link>
          }
        />
      </div>
    );
  }

  if (existing) {
    return <Navigate to={`${base}/o/${existing.id}`} replace />;
  }

  const body = !canEdit ? (
    <EmptyState
      sentence="An editor can write this day's note."
      action={
        <Link
          to={`${base}/t/${type.key}`}
          className="text-[13px] text-accent underline-offset-4 hover:underline"
        >
          Open {type.name_plural}
        </Link>
      }
    />
  ) : !readSettled ? (
    <p className="text-[13px] text-muted">Reading this day's note…</p>
  ) : isToday ? (
    createError ? (
      <EmptyState
        sentence={`Today's note could not be created: ${createError}`}
        action={
          <Button type="button" variant="ghost" onClick={writeNote}>
            Try again
          </Button>
        }
      />
    ) : (
      <p role="status" className="text-[13px] text-muted">
        Writing today's note…
      </p>
    )
  ) : createError ? (
    <EmptyState
      sentence={`This day's note could not be created: ${createError}`}
      action={
        <Button type="button" variant="ghost" onClick={writeNote}>
          Try again
        </Button>
      }
    />
  ) : busy ? (
    <p role="status" className="text-[13px] text-muted">
      Writing this day&apos;s note…
    </p>
  ) : (
    /*
      The window a note will fill: the body's own layer inside the sheet, drawn
      dashed because it holds nothing yet, the same affordance a calendar's
      empty day carries.
    */
    <div className="rounded-[16px] border border-dashed border-line-interactive/60 bg-ground/25 px-4">
      <EmptyState
        sentence="Nothing written for this day yet."
        action={
          <Button
            type="button"
            // A write needs the type's defaults and this day's answer, so the
            // action waits for both rather than ignoring a click made a beat too
            // early — or writing over a note it had not heard about.
            disabled={!ready || !readSettled}
            onClick={writeNote}
          >
            Write this day&apos;s note
          </Button>
        }
      />
    </div>
  );

  return (
    <div className="settle">
      <Breadcrumbs
        items={[
          { label: space.data.name, to: base },
          { label: type.name_plural, to: `${base}/t/${type.key}` },
          {
            label: monthLabel(monthOf(day)),
            to: `${base}/calendar?month=${monthOf(day)}`,
          },
          { label: day },
        ]}
      />
      <PageHeader
        className="mb-4"
        title={longDayLabel(day)}
        controls={<DayRail spaceId={space.data.id} day={day} today={today} />}
        controlsClassName="w-full"
        line={<time dateTime={day}>{day}</time>}
      />

      {/*
        The day card is the note's own frame, one surface either side of the
        write: the identity band already shows the title the record will carry,
        so writing the note changes the sheet's middle and nothing else. The
        day's context sits in the margin the record gives its properties — and
        only when the day has outstanding rows, so a clear day is one column
        rather than a sheet with half of it blank.
      */}
      <div className="rounded-[24px] border border-line bg-surface p-5 sm:p-6" data-day-card>
        <div className="xl:grid xl:grid-cols-12 xl:gap-x-10">
          <div
            className={cn(
              "border-b rule pb-3 xl:col-start-1",
              hasDue ? "xl:col-span-8" : "xl:col-span-12",
            )}
          >
            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
              <span className="flex min-w-0 items-center gap-2">
                {type.icon ? <ThingIcon icon={type.icon} size="md" /> : null}
                <span className="label truncate">{type.name}</span>
              </span>
              <span className="font-mono text-[length:var(--text-small)] text-faint uppercase">
                {readSettled ? "Not written" : "Reading"}
              </span>
            </div>
            <h2 className="display mt-1 text-title">{day}</h2>
          </div>

          <section
            aria-label="Body"
            className={cn(
              "mt-5 min-w-0 xl:col-start-1",
              hasDue ? "xl:col-span-8" : "xl:col-span-12",
            )}
          >
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3 border-b rule pb-2">
              <h2 className="label flex flex-wrap items-center gap-x-1.5 gap-y-1">
                <AlignLeft aria-hidden size={13} strokeWidth={1.5} className="text-muted" />
                Body
                <span className="font-mono text-[11px] font-normal tracking-normal text-faint normal-case tnum">
                  0 words · 0 characters
                </span>
              </h2>
            </div>
            {body}
          </section>

          {hasDue ? (
            <DayDue
              spaceId={space.data.id}
              day={day}
              today={today}
              canEdit={canEdit}
              className="mt-6 border-t rule pt-4 xl:col-span-4 xl:col-start-9 xl:mt-0 xl:border-t-0 xl:border-l xl:border-line xl:pt-0 xl:pl-8 xl:[grid-row:1/span_99]"
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
