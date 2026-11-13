import { fireEvent, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/use-dirty-guard", () => ({
  useDirtyGuard: () => null,
}));

import type { PropertyDef, ViewDef } from "@/api/types";
import { HandednessProvider } from "@/components/handedness";
import { ColumnPanel } from "@/components/views/column-panel";
import { jsonResponse, renderWithProviders, requestUrl, stubFetch } from "@/test/harness";

const properties: PropertyDef[] = [
  { key: "room", name: "Room", format: "select" },
  { key: "bedroom", name: "Bedroom", format: "checkbox" },
  { key: "size", name: "Size", format: "number" },
];

const view: ViewDef = {
  key: "all",
  name: "All",
  kind: "table",
  sorts: [],
  filter: { op: "and", conditions: [] },
  columns: ["title", "room", "bedroom"],
  widths: { room: 160 },
};

/** The panel over one layout the host owns, like the type page. */
function Host() {
  const [current, setCurrent] = useState<ViewDef>(view);
  return (
    <div>
      <output data-testid="layout">{JSON.stringify(current.columns)}</output>
      <ColumnPanel
        spaceId="s1"
        typeKey="album"
        view={current}
        properties={properties}
        disabled={false}
        canEdit
        onPatch={(change) =>
          setCurrent((existing) => ({ ...existing, ...change }) as ViewDef)
        }
        onAddProperty={() => undefined}
      />
    </div>
  );
}

function published(): string[] {
  return JSON.parse(screen.getByTestId("layout").textContent ?? "[]") as string[];
}

describe("ColumnPanel", () => {
  it("narrows the shown and the hidden list with one search", () => {
    renderWithProviders(<Host />);
    expect(screen.getByText("3 of 3")).toBeInTheDocument();

    const field = screen.getByRole("searchbox", { name: "Search properties" });
    fireEvent.change(field, { target: { value: "bed" } });

    // "Bedroom" is shown and matches; nothing else survives either list.
    expect(screen.getByText("1 of 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide Bedroom" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hide Room" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show Size" })).not.toBeInTheDocument();

    fireEvent.change(field, { target: { value: "room" } });
    expect(screen.getByRole("button", { name: "Hide Room" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide Bedroom" })).toBeInTheDocument();
  });

  it("says so when no property matches", () => {
    renderWithProviders(<Host />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search properties" }), {
      target: { value: "zzz" },
    });
    expect(screen.getByText("0 of 3")).toBeInTheDocument();
    expect(screen.getByText("No hidden property matches “zzz”.")).toBeInTheDocument();
  });

  it("hides a shown column and shows a hidden one", () => {
    renderWithProviders(<Host />);

    fireEvent.click(screen.getByRole("button", { name: "Hide Room" }));
    expect(published()).toEqual(["title", "bedroom"]);

    fireEvent.click(screen.getByRole("button", { name: "Show Size" }));
    expect(published()).toEqual(["title", "bedroom", "size"]);
  });

  it("moves a column to any slot in one action", () => {
    renderWithProviders(<Host />);

    const position = screen.getByRole("button", { name: "Move Room: position 1 of 2" });
    fireEvent.click(position);
    expect(screen.getByRole("menu").closest("[data-align]")).toHaveAttribute(
      "data-align",
      "end",
    );
    const items = screen.getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining("Move to position 1"),
      expect.stringContaining("Move to position 2"),
    ]);

    fireEvent.click(screen.getByRole("menuitem", { name: "Move to position 2" }));
    expect(published()).toEqual(["title", "bedroom", "room"]);
  });

  it("puts the column selector on the thumb edge for each hand", () => {
    renderWithProviders(<Host />);
    const position = screen.getByRole("button", { name: "Move Room: position 1 of 2" });
    const hide = screen.getByRole("button", { name: "Hide Room" });
    expect(hide.compareDocumentPosition(position) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps the name ahead of its format in either hand", () => {
    renderWithProviders(
      <HandednessProvider value={{ handedness: "left", setHandedness: () => undefined }}>
        <Host />
      </HandednessProvider>,
    );

    const shown = screen.getByRole("button", { name: "Hide Room" }).closest("li");
    const name = within(shown as HTMLElement).getByText("Room");
    const chip = within(shown as HTMLElement).getByText("Select");
    expect(
      name.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("puts the fixed title's lock on the position selector's edge", () => {
    renderWithProviders(
      <HandednessProvider value={{ handedness: "left", setHandedness: () => undefined }}>
        <Host />
      </HandednessProvider>,
    );

    const lock = screen.getByText("Title is fixed first");
    const name = screen.getByText("Title");
    expect(
      lock.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("anchors the position menu to the chosen hand", () => {
    renderWithProviders(
      <HandednessProvider value={{ handedness: "left", setHandedness: () => undefined }}>
        <Host />
      </HandednessProvider>,
    );

    const position = screen.getByRole("button", { name: "Move Room: position 1 of 2" });
    const hide = screen.getByRole("button", { name: "Hide Room" });
    expect(position.compareDocumentPosition(hide) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(position);
    const anchored = screen.getByRole("menu").closest("[data-align]");
    expect(anchored).toHaveAttribute("data-align", "start");
  });

  it("opens the property editor over the view from a row menu", async () => {
    stubFetch((input) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/spaces/s1/types")) {
        return jsonResponse([]);
      }
      if (url.endsWith("/api/spaces/s1/properties")) {
        return jsonResponse(properties);
      }
      throw new Error(`unstubbed ${url}`);
    });
    renderWithProviders(<Host />);

    fireEvent.click(screen.getByRole("button", { name: "More actions for Room" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit property" }));

    expect(await screen.findByRole("dialog", { name: "Edit Room" })).toBeInTheDocument();
  });

  it("opens the property editor from a hidden row's pencil", async () => {
    stubFetch((input) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/spaces/s1/types")) {
        return jsonResponse([]);
      }
      if (url.endsWith("/api/spaces/s1/properties")) {
        return jsonResponse(properties);
      }
      throw new Error(`unstubbed ${url}`);
    });
    renderWithProviders(<Host />);

    fireEvent.click(screen.getByRole("button", { name: "Edit Size property" }));

    expect(await screen.findByRole("dialog", { name: "Edit Size" })).toBeInTheDocument();
  });

  it("sends a generated schedule column to the type's scheduling block", () => {
    renderWithProviders(
      <ColumnPanel
        spaceId="s1"
        typeKey="album"
        view={{
          ...view,
          columns: ["title", "due_date"],
        }}
        properties={[
          ...properties,
          { key: "due_date", name: "Next watering", format: "date" },
        ]}
        disabled={false}
        canEdit
        onPatch={() => undefined}
        onAddProperty={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "More actions for Next watering" }));
    expect(screen.getByRole("menuitem", { name: "Edit schedule" })).toHaveAttribute(
      "href",
      "/s/s1/schema?type=album#type-schedule",
    );
  });

  it("offers conversion for a column format that can become a relation", () => {
    renderWithProviders(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "More actions for Room" }));
    expect(screen.getByRole("menuitem", { name: "Turn into a relation…" })).toBeEnabled();
  });

  it("offers only the property actions in a row menu", () => {
    renderWithProviders(<Host />);

    fireEvent.click(screen.getByRole("button", { name: "More actions for Room" }));
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Edit property",
      "Turn into a relation…",
    ]);
    expect(
      screen.queryByRole("menuitemcheckbox", { name: "Summarise this column" }),
    ).not.toBeInTheDocument();
  });

  it("does not offer conversion for a column format that cannot become a relation", () => {
    renderWithProviders(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "More actions for Bedroom" }));
    expect(screen.getByRole("menuitem", { name: "Edit property" })).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Turn into a relation…" }),
    ).not.toBeInTheDocument();
  });

  it("shows each row's format beside its name", () => {
    renderWithProviders(<Host />);
    const shown = screen.getByRole("button", { name: "Hide Room" }).closest("li");
    expect(shown).not.toBeNull();
    expect(within(shown as HTMLElement).getByText("Select")).toBeInTheDocument();
  });
});

