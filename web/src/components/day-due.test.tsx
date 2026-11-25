import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { queryKeys } from "@/api/queries";
import { DayDue } from "@/components/day-due";
import {
  jsonResponse,
  renderWithProviders,
  requestUrl,
  stubFetch,
  testQueryClient,
} from "@/test/harness";

const overdue = {
  id: "c1",
  type: "chore",
  type_name: "Chore",
  title: "Water the monstera",
  rev: 1,
  due_date: "2026-11-22",
  status: "overdue",
  days_until_due: -1,
  recurrence: "Every 3 days",
};

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

const detail = {
  id: "c1",
  type: "chore",
  title: "Water the monstera",
  rev: 1,
  created_at: "2026-11-01T12:00:00Z",
  updated_at: "2026-11-22T12:00:00Z",
  created_by: "u1",
  updated_by: "u1",
  properties: { due_date: { value: "2026-11-22" } },
  body: "",
  missing_relations: [],
};

function renderDue(queryClient = testQueryClient(), today = "2026-11-22") {
  return renderWithProviders(<DayDue spaceId="s1" day="2026-11-22" today={today} />, {
    route: "/s/s1/daily/2026-11-22",
    queryClient,
  });
}

/** The same day, as an editor sees it: the row's actions are on the row. */
function renderDueAsEditor() {
  return renderWithProviders(
    <DayDue spaceId="s1" day="2026-11-22" today="2026-11-22" canEdit />,
    { route: "/s/s1/daily/2026-11-22" },
  );
}

function stubAgenda(extra: (url: string, init?: RequestInit) => Response | null = () => null) {
  return stubFetch((input, init) => {
    const url = requestUrl(input);
    if (url.includes("/api/spaces/s1/agenda?")) {
      return jsonResponse({ today: "2026-11-22", timezone: "UTC", rows: [overdue] });
    }
    const matched = extra(url, init);
    if (matched) {
      return matched;
    }
    throw new Error(`unstubbed ${url}`);
  });
}

describe("DayDue", () => {
  it("lists the day's outstanding rows as links to them", async () => {
    stubFetch((input) => {
      const url = requestUrl(input);
      if (url.includes("/api/spaces/s1/agenda?")) {
        return jsonResponse({ today: "2026-11-22", timezone: "UTC", rows: [overdue] });
      }
      throw new Error(`unstubbed ${url}`);
    });
    renderDue();
    expect(await screen.findByText("Due today")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Water the monstera/ })).toHaveAttribute(
      "href",
      "/s/s1/o/c1",
    );
    expect(screen.getByText("Overdue 1d")).toBeInTheDocument();
    expect(screen.getByText("Chore")).toBeInTheDocument();
  });

  it("names another day as that day, not today", async () => {
    stubFetch((input) => {
      const url = requestUrl(input);
      if (url.includes("/api/spaces/s1/agenda?")) {
        return jsonResponse({ today: "2026-11-23", timezone: "UTC", rows: [overdue] });
      }
      throw new Error(`unstubbed ${url}`);
    });
    renderDue(testQueryClient(), "2026-11-23");
    expect(await screen.findByText("Due that day")).toBeInTheDocument();
    expect(screen.queryByText("Due today")).not.toBeInTheDocument();
  });

  it("says nothing on a day with no outstanding work", () => {
    // Seeded rather than fetched, so the absence is the settled answer and not
    // a render that simply has not heard back yet.
    const client = testQueryClient();
    client.setQueryData(queryKeys.agenda("s1", { from: "2026-11-22", to: "2026-11-22" }), {
      today: "2026-11-22",
      timezone: "UTC",
      rows: [],
    });
    renderDue(client);
    expect(screen.queryByText(/Due (today|that day)/)).not.toBeInTheDocument();
  });

  it("offers a viewer the row without the completion or the alarm", async () => {
    stubAgenda();
    renderDue();
    await screen.findByText("Water the monstera");
    expect(screen.queryByRole("button", { name: /Done|Complete/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Snooze/ })).toBeNull();
  });

  it("completes a row where it is listed, with the type's verb and Undo", async () => {
    const fetchMock = stubAgenda((url, init) => {
      if (url.endsWith("/api/spaces/s1/types/chore")) {
        return jsonResponse(choreType);
      }
      if (url.endsWith("/api/spaces/s1/objects/c1/complete") && init?.method === "POST") {
        return jsonResponse({
          ...detail,
          rev: 2,
          schedule: { due_date: "2026-11-25", status: "upcoming", days_until_due: 3 },
        });
      }
      if (url.endsWith("/api/spaces/s1/objects/c1")) {
        return jsonResponse(detail);
      }
      return null;
    });
    renderDueAsEditor();
    fireEvent.click(await screen.findByRole("button", { name: "Done Water the monstera" }));
    await screen.findByText("Next due 2026-11-25 for “Water the monstera”.");
    const posts = fetchMock.mock.calls.filter(
      ([input, init]) =>
        requestUrl(input).endsWith("/complete") && init?.method === "POST",
    );
    expect(posts).toHaveLength(1);
    expect(JSON.parse(String(posts[0]?.[1]?.body))).toEqual({ rev: 1 });
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
  });
});
