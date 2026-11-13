import { fireEvent, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import type { Sort } from "@/api/types";
import { HandednessProvider } from "@/components/handedness";
import { SortBar } from "@/components/sort-bar";
import type { ColumnChoice } from "@/lib/filter";
import { renderWithProviders } from "@/test/harness";

const columns: ColumnChoice[] = [
  { key: "title", label: "Title", format: "text" },
  { key: "room", label: "Room", format: "select" },
  { key: "artist", label: "Artist", format: "relation" },
  { key: "size", label: "Size", format: "number" },
];

/** The panel over one sorts array the host owns, like the type page. */
function Host({ initial = [] }: { initial?: Sort[] }) {
  const [sorts, setSorts] = useState<Sort[]>(initial);
  return (
    <div>
      <output data-testid="sorts">{JSON.stringify(sorts)}</output>
      <SortBar columns={columns} sorts={sorts} onChange={setSorts} />
    </div>
  );
}

function published(): Sort[] {
  return JSON.parse(screen.getByTestId("sorts").textContent ?? "[]") as Sort[];
}

describe("SortBar", () => {
  it("adds a rule as soon as a column is chosen, and removes it", () => {
    renderWithProviders(<Host />);
    expect(screen.getByText("Nothing is sorted; the records keep their saved order.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add a sort column" }));
    const list = screen.getByRole("listbox", { name: "Add a sort column" });
    fireEvent.click(within(list).getByRole("option", { name: /Artist/ }));
    expect(published()).toEqual([{ property: "artist", direction: "asc", empty: "end" }]);

    fireEvent.click(screen.getByRole("button", { name: "Remove Artist sort" }));
    expect(published()).toEqual([]);
  });

  it("changes direction with one segmented control", () => {
    renderWithProviders(<Host initial={[{ property: "room", direction: "asc", empty: "end" }]} />);

    const group = screen.getByRole("group", { name: "Room direction" });
    expect(within(group).getByRole("button", { name: "Ascending" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(within(group).getByRole("button", { name: "Descending" }));
    expect(published()).toEqual([{ property: "room", direction: "desc", empty: "end" }]);
  });

  it("moves empty placement into the row menu", () => {
    renderWithProviders(<Host initial={[{ property: "room", direction: "asc", empty: "end" }]} />);

    // The common row carries no empty-placement control of its own.
    expect(screen.queryByRole("combobox", { name: "Empty placement" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Room sort options" }));
    expect(screen.getByRole("menu").closest("[data-align]")).toHaveAttribute(
      "data-align",
      "end",
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Empty values first" }));
    expect(published()).toEqual([{ property: "room", direction: "asc", empty: "start" }]);
  });

  it("reorders rows with the arrow controls", () => {
    renderWithProviders(
      <Host
        initial={[
          { property: "room", direction: "asc", empty: "end" },
          { property: "size", direction: "asc", empty: "end" },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Move Size up" }));
    expect(published().map((sort) => sort.property)).toEqual(["size", "room"]);
  });

  it("puts the direction toggle on the thumb edge for each hand", () => {
    renderWithProviders(<Host initial={[{ property: "room", direction: "asc", empty: "end" }]} />);
    const direction = screen.getByRole("group", { name: "Room direction" });
    const options = screen.getByRole("button", { name: "Room sort options" });
    expect(options.compareDocumentPosition(direction) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("anchors the row menu to the chosen hand", () => {
    renderWithProviders(
      <HandednessProvider value={{ handedness: "left", setHandedness: () => undefined }}>
        <Host initial={[{ property: "room", direction: "asc", empty: "end" }]} />
      </HandednessProvider>,
    );

    const direction = screen.getByRole("group", { name: "Room direction" });
    const options = screen.getByRole("button", { name: "Room sort options" });
    expect(direction.compareDocumentPosition(options) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(options);
    const anchored = screen.getByRole("menu").closest("[data-align]");
    expect(anchored).toHaveAttribute("data-align", "start");
  });

  it("offers only columns that are not already rules", () => {
    renderWithProviders(<Host initial={[{ property: "room", direction: "asc", empty: "end" }]} />);

    // The row's own trigger names the property it holds; the add picker only
    // offers the columns that are not already rules.
    expect(screen.getByRole("button", { name: "Sort column: Room" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add a sort column" }));
    const add = screen.getByRole("listbox", { name: "Add a sort column" });
    expect(within(add).queryByRole("option", { name: /Room/ })).not.toBeInTheDocument();
    expect(within(add).getByRole("option", { name: /Size/ })).toBeInTheDocument();
  });
});
