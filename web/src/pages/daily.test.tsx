import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Link, Route, Routes, useLocation, useParams } from "react-router";
import { describe, expect, it } from "vitest";

import { dayLabel } from "@/lib/daily";
import { DailyDayPage, DailyPage } from "@/pages/daily";
import { jsonResponse, renderWithProviders, requestUrl, stubFetch } from "@/test/harness";
import { shiftDay, todayIn } from "@/lib/timezone";

const space = {
  id: "s1",
  name: "Garden",
  icon: null,
  accent: null,
  timezone: "UTC",
  daily_type: "journal",
  created_at: "2026-10-01T12:00:00Z",
  role: "owner",
  members: [],
  type_count: 1,
};

const types = [
  {
    key: "journal",
    name: "Journal",
    name_plural: "Journals",
    description: "",
    schedule: false,
    property_count: 1,
    object_count: 1,
  },
];

const journalType = {
  key: "journal",
  name: "Journal",
  name_plural: "Journals",
  icon: null,
  description: "",
  schedule: false,
  properties: [{ key: "mood", required: false, featured: true, default: "ok" }],
  views: [],
  default_view: "table",
};

const moodProperty = {
  key: "mood",
  name: "Mood",
  format: "text",
};

const today = todayIn("UTC");

interface StubOptions {
  role?: string;
  /** The journal's existing notes: a day title, and the record id it opens. */
  notes?: Record<string, string>;
  /** The space's `daily_type`; `null` leaves the space without a journal. */
  dailyType?: string | null;
  /** The space's types; empty proves a `daily_type` whose type is gone. */
  typeList?: unknown[];
  /** Outstanding scheduled rows the agenda reports for the day. */
  due?: unknown[];
  /** Hold the day's read open, as a warm navigation does while it refetches. */
  readDelay?: number;
  /** Refuse every create with the server's sentence. */
  failWrite?: boolean;
  /** Refuse the day's own list read, as a disk or server failure would. */
  failRead?: boolean;
}

/** The list read's only condition on this page is a title equality. */
function filterTitle(url: string): string | null {
  const raw = new URL(url, "http://test").searchParams.get("filter");
  if (!raw) {
    return null;
  }
  const filter = JSON.parse(raw) as { conditions?: { value?: string }[] };
  return filter.conditions?.[0]?.value ?? null;
}

function noteFor(day: string, id: string) {
  return {
    id,
    type: "journal",
    title: day,
    rev: 1,
    updated_at: "2026-11-20T06:00:00Z",
    values: {},
    missing_relations: [],
  };
}

const choreType = {
  key: "chore",
  name: "Chore",
  name_plural: "Chores",
  description: "",
  schedule: true,
  schedule_labels: { complete: "Done" },
  properties: [],
  views: [],
  default_view: "table",
};

const choreDetail = {
  id: "c1",
  type: "chore",
  title: "Water the ferns",
  rev: 1,
  created_at: "2026-11-01T12:00:00Z",
  updated_at: "2026-11-05T08:00:00Z",
  created_by: "u1",
  updated_by: "u1",
  properties: { due_date: { value: "2026-11-05" } },
  body: "",
  missing_relations: [],
};

/**
 * A space whose journal holds `notes`, plus a real create: a POST is recorded
 * and becomes the day's note, so the page's own refetch resolves it exactly as
 * the server would.
 */
function stubDaily({
  role = "owner",
  notes = {},
  dailyType = "journal",
  typeList = types,
  due = [],
  readDelay = 0,
  failWrite = false,
  failRead = false,
}: StubOptions = {}) {
  const written: { title: string; type: string; properties: Record<string, unknown> }[] = [];
  let attempts = 0;
  const days: Record<string, string> = { ...notes };
  const fetchMock = stubFetch((input, init) => {
    const url = requestUrl(input);
    if (url.endsWith("/api/spaces/s1") && init?.method !== "PATCH") {
      return jsonResponse({ ...space, role, daily_type: dailyType });
    }
    if (url.endsWith("/api/spaces/s1/types")) {
      return jsonResponse(typeList);
    }
    if (url.endsWith("/api/spaces/s1/types/journal")) {
      return jsonResponse(journalType);
    }
    if (url.endsWith("/api/spaces/s1/properties")) {
      return jsonResponse([moodProperty]);
    }
    if (url.endsWith("/api/spaces/s1/types/chore")) {
      return jsonResponse(choreType);
    }
    if (url.endsWith("/api/spaces/s1/objects/c1/complete") && init?.method === "POST") {
      return jsonResponse({
        ...choreDetail,
        rev: 2,
        schedule: { due_date: "2026-11-08", status: "upcoming", days_until_due: 3 },
      });
    }
    if (url.endsWith("/api/spaces/s1/objects/c1") && init?.method !== "POST") {
      return jsonResponse(choreDetail);
    }
    if (url.includes("/api/spaces/s1/agenda?")) {
      return jsonResponse({ today, timezone: "UTC", rows: due });
    }
    if (url.endsWith("/api/spaces/s1/objects") && init?.method === "POST") {
      attempts += 1;
      if (failWrite) {
        return jsonResponse(
          { error: { code: "refused", message: "The note could not be written." } },
          500,
        );
      }
      const body = JSON.parse(String(init.body)) as {
        title: string;
        type: string;
        properties: Record<string, unknown>;
      };
      written.push(body);
      const id = `new-${body.title}`;
      days[body.title] = id;
      return jsonResponse({ ...noteFor(body.title, id), properties: body.properties }, 201);
    }
    if (url.includes("/api/spaces/s1/objects?")) {
      if (failRead) {
        return jsonResponse(
          { error: { code: "read_failed", message: "The day's records could not be read." } },
          500,
        );
      }
      const day = filterTitle(url);
      if (readDelay && init?.method !== "POST") {
        return new Promise<Response>((resolve) =>
          setTimeout(
            () =>
              resolve(
                jsonResponse({
                  view: "table",
                  total: day && days[day] ? 1 : 0,
                  offset: 0,
                  limit: 1,
                  has_more: false,
                  objects: day && days[day] ? [noteFor(day, days[day] as string)] : [],
                }),
              ),
            readDelay,
          ),
        );
      }
      const id = day ? days[day] : undefined;
      return jsonResponse({
        view: "table",
        total: id ? 1 : 0,
        offset: 0,
        limit: 1,
        has_more: false,
        objects: day && id ? [noteFor(day, id)] : [],
      });
    }
    throw new Error(`unstubbed ${url}`);
  });
  return { fetchMock, written, attempts: () => attempts };
}

/** The URL the router ended on, as the address bar would show it. */
function Where() {
  return <p>{`at ${useLocation().pathname}`}</p>;
}

/** A stand-in record page: it proves the redirect and offers one day to click. */
function RecordStub() {
  const { objectId } = useParams();
  return (
    <div>
      <p>{`record ${objectId}`}</p>
      <Link to="/s/s1/daily/2026-11-05">next day</Link>
    </div>
  );
}

function renderAt(path: string, strict = false) {
  return renderWithProviders(
    <Routes>
      <Route path="/s/:spaceId/daily" element={<DailyPage />} />
      <Route path="/s/:spaceId/daily/:date" element={<DailyDayPage />} />
      <Route path="/s/:spaceId/o/:objectId" element={<RecordStub />} />
    </Routes>,
    { route: path, strict },
  );
}

/** The redirect only needs somewhere to land; the probe names it. */
function renderRedirect(path: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/s/:spaceId/daily" element={<DailyPage />} />
      <Route path="/s/:spaceId/daily/:date" element={<Where />} />
    </Routes>,
    { route: path },
  );
}

describe("DailyPage", () => {
  it("replaces itself with today's day, in the space's zone", async () => {
    stubDaily();
    renderRedirect("/s/s1/daily");
    await screen.findByText(`at /s/s1/daily/${today}`);
  });
});

describe("DailyDayPage", () => {
  it("opens the note the day already holds", async () => {
    stubDaily({ notes: { [today]: "o1" } });
    renderAt(`/s/s1/daily/${today}`);
    await screen.findByText("record o1");
  });

  it("writes today's note once, with the type's defaults", async () => {
    const { fetchMock, written } = stubDaily();
    renderAt(`/s/s1/daily/${today}`);
    await screen.findByText(`record new-${today}`, undefined, { timeout: 3000 });
    const posts = fetchMock.mock.calls.filter(
      ([input, init]) =>
        requestUrl(input).endsWith("/api/spaces/s1/objects") && init?.method === "POST",
    );
    expect(posts).toHaveLength(1);
    expect(written).toEqual([
      { type: "journal", title: today, properties: { mood: "ok" }, body: "" },
    ]);
  });

  it("writes today's note once even when the tree mounts its effects twice", async () => {
    // The app renders under StrictMode, which re-runs every effect on mount;
    // a guard that resets there writes a second note for the same day.
    const { written } = stubDaily();
    renderAt(`/s/s1/daily/${today}`, true);
    await screen.findByText(`record new-${today}`, undefined, { timeout: 3000 });
    expect(written).toHaveLength(1);
  });

  it("never writes while the day's own read is still in flight", async () => {
    // A warm navigation reaches the page with the space already cached, so the
    // day's read is the only thing pending — and a note that already exists is
    // not yet known. Writing then would leave a duplicate.
    const { written } = stubDaily({ notes: { [today]: "o1" }, readDelay: 60 });
    renderAt(`/s/s1/daily/${today}`);
    await screen.findByText("record o1");
    expect(written).toHaveLength(0);
  });

  it("offers another day instead of writing it on arrival", async () => {
    const { written } = stubDaily();
    renderAt("/s/s1/daily/2026-11-05");
    await screen.findByText("Nothing written for this day yet.");
    // The page header names the day; the card's own title is the record's date.
    expect(screen.getByRole("heading", { name: "2026-11-05" })).toBeInTheDocument();
    expect(screen.getByText("Thursday, 5 November 2026")).toBeInTheDocument();
    // The month is the day's parent in the trail, and opens it in the Calendar.
    expect(screen.getByRole("link", { name: "November 2026" })).toHaveAttribute(
      "href",
      "/s/s1/calendar?month=2026-11",
    );
    expect(written).toHaveLength(0);
    expect(screen.queryByText("Due that day")).not.toBeInTheDocument();
  });

  it("writes a chosen day when the reader asks, and opens it", async () => {
    const { written } = stubDaily();
    renderAt("/s/s1/daily/2026-11-05");
    const write = await screen.findByRole("button", { name: "Write this day's note" });
    expect(written).toHaveLength(0);
    await waitFor(() => expect(write).toBeEnabled());
    fireEvent.click(write);
    await waitFor(() => expect(written).toHaveLength(1));
    await screen.findByText("record new-2026-11-05", undefined, { timeout: 3000 });
    expect(written).toEqual([
      { type: "journal", title: "2026-11-05", properties: { mood: "ok" }, body: "" },
    ]);
  });

  it("holds the write until the day's read answers, so one day keeps one note", async () => {
    const { written, attempts } = stubDaily({ readDelay: 400 });
    renderAt("/s/s1/daily/2026-11-05");
    const write = await screen.findByRole("button", { name: "Write this day's note" });
    await waitFor(() => expect(write).toBeEnabled());

    fireEvent.click(write);
    await screen.findByText("Writing this day's note…");
    // The POST has answered; the day's read has not. The card must not offer
    // the action again in that gap.
    expect(
      screen.queryByRole("button", { name: "Write this day's note" }),
    ).not.toBeInTheDocument();
    // A detached button's handler still runs; the guard is what stops it.
    fireEvent.click(write);
    expect(attempts()).toBe(1);
    expect(written).toHaveLength(1);

    await screen.findByText("record new-2026-11-05", undefined, { timeout: 3000 });
    expect(written).toHaveLength(1);
  });

  it("offers another try when a past day's write is refused", async () => {
    const { attempts } = stubDaily({ failWrite: true });
    renderAt("/s/s1/daily/2026-11-05");
    const write = await screen.findByRole("button", { name: "Write this day's note" });
    await waitFor(() => expect(write).toBeEnabled());
    fireEvent.click(write);

    await screen.findByText("This day's note could not be created: The note could not be written.");
    const retry = screen.getByRole("button", { name: "Try again" });
    fireEvent.click(retry);
    await waitFor(() => expect(attempts()).toBe(2));
  });

  it("tells a viewer an editor writes the day", async () => {
    const { written } = stubDaily({ role: "viewer" });
    renderAt("/s/s1/daily/2026-11-05");
    await screen.findByText("An editor can write this day's note.");
    expect(written).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Write this day's note" })).not.toBeInTheDocument();
  });

  it("refuses a day that is not a date", async () => {
    const { written } = stubDaily();
    renderAt("/s/s1/daily/2026-02-30");
    await screen.findByRole("heading", { name: "Not a day" });
    expect(screen.getByText(/“2026-02-30” is not a date\./)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open today" })).toHaveAttribute(
      "href",
      "/s/s1/daily",
    );
    expect(written).toHaveLength(0);
  });

  it("keeps the previous day's note from opening under a new day", async () => {
    // Day A's read holds a record; stepping to day B must not redirect to it
    // while B's own read is still loading.
    stubDaily({ notes: { "2026-11-04": "o1" } });
    renderAt("/s/s1/daily/2026-11-04");
    await screen.findByText("record o1");
    fireEvent.click(screen.getByRole("link", { name: "next day" }));
    await screen.findByText("Nothing written for this day yet.");
    expect(screen.queryByText("record o1")).not.toBeInTheDocument();
  });

  it("states a failed day read instead of reading for ever", async () => {
    stubDaily({ failRead: true });
    renderAt("/s/s1/daily/2026-11-05");
    await screen.findByRole("heading", { name: "Could not load right now" });
    expect(screen.getByText("The day's records could not be read.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByText(/Reading this day's note/)).not.toBeInTheDocument();
  });

  it("does not call a day unwritten before its read answers", async () => {
    stubDaily({ readDelay: 120 });
    renderAt("/s/s1/daily/2026-11-05");
    expect(await screen.findByText("Reading")).toBeInTheDocument();
    expect(screen.queryByText("Not written")).not.toBeInTheDocument();
    await screen.findByText("Nothing written for this day yet.");
  });

  it("steps a day either side and names today", async () => {
    stubDaily();
    renderAt("/s/s1/daily/2026-11-05");
    await screen.findByText("Nothing written for this day yet.");
    expect(
      screen.getByRole("link", { name: `Previous day, ${dayLabel(shiftDay("2026-11-05", -1))}` }),
    ).toHaveAttribute("href", "/s/s1/daily/2026-11-04");
    expect(
      screen.getByRole("link", { name: `Next day, ${dayLabel(shiftDay("2026-11-05", 1))}` }),
    ).toHaveAttribute("href", "/s/s1/daily/2026-11-06");
    expect(
      within(screen.getByRole("navigation", { name: "Day" })).getByRole("link", { name: "Today" }),
    ).toHaveAttribute("href", `/s/s1/daily/${today}`);
  });

  it("writes today when the rail brings the reader back to it", async () => {
    const { written } = stubDaily();
    renderAt("/s/s1/daily/2026-11-05");
    await screen.findByText("Nothing written for this day yet.");
    const rail = within(screen.getByRole("navigation", { name: "Day" }));
    fireEvent.click(rail.getByRole("link", { name: "Today" }));
    await screen.findByText(`record new-${today}`, undefined, { timeout: 3000 });
    expect(written).toEqual([
      { type: "journal", title: today, properties: { mood: "ok" }, body: "" },
    ]);
  });

  it("marks today rather than linking to it", async () => {
    stubDaily({ role: "viewer" });
    renderAt(`/s/s1/daily/${today}`);
    await screen.findByText("An editor can write this day's note.");
    const rail = within(screen.getByRole("navigation", { name: "Day" }));
    expect(rail.queryByRole("link", { name: "Today" })).not.toBeInTheDocument();
    expect(rail.getByText("Today")).toBeInTheDocument();
  });

  it("lists the day's outstanding rows", async () => {
    stubDaily({
      due: [
        {
          id: "c1",
          type: "chore",
          type_name: "Chore",
          title: "Water the ferns",
          rev: 1,
          due_date: "2026-11-05",
          status: "overdue",
          days_until_due: -2,
        },
      ],
    });
    renderAt("/s/s1/daily/2026-11-05");
    await screen.findByText("Due that day");
    expect(screen.getByRole("link", { name: /Water the ferns/ })).toHaveAttribute(
      "href",
      "/s/s1/o/c1",
    );
    expect(screen.getByText("Overdue 2d")).toBeInTheDocument();
  });

  it("completes a due row from the day card", async () => {
    const { fetchMock } = stubDaily({
      due: [
        {
          id: "c1",
          type: "chore",
          type_name: "Chore",
          title: "Water the ferns",
          rev: 1,
          due_date: "2026-11-05",
          status: "overdue",
          days_until_due: -2,
        },
      ],
    });
    renderAt("/s/s1/daily/2026-11-05");
    fireEvent.click(await screen.findByRole("button", { name: "Done Water the ferns" }));
    await screen.findByText("Next due 2026-11-08 for “Water the ferns”.");
    const posts = fetchMock.mock.calls.filter(
      ([input, init]) =>
        requestUrl(input).endsWith("/objects/c1/complete") && init?.method === "POST",
    );
    expect(posts).toHaveLength(1);
    expect(JSON.parse(String(posts[0]?.[1]?.body))).toEqual({ rev: 1 });
  });

  it("leaves a viewer's due rows as reads", async () => {
    stubDaily({
      role: "viewer",
      due: [
        {
          id: "c1",
          type: "chore",
          type_name: "Chore",
          title: "Water the ferns",
          rev: 1,
          due_date: "2026-11-05",
          status: "overdue",
          days_until_due: -2,
        },
      ],
    });
    renderAt("/s/s1/daily/2026-11-05");
    await screen.findByText("Due that day");
    expect(screen.queryByRole("button", { name: /Done|Complete/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Snooze/ })).toBeNull();
  });

  it("names a daily type that no longer exists", async () => {
    stubDaily({ typeList: [] });
    renderAt(`/s/s1/daily/${today}`);
    await screen.findByText(/daily note type \(journal\) is missing/);
  });

  it("names a space with no daily note", async () => {
    stubDaily({ dailyType: null });
    renderAt(`/s/s1/daily/${today}`);
    await screen.findByText(
      "No type is set as this space's daily note yet. An owner chooses one in space settings.",
    );
  });
});
