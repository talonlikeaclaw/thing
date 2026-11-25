import { fireEvent, screen, within } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router";
import { describe, expect, it } from "vitest";

import { CalendarPage, DailyCalendarRedirect } from "@/pages/calendar";
import { weekDays, weekStart } from "@/lib/calendar";
import { longDayLabel } from "@/lib/daily";
import { formatDay } from "@/lib/display";
import { shiftDay, todayIn } from "@/lib/timezone";
import { monthName, monthOf } from "@/lib/views";
import { jsonResponse, renderWithProviders, requestUrl, stubFetch } from "@/test/harness";

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
  type_count: 2,
};

const types = [
  {
    key: "journal",
    name: "Journal",
    name_plural: "Journals",
    description: "",
    schedule: false,
    property_count: 0,
    object_count: 0,
  },
  {
    key: "chore",
    name: "Chore",
    name_plural: "Chores",
    description: "",
    schedule: true,
    property_count: 0,
    object_count: 0,
  },
];

const choreType = {
  key: "chore",
  name: "Chore",
  name_plural: "Chores",
  icon: null,
  description: "",
  schedule: true,
  properties: [],
  views: [],
  default_view: "table",
};

const today = todayIn("UTC");
const month = monthOf(today);
const monday = weekStart(today);
const week = weekDays(monday);
const daysThisMonth = new Date(
  Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0),
).getUTCDate();

function note(title: string, id: string) {
  return {
    id,
    type: "journal",
    title,
    rev: 1,
    updated_at: "2026-11-20T06:00:00Z",
    values: {},
    missing_relations: [],
  };
}

function dueRow(day: string, id = "c1", title = "Water the ferns") {
  return {
    id,
    type: "chore",
    type_name: "Chore",
    type_icon: null,
    title,
    rev: 1,
    due_date: day,
    status: "upcoming",
    days_until_due: 0,
  };
}

function page(objects: unknown[]) {
  return {
    view: "table",
    total: objects.length,
    offset: 0,
    limit: 500,
    has_more: false,
    objects,
  };
}

interface StubOptions {
  role?: string;
  dailyType?: string | null;
  typeList?: unknown[];
  notes?: unknown[];
  runNotes?: unknown[];
  due?: unknown[];
  /** Refuse the notes read, as a disk or server failure would. */
  notesError?: boolean;
  /** Hold the notes and agenda reads, as a cold read does. */
  delay?: number;
}

/**
 * The calendar's reads share one route; the run is the only one that asks for
 * 90 rows, so the limit names the read exactly as the page keys it.
 */
function stubCalendar({
  role = "owner",
  dailyType = "journal",
  typeList = types,
  notes = [],
  runNotes = [],
  due = [],
  notesError = false,
  delay = 0,
}: StubOptions = {}) {
  return stubFetch((input, init) => {
    const url = requestUrl(input);
    if (url.endsWith("/api/auth/me")) {
      return jsonResponse({ id: "u1", email: "a@b.c", name: "Talen" });
    }
    if (url.endsWith("/api/spaces/s1") && init?.method !== "PATCH") {
      return jsonResponse({ ...space, role, daily_type: dailyType });
    }
    if (url.endsWith("/api/spaces/s1/types")) {
      return jsonResponse(typeList);
    }
    if (/\/api\/spaces\/s1\/types\/[^/?]+$/.test(url)) {
      return jsonResponse(choreType);
    }
    if (url.includes("/api/spaces/s1/agenda?")) {
      const body = { today, timezone: "UTC", rows: due };
      if (delay === 0) {
        return jsonResponse(body);
      }
      // `lib` is pinned to ES2022, so `Promise.withResolvers` is not typed;
      // the executor form is the one that compiles here.
      return new Promise<Response>((resolve) =>
        setTimeout(() => resolve(jsonResponse(body)), delay),
      );
    }
    if (url.includes("/api/spaces/s1/objects?")) {
      const limit = new URL(url, "http://test").searchParams.get("limit");
      if (notesError && limit !== "90") {
        return jsonResponse(
          { error: { code: "io", message: "The notes could not be read." } },
          500,
        );
      }
      const body = page(limit === "90" ? runNotes : notes);
      if (delay === 0) {
        return jsonResponse(body);
      }
      return new Promise<Response>((resolve) =>
        setTimeout(() => resolve(jsonResponse(body)), delay),
      );
    }
    throw new Error(`unstubbed ${url}`);
  });
}

/** The address bar, so a month or shape change can prove the URL it wrote. */
function Where() {
  const at = useLocation();
  return <p>{`at ${at.pathname}${at.search}`}</p>;
}

function renderCalendar(path = `/s/s1/calendar?month=${month}`) {
  return renderWithProviders(
    <Routes>
      <Route
        path="/s/:spaceId/calendar"
        element={
          <>
            <CalendarPage />
            <Where />
          </>
        }
      />
    </Routes>,
    { route: path },
  );
}

describe("CalendarPage — month", () => {
  it("marks the days with notes and states the month's count", async () => {
    stubCalendar({ notes: [note(`${month}-05`, "n1"), note(`${month}-06`, "n2")] });
    renderCalendar();
    const first = await screen.findByRole("link", { name: `Note: ${month}-05` });
    expect(first).toHaveAttribute("href", "/s/s1/o/n1");
    expect(screen.getByRole("link", { name: `Note: ${month}-06` })).toHaveAttribute(
      "href",
      "/s/s1/o/n2",
    );
    expect(
      screen.getByText(`2 of ${daysThisMonth} days written in ${monthName(month)}`),
    ).toBeInTheDocument();
  });

  it("states the run of consecutive written days", async () => {
    stubCalendar({ runNotes: [note(today, "r1"), note(shiftDay(today, -1), "r2")] });
    renderCalendar();
    await screen.findByText("2-day run");
  });

  it("leaves the run out under a month that does not contain today", async () => {
    const earlier = monthOf(shiftDay(`${month}-01`, -1));
    const daysInEarlier = new Date(
      Date.UTC(Number(earlier.slice(0, 4)), Number(earlier.slice(5, 7)), 0),
    ).getUTCDate();
    stubCalendar({ runNotes: [note(today, "r1"), note(shiftDay(today, -1), "r2")] });
    renderCalendar(`/s/s1/calendar?month=${earlier}`);
    await screen.findByText(`0 of ${daysInEarlier} days written in ${monthName(earlier)}`);
    expect(screen.queryByText(/day run/)).not.toBeInTheDocument();
  });

  it("states a failed notes read with a retry instead of an empty month", async () => {
    stubCalendar({ notesError: true });
    renderCalendar();
    await screen.findByText("The notes could not be read.");
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("opens the day panel's own date as that day", async () => {
    stubCalendar({ notes: [note(`${month}-05`, "n1")] });
    renderCalendar();
    await screen.findByRole("link", { name: `Note: ${month}-05` });
    fireEvent.click(screen.getByRole("button", { name: `Records on ${formatDay(`${month}-05`)}` }));
    const panel = await screen.findByRole("dialog", { name: /Records on/ });
    expect(
      within(panel).getByRole("link", { name: formatDay(`${month}-05`) }),
    ).toHaveAttribute("href", `/s/s1/daily/${month}-05`);
  });

  it("marks a day with the rows still due on it", async () => {
    stubCalendar({ due: [dueRow(`${month}-07`)] });
    renderCalendar();
    await screen.findByText("1 due");
  });

  it("lists the day's note, its outstanding rows and the write action", async () => {
    stubCalendar({
      notes: [note(`${month}-05`, "n1")],
      due: [
        {
          ...dueRow(`${month}-05`),
          status: "overdue",
          days_until_due: -2,
        },
      ],
    });
    renderCalendar();
    await screen.findByRole("link", { name: `Note: ${month}-05` });
    fireEvent.click(screen.getByRole("button", { name: `Records on ${formatDay(`${month}-05`)}` }));
    const panel = await screen.findByRole("dialog", { name: /Records on/ });
    expect(within(panel).getByRole("link", { name: `Note: ${month}-05` })).toHaveAttribute(
      "href",
      "/s/s1/o/n1",
    );
    expect(within(panel).getByText("Water the ferns")).toBeInTheDocument();
    expect(within(panel).getByText("Overdue 2d")).toBeInTheDocument();
    // The panel names the day's work for the day it is: this one is not today.
    expect(within(panel).getByText("Due that day")).toBeInTheDocument();
    // The written day needs no write action.
    expect(within(panel).queryByRole("link", { name: "Write this day's note" })).toBeNull();
  });

  it("names today's panel list as due today", async () => {
    stubCalendar({ due: [dueRow(today)] });
    renderCalendar();
    await screen.findByText("1 due");
    fireEvent.click(screen.getByRole("button", { name: `Records on ${formatDay(today)}` }));
    const panel = await screen.findByRole("dialog", { name: /Records on/ });
    expect(within(panel).getByText("Due today")).toBeInTheDocument();
    expect(within(panel).queryByText("Due that day")).toBeNull();
  });

  it("offers an editor the write action on a day with no note", async () => {
    stubCalendar();
    renderCalendar();
    await screen.findByText(`0 of ${daysThisMonth} days written in ${monthName(month)}`);
    fireEvent.click(screen.getByRole("button", { name: `Records on ${formatDay(`${month}-12`)}` }));
    const panel = await screen.findByRole("dialog", { name: /Records on/ });
    expect(within(panel).getByRole("link", { name: "Write this day's note" })).toHaveAttribute(
      "href",
      `/s/s1/daily/${month}-12`,
    );
  });

  it("offers a viewer no write and no completion", async () => {
    stubCalendar({
      role: "viewer",
      due: [dueRow(`${month}-07`)],
    });
    renderCalendar();
    await screen.findByText("1 due");
    fireEvent.click(screen.getByRole("button", { name: `Records on ${formatDay(`${month}-07`)}` }));
    const panel = await screen.findByRole("dialog", { name: /Records on/ });
    expect(within(panel).queryByRole("link", { name: "Write this day's note" })).toBeNull();
    expect(within(panel).queryByRole("button", { name: /Complete/ })).toBeNull();
  });

  it("leaves a renamed note out and says why the month is empty", async () => {
    stubCalendar({ notes: [note("Shopping list", "n1")] });
    renderCalendar();
    await screen.findByText(`Nothing written or due in ${monthName(month)}.`);
    expect(screen.getByText(/its title is the day it records/)).toBeInTheDocument();
    expect(screen.queryByText("Shopping list")).not.toBeInTheDocument();
  });

  it("puts the chosen month in the URL", async () => {
    stubCalendar();
    renderCalendar("/s/s1/calendar?month=2026-11");
    await screen.findByText("0 of 30 days written in November");
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    await screen.findByText("at /s/s1/calendar?month=2026-10");
  });
});

describe("CalendarPage — week", () => {
  it("shows seven days, with the note and the day's work", async () => {
    stubCalendar({ notes: [note(today, "n1")], due: [dueRow(today)] });
    renderCalendar(`/s/s1/calendar?view=week&week=${monday}`);

    await screen.findByText("1 of 7 days written this week");
    for (const day of week) {
      expect(screen.getByRole("region", { name: longDayLabel(day) })).toBeInTheDocument();
    }
    const todaySection = screen.getByRole("region", { name: longDayLabel(today) });
    expect(within(todaySection).getByRole("link", { name: `Note: ${today}` })).toHaveAttribute(
      "href",
      "/s/s1/o/n1",
    );
    // The day's work is one named group under its note, never loose rows.
    const work = within(todaySection).getByRole("region", { name: "Due" });
    expect(within(work).getByText("Water the ferns")).toBeInTheDocument();
    expect(screen.getByText("1 due")).toBeInTheDocument();
  });

  it("offers an editor the write action on each empty day", async () => {
    stubCalendar();
    renderCalendar(`/s/s1/calendar?view=week&week=${monday}`);
    const empty = week.find((day) => day !== today) as string;
    const section = await screen.findByRole("region", { name: longDayLabel(empty) });
    expect(within(section).getByRole("link", { name: "Write this day's note" })).toHaveAttribute(
      "href",
      `/s/s1/daily/${empty}`,
    );
  });

  it("carries the completion verb and the snooze menu for an editor", async () => {
    stubCalendar({ due: [dueRow(today)] });
    renderCalendar(`/s/s1/calendar?view=week&week=${monday}`);
    const section = await screen.findByRole("region", { name: longDayLabel(today) });
    expect(within(section).getByRole("button", { name: "Complete Water the ferns" })).toBeEnabled();
    expect(within(section).getByRole("button", { name: /Snooze/ })).toBeInTheDocument();
  });

  it("offers a viewer no actions", async () => {
    stubCalendar({ role: "viewer", due: [dueRow(today)] });
    renderCalendar(`/s/s1/calendar?view=week&week=${monday}`);
    const section = await screen.findByRole("region", { name: longDayLabel(today) });
    expect(within(section).queryByRole("button", { name: /Complete/ })).toBeNull();
    expect(within(section).queryByRole("button", { name: /Snooze/ })).toBeNull();
  });

  it("offers no day to write in a space without a journal", async () => {
    stubCalendar({ dailyType: null, due: [dueRow(today)] });
    renderCalendar(`/s/s1/calendar?view=week&week=${monday}`);
    await screen.findByText("Water the ferns");
    expect(screen.queryByRole("link", { name: "Write this day's note" })).toBeNull();
  });

  it("switches shape in the URL and keeps the reader's place", async () => {
    stubCalendar({ notes: [note(`${month}-05`, "n1")] });
    renderCalendar(`/s/s1/calendar?month=${month}`);
    await screen.findByRole("link", { name: `Note: ${month}-05` });
    fireEvent.click(screen.getByRole("button", { name: "Week" }));
    // The current month's first week is this week, which the base already names.
    await screen.findByText("at /s/s1/calendar?view=week");
    fireEvent.click(screen.getByRole("button", { name: "Month" }));
    await screen.findByText("at /s/s1/calendar");
  });

  it("reads a week's empty state in one sentence", async () => {
    stubCalendar();
    renderCalendar(`/s/s1/calendar?view=week&week=${monday}`);
    await screen.findByText("Nothing written or due this week.");
  });

  it("states that the week is reading instead of inviting a write", async () => {
    stubCalendar({ delay: 600 });
    renderCalendar(`/s/s1/calendar?view=week&week=${monday}`);
    expect(await screen.findByText(/Reading the week/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Write this day's note" })).toBeNull();
    await screen.findByRole(
      "link",
      { name: `Open ${longDayLabel(monday)}` },
      { timeout: 3000 },
    );
  });

  it("makes every day's number its address", async () => {
    stubCalendar();
    renderCalendar(`/s/s1/calendar?view=week&week=${monday}`);
    for (const day of week) {
      const link = await screen.findByRole("link", { name: `Open ${longDayLabel(day)}` });
      expect(link).toHaveAttribute("href", `/s/s1/daily/${day}`);
    }
  });

  it("settles a week address on its Monday", async () => {
    stubCalendar();
    renderCalendar(`/s/s1/calendar?view=week&week=${week[3]}`);
    await screen.findByText(`at /s/s1/calendar?view=week&week=${monday}`);
  });
});

describe("DailyCalendarRedirect", () => {
  it("carries the old journal month's address to the space calendar", async () => {
    renderWithProviders(
      <Routes>
        <Route path="/s/:spaceId/daily/calendar" element={<DailyCalendarRedirect />} />
        <Route path="/s/:spaceId/calendar" element={<Where />} />
      </Routes>,
      { route: "/s/s1/daily/calendar?month=2026-10" },
    );
    await screen.findByText("at /s/s1/calendar?month=2026-10");
  });
});
