import { fireEvent, screen } from "@testing-library/react";
import { Route, Routes, useLocation, useParams } from "react-router";
import { describe, expect, it } from "vitest";

import { DayStrip, useDayHotkeys } from "@/components/day-strip";
import { renderWithProviders } from "@/test/harness";

/**
 * A stand-in for the day surface: the day comes from the URL, exactly as the
 * page reads it, so stepping twice lands where the real page would.
 */
function Probe({ day, today = "2026-11-23" }: { day?: string | null; today?: string }) {
  const params = useParams();
  const shown = day === undefined ? (params.date ?? null) : day;
  useDayHotkeys({ spaceId: "s1", day: shown, today });
  const at = useLocation();
  return <p>{`at ${at.pathname}`}</p>;
}

function renderProbe(day?: string | null) {
  return renderWithProviders(
    <Routes>
      <Route path="/s/:spaceId/daily/:date" element={<Probe day={day} />} />
    </Routes>,
    { route: "/s/s1/daily/2026-11-05" },
  );
}

describe("day rail", () => {
  it("steps a day either side and returns to today", async () => {
    renderProbe();
    fireEvent.keyDown(window, { key: "]" });
    await screen.findByText("at /s/s1/daily/2026-11-06");
    fireEvent.keyDown(window, { key: "[" });
    await screen.findByText("at /s/s1/daily/2026-11-05");
    fireEvent.keyDown(window, { key: "t" });
    await screen.findByText("at /s/s1/daily/2026-11-23");
  });

  it("leaves the keys alone while a field has them", async () => {
    renderProbe();
    const field = document.createElement("input");
    document.body.appendChild(field);
    fireEvent.keyDown(field, { key: "]" });
    expect(screen.getByText("at /s/s1/daily/2026-11-05")).toBeInTheDocument();
    field.remove();
  });

  it("binds nothing on a surface that is not a day", () => {
    renderProbe(null);
    fireEvent.keyDown(window, { key: "]" });
    expect(screen.getByText("at /s/s1/daily/2026-11-05")).toBeInTheDocument();
  });

  it("names the adjacent days and marks the one it is on", () => {
    renderWithProviders(<DayStrip spaceId="s1" day="2026-11-23" today="2026-11-23" />, {
      route: "/s/s1/daily/2026-11-23",
    });
    expect(screen.getByRole("link", { name: "Previous day, Sun 22 Nov" })).toHaveAttribute(
      "href",
      "/s/s1/daily/2026-11-22",
    );
    expect(screen.getByRole("link", { name: "Next day, Tue 24 Nov" })).toHaveAttribute(
      "href",
      "/s/s1/daily/2026-11-24",
    );
    // Today is where the reader already is, so it is a state, not a link —
    // announced as the current date in the journal's run of days.
    expect(screen.queryByRole("link", { name: "Today" })).not.toBeInTheDocument();
    expect(screen.getByText("Today")).toHaveAttribute("aria-current", "date");
  });
});
