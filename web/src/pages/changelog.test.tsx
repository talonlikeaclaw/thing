import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChangelogPage } from "@/pages/changelog";
import { renderWithProviders } from "@/test/harness";

describe("ChangelogPage", () => {
  it("groups the newest release under headings with context", () => {
    renderWithProviders(<ChangelogPage />, { route: "/changelog" });

    const first = screen.getByRole("heading", { name: "Add, edit and find properties" });
    expect(first).toBeInTheDocument();
    expect(first.closest("details")).not.toBeNull();
    expect(
      screen.getByRole("heading", { name: "Filter, sort and choose columns" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Convert a column into a relation" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/The plan names every value/),
    ).toBeInTheDocument();
  });

  it("keeps the older flat lists and their folded details", () => {
    renderWithProviders(<ChangelogPage />, { route: "/changelog" });

    const older = document.getElementById("v-0.7.0");
    expect(older).not.toBeNull();
    expect(
      within(older as HTMLElement).getByText(/A record holds a set of files/),
    ).toBeInTheDocument();
    expect(
      within(older as HTMLElement).getByText(/more changes/),
    ).toBeInTheDocument();
  });
});
