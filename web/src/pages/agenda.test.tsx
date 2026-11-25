import { screen } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router";
import { describe, expect, it } from "vitest";

import { formatDay } from "@/lib/display";
import { AgendaPage } from "@/pages/agenda";
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
  type_count: 1,
};

function Where() {
  const at = useLocation();
  return <p>{`at ${at.pathname}${at.search}`}</p>;
}

describe("AgendaPage", () => {
  it("opens a row's due date as that day, and links the Calendar", async () => {
    stubFetch((input) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/auth/me")) {
        return jsonResponse({ id: "u1", email: "a@b.c", name: "Talen" });
      }
      if (url.endsWith("/api/spaces/s1")) {
        return jsonResponse(space);
      }
      if (url.endsWith("/api/spaces/s1/types")) {
        return jsonResponse([
          {
            key: "chore",
            name: "Chore",
            name_plural: "Chores",
            description: "",
            schedule: true,
            property_count: 0,
            object_count: 1,
          },
        ]);
      }
      if (url.endsWith("/api/spaces/s1/types/chore")) {
        return jsonResponse({
          key: "chore",
          name: "Chore",
          name_plural: "Chores",
          icon: null,
          description: "",
          schedule: true,
          properties: [],
          views: [],
          default_view: "table",
        });
      }
      if (url.includes("/api/spaces/s1/agenda?")) {
        return jsonResponse({
          today: "2026-11-23",
          timezone: "UTC",
          rows: [
            {
              id: "c1",
              type: "chore",
              type_name: "Chore",
              type_icon: null,
              title: "Sweep the balcony",
              rev: 1,
              due_date: "2026-11-25",
              status: "upcoming",
              days_until_due: 2,
            },
          ],
        });
      }
      throw new Error(`unstubbed ${url}`);
    });
    renderWithProviders(
      <Routes>
        <Route path="/s/:spaceId/agenda" element={<AgendaPage />} />
      </Routes>,
      { route: "/s/s1/agenda" },
    );

    expect(await screen.findByRole("link", { name: formatDay("2026-11-25") })).toHaveAttribute(
      "href",
      "/s/s1/daily/2026-11-25",
    );
    expect(screen.getByRole("link", { name: "Calendar" })).toHaveAttribute(
      "href",
      "/s/s1/calendar",
    );
  });

  it("sends the old Schedule calendar address to the space Calendar", async () => {
    stubFetch((input) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/auth/me")) {
        return jsonResponse({ id: "u1", email: "a@b.c", name: "Talen" });
      }
      if (url.endsWith("/api/spaces/s1")) {
        return jsonResponse(space);
      }
      if (url.endsWith("/api/spaces/s1/types")) {
        return jsonResponse([]);
      }
      if (url.includes("/api/spaces/s1/agenda?")) {
        return jsonResponse({ today: "2026-10-30", timezone: "UTC", rows: [] });
      }
      throw new Error(`unstubbed ${url}`);
    });
    renderWithProviders(
      <Routes>
        <Route path="/s/:spaceId/agenda" element={<AgendaPage />} />
        <Route path="/s/:spaceId/calendar" element={<Where />} />
      </Routes>,
      { route: "/s/s1/agenda?view=calendar&month=2026-10&types=chore" },
    );

    await screen.findByText("at /s/s1/calendar?month=2026-10&types=chore");
  });
});
