import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { TypeDef, ViewDef } from "@/api/types";
import { ViewSettings } from "@/components/views/view-settings";
import { jsonResponse, renderWithProviders, requestUrl, stubFetch } from "@/test/harness";

const table: ViewDef = {
  key: "all",
  name: "All",
  kind: "table",
  sorts: [],
  filter: { op: "and", conditions: [] },
  columns: ["title", "amount"],
};

function plant(view: ViewDef = table): TypeDef {
  return {
    key: "plant",
    name: "Plant",
    name_plural: "Plants",
    description: "",
    schedule: false,
    properties: [],
    views: [view],
    default_view: "all",
  };
}

/** The settings over one view, with the PATCH body the switch wrote. */
function renderSettings(view: ViewDef = table) {
  let body: Record<string, unknown> | null = null;
  stubFetch((input, init) => {
    const url = requestUrl(input);
    if ((init?.method ?? "GET") === "PATCH") {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse(
        plant({
          ...view,
          footer: body?.footer === false ? false : undefined,
          footer_hidden: Array.isArray(body?.footer_hidden)
            ? (body.footer_hidden as string[])
            : undefined,
        }),
      );
    }
    throw new Error(`unstubbed ${url}`);
  });
  renderWithProviders(
    <ViewSettings
      spaceId="s1"
      type={plant(view)}
      view={view}
      properties={[{ key: "amount", name: "Amount", format: "number" }]}
      onClose={() => undefined}
      onDeleted={() => undefined}
    />,
  );
  return () => body;
}

describe("ViewSettings summaries", () => {
  it("turns the band off from the summary band switch", async () => {
    const body = renderSettings();
    const summary = screen.getByRole("checkbox", { name: /Summary band/ });

    expect(summary).toBeChecked();
    fireEvent.click(summary);

    await waitFor(() => expect(body()).not.toBeNull());
    expect(body()).toEqual({ footer: false });
  });

  it("turns the band back on with a null that restores the default", async () => {
    const hidden = { ...table, footer: false };
    const body = renderSettings(hidden);
    const summary = screen.getByRole("checkbox", { name: /Summary band/ });

    expect(summary).not.toBeChecked();
    fireEvent.click(summary);

    await waitFor(() => expect(body()).not.toBeNull());
    expect(body()).toEqual({ footer: null });
  });
});

describe("ViewSettings name", () => {
  it("renames with the button beside the field", async () => {
    const body = renderSettings();
    const button = screen.getByRole("button", { name: "Rename" });
    expect(button).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Everything" } });
    expect(button).toBeEnabled();
    fireEvent.click(button);

    await waitFor(() => expect(body()).not.toBeNull());
    expect(body()).toEqual({ name: "Everything" });
  });
});

describe("ViewSettings summary band", () => {
  it("hides the per-column list while the band is off", () => {
    renderSettings({ ...table, footer: false });

    expect(screen.getByRole("checkbox", { name: /Summary band/ })).not.toBeChecked();
    expect(
      screen.queryByRole("checkbox", { name: "Summarise Amount" }),
    ).not.toBeInTheDocument();
  });
});

describe("ViewSettings summarised columns", () => {
  it("turns one column's summary off without touching the others", async () => {
    const body = renderSettings();
    fireEvent.click(screen.getByRole("checkbox", { name: "Summarise Amount" }));

    await waitFor(() => expect(body()).not.toBeNull());
    expect(body()).toEqual({ footer_hidden: ["amount"] });
  });

  it("turns a hidden summary back on", async () => {
    const body = renderSettings({ ...table, footer_hidden: ["amount"] });
    const amount = screen.getByRole("checkbox", { name: "Summarise Amount" });

    expect(amount).not.toBeChecked();
    fireEvent.click(amount);

    await waitFor(() => expect(body()).not.toBeNull());
    expect(body()).toEqual({ footer_hidden: [] });
  });
});

describe("ViewSettings summary measures", () => {
  it("writes the measure chosen for one column", async () => {
    const body = renderSettings();
    const measure = screen.getByLabelText("Summary for Amount") as HTMLSelectElement;

    expect(measure.value).toBe("");
    fireEvent.change(measure, { target: { value: "highest" } });

    await waitFor(() => expect(body()).not.toBeNull());
    expect(body()).toEqual({ footer_summary: { amount: "highest" } });
  });

  it("clears the choice back to the format's default", async () => {
    const body = renderSettings({ ...table, footer_summary: { amount: "highest" } });
    const measure = screen.getByLabelText("Summary for Amount") as HTMLSelectElement;

    expect(measure.value).toBe("highest");
    fireEvent.change(measure, { target: { value: "" } });

    await waitFor(() => expect(body()).not.toBeNull());
    expect(body()).toEqual({ footer_summary: {} });
  });
});
