import { fireEvent, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import type { Filter, PropertyDef, TypeDef } from "@/api/types";
import { FilterConditions } from "@/components/filter-conditions";
import { renderWithProviders } from "@/test/harness";

const properties: PropertyDef[] = [
  {
    key: "room",
    name: "Room",
    format: "select",
    options: [
      { key: "kitchen", name: "Kitchen", color: "#c8d96b" },
      { key: "study", name: "Study", color: "#8fb0c9" },
    ],
  },
  { key: "height", name: "Height", format: "number" },
];

const type: TypeDef = {
  key: "plant",
  name: "Plant",
  name_plural: "Plants",
  description: "",
  schedule: false,
  properties: [
    { key: "room", required: false, featured: true },
    { key: "height", required: false, featured: true },
  ],
  views: [],
  default_view: "all",
};

const EMPTY: Filter = { op: "and", conditions: [] };

function Host() {
  const [filter, setFilter] = useState(EMPTY);
  return (
    <div>
      <output data-testid="filter">{JSON.stringify(filter)}</output>
      <FilterConditions
        spaceId="s1"
        type={type}
        properties={properties}
        filter={filter}
        today="2026-11-08"
        onChange={setFilter}
        empty="Every linked record counts."
      />
    </div>
  );
}

function published(): Filter {
  return JSON.parse(screen.getByTestId("filter").textContent ?? "{}") as Filter;
}

describe("FilterConditions", () => {
  it("keeps a half-built row on screen but out of the filter", async () => {
    renderWithProviders(<Host />);
    expect(screen.getByText("Every linked record counts.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add condition" }));
    expect(screen.getByText("Choose a property to filter by.")).toBeInTheDocument();
    expect(published()).toEqual(EMPTY);

    fireEvent.click(screen.getByRole("button", { name: "Choose a property to filter by" }));
    fireEvent.click(await screen.findByRole("option", { name: /Room/ }));
    expect(published()).toEqual(EMPTY);

    fireEvent.click(screen.getByRole("button", { name: "Filter Room value" }));
    fireEvent.click(await screen.findByRole("option", { name: /Study/ }));
    expect(published()).toEqual({
      op: "and",
      conditions: [{ property: "room", condition: "equal", value: "study" }],
    });
  });

  it("switches the whole filter and removes one row", () => {
    renderWithProviders(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "Add condition" }));
    fireEvent.click(screen.getByRole("button", { name: "Add condition" }));

    expect(published()).toEqual(EMPTY);
    const any = screen.getByRole("button", { name: "Match any" });
    fireEvent.click(any);
    expect(published().op).toBe("or");

    fireEvent.click(screen.getAllByRole("button", { name: "Remove condition" })[0]!);
    expect(screen.getAllByRole("button", { name: "Remove condition" })).toHaveLength(1);
  });
});
