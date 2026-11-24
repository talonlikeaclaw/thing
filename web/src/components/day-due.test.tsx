import { screen } from "@testing-library/react";
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

function renderDue(queryClient = testQueryClient()) {
  return renderWithProviders(<DayDue spaceId="s1" day="2026-11-22" />, {
    route: "/s/s1/daily/2026-11-22",
    queryClient,
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
    expect(await screen.findByText("Due that day")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Water the monstera/ })).toHaveAttribute(
      "href",
      "/s/s1/o/c1",
    );
    expect(screen.getByText("Overdue 1d")).toBeInTheDocument();
    expect(screen.getByText("Chore")).toBeInTheDocument();
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
    expect(screen.queryByText("Due that day")).not.toBeInTheDocument();
  });
});
