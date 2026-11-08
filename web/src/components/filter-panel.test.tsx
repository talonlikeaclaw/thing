import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";

import type { Filter, PropertyDef, TypeDef } from "@/api/types";
import { FilterChips, FilterPanel } from "@/components/filter-panel";
import { HandednessProvider } from "@/components/handedness";
import { jsonResponse, renderWithProviders, requestUrl, stubFetch } from "@/test/harness";

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
  { key: "artist", name: "Artist", format: "relation", target_type: "artist", multi: true },
  { key: "due_date", name: "Due", format: "date" },
];

const type: TypeDef = {
  key: "plant",
  name: "Plant",
  name_plural: "Plants",
  description: "",
  schedule: true,
  implicit_properties: [{ key: "due_date", name: "Due", format: "date" }],
  properties: [
    { key: "room", required: false, featured: true },
    { key: "artist", required: false, featured: true },
  ],
  views: [
    {
      key: "all",
      name: "All",
      kind: "table",
      sorts: [],
      filter: { op: "and", conditions: [] },
      columns: ["title"],
    },
  ],
  default_view: "all",
};

const EMPTY: Filter = { op: "and", conditions: [] };

/** The panel plus the chips, over one filter the host owns like the type page. */
function Host({
  initial = EMPTY,
  matched,
  saveView,
}: {
  initial?: Filter;
  matched?: number;
  saveView?: { onSave: () => void; pending: boolean };
}) {
  const [filter, setFilter] = useState<Filter>(initial);
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement | null>(null);
  return (
    <div>
      <button type="button" ref={anchor} onClick={() => setOpen(true)}>
        Filter
      </button>
      <output data-testid="filter">{JSON.stringify(filter)}</output>
      <FilterChips
        spaceId="s1"
        type={type}
        properties={properties}
        filter={filter}
        onChange={setFilter}
      />
      <FilterPanel
        spaceId="s1"
        type={type}
        properties={properties}
        filter={filter}
        matched={matched}
        today="2026-11-08"
        open={open}
        onOpenChange={setOpen}
        anchor={anchor}
        onChange={setFilter}
        saveView={saveView}
      />
    </div>
  );
}

function published(): Filter {
  return JSON.parse(screen.getByTestId("filter").textContent ?? "{}") as Filter;
}

/** Answer the two media questions the panel asks for one device shape. */
function stubMedia(phone: boolean) {
  return vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        matches: phone && (query === "(max-width: 639px)" || query === "(pointer: coarse)"),
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }) as MediaQueryList,
  );
}

/** The relation target read the value list and the chips share. */
function stubRelations() {
  return stubFetch((input) => {
    const url = requestUrl(input);
    if (url.includes("/types")) {
      return jsonResponse([
        {
          key: "artist",
          name: "Artist",
          name_plural: "Artists",
          description: "",
          schedule: false,
          property_count: 0,
          object_count: 2,
        },
      ]);
    }
    if (url.includes("/objects")) {
      return jsonResponse({
        view: "all",
        total: 2,
        offset: 0,
        limit: 500,
        has_more: false,
        objects: [
          {
            id: "m1",
            type: "artist",
            title: "Miles Davis",
            rev: 1,
            updated_at: "2026-11-01T00:00:00Z",
            values: {},
            missing_relations: [],
          },
          {
            id: "c1",
            type: "artist",
            title: "John Coltrane",
            rev: 1,
            updated_at: "2026-11-01T00:00:00Z",
            values: {},
            missing_relations: [],
          },
        ],
      });
    }
    throw new Error(`unexpected request ${url}`);
  });
}

describe("FilterPanel", () => {
  it("adds a quick filter's conditions and pressing it again removes them", () => {
    renderWithProviders(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));

    fireEvent.click(screen.getByRole("button", { name: "Due today" }));
    expect(published()).toEqual({
      op: "and",
      conditions: [{ property: "due_date", condition: "equal", value: "2026-11-08" }],
    });
    expect(screen.getByRole("button", { name: "Due today" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("Due is 2026-11-08")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Due today" }));
    expect(published()).toEqual(EMPTY);
    expect(screen.queryByText("Due is 2026-11-08")).not.toBeInTheDocument();
  });

  it("writes Next 7 days as a lower and an upper bound", () => {
    renderWithProviders(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.click(screen.getByRole("button", { name: "Next 7 days" }));

    expect(published().conditions).toEqual([
      { property: "due_date", condition: "greater_or_equal", value: "2026-11-08" },
      { property: "due_date", condition: "less_or_equal", value: "2026-11-14" },
    ]);
    expect(screen.getByText("Due is at least 2026-11-08")).toBeInTheDocument();
    expect(screen.getByText("Due is at most 2026-11-14")).toBeInTheDocument();
  });

  it("switches the whole filter between every and any", () => {
    renderWithProviders(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.click(screen.getByRole("button", { name: "Due today" }));
    fireEvent.click(screen.getByRole("button", { name: "No due date" }));

    const any = screen.getByRole("button", { name: "Match any" });
    fireEvent.click(any);
    expect(published().op).toBe("or");
    expect(any).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Match all" }));
    expect(published().op).toBe("and");
    expect(published().conditions).toHaveLength(2);
  });

  it("keeps a half-built row out of the query", () => {
    renderWithProviders(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.click(screen.getByRole("button", { name: "Add condition" }));

    expect(screen.getByText("Choose a property to filter by.")).toBeInTheDocument();
    expect(published()).toEqual(EMPTY);
  });

  it("publishes a condition only once its value is chosen", async () => {
    renderWithProviders(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.click(screen.getByRole("button", { name: "Add condition" }));

    fireEvent.click(screen.getByRole("button", { name: "Choose a property to filter by" }));
    fireEvent.click(await screen.findByRole("option", { name: /Room/ }));
    // The value is a field of its own now, and it says what it is waiting for.
    const field = screen.getByRole("button", { name: "Filter Room value" });
    expect(field).toHaveTextContent("Choose a value");
    expect(published()).toEqual(EMPTY);

    fireEvent.click(field);
    fireEvent.click(await screen.findByRole("option", { name: /Kitchen/ }));
    expect(published().conditions).toEqual([
      { property: "room", condition: "equal", value: "kitchen" },
    ]);
    expect(screen.getByText("Room is Kitchen")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filter Room value" })).toHaveTextContent(
      "Kitchen",
    );
  });

  it("searches the option list and marks the chosen one", async () => {
    renderWithProviders(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.click(screen.getByRole("button", { name: "Add condition" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose a property to filter by" }));
    fireEvent.click(await screen.findByRole("option", { name: /Room/ }));

    fireEvent.click(screen.getByRole("button", { name: "Filter Room value" }));
    const search = await screen.findByRole("combobox", { name: "Search filter room value" });
    fireEvent.change(search, { target: { value: "stu" } });
    expect(screen.queryByRole("option", { name: /Kitchen/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: /Study/ }));

    expect(published().conditions).toEqual([
      { property: "room", condition: "equal", value: "study" },
    ]);
    expect(screen.getByText("Room is Study")).toBeInTheDocument();
  });

  it("applies a date preset as that day", async () => {
    renderWithProviders(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.click(screen.getByRole("button", { name: "Add condition" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose a property to filter by" }));
    fireEvent.click(await screen.findByRole("option", { name: /Due/ }));

    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(published().conditions).toEqual([
      { property: "due_date", condition: "equal", value: "2026-11-08" },
    ]);

    fireEvent.click(screen.getByRole("button", { name: "This week" }));
    expect(published().conditions).toEqual([
      { property: "due_date", condition: "greater_or_equal", value: "2026-11-02" },
      { property: "due_date", condition: "less_or_equal", value: "2026-11-08" },
    ]);
  });

  it("searches relation targets and keeps several of them", async () => {
    stubRelations();
    renderWithProviders(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.click(screen.getByRole("button", { name: "Add condition" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose a property to filter by" }));
    fireEvent.click(await screen.findByRole("option", { name: /Artist/ }));

    fireEvent.change(screen.getByRole("combobox", { name: "Filter condition" }), {
      target: { value: "in" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Filter Artist target" }));
    const search = await screen.findByRole("combobox", {
      name: "Search filter artist target",
    });
    fireEvent.change(search, { target: { value: "miles" } });
    fireEvent.click(await screen.findByRole("option", { name: /Miles Davis/ }));
    expect(published().conditions).toEqual([
      { property: "artist", condition: "in", value: ["m1"] },
    ]);
    await waitFor(() => expect(screen.getByText("Artist is any of Miles Davis")).toBeInTheDocument());
  });

  it("lists no column a condition may not carry", async () => {
    renderWithProviders(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.click(screen.getByRole("button", { name: "Add condition" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose a property to filter by" }));

    expect(await screen.findByRole("option", { name: /Room/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Updated/ })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Title/ })).toBeInTheDocument();
  });

  it("puts the empty hint under a plain field only", async () => {
    renderWithProviders(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.click(screen.getByRole("button", { name: "Add condition" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose a property to filter by" }));
    fireEvent.click(await screen.findByRole("option", { name: /Due/ }));

    const hint = screen.getByText("Choose a value");
    expect(hint.parentElement).toContainElement(screen.getByLabelText("Filter value"));
  });

  it("removes one condition from its chip and clears the rest", () => {
    renderWithProviders(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.click(screen.getByRole("button", { name: "Due today" }));
    fireEvent.click(screen.getByRole("button", { name: "No due date" }));
    expect(published().conditions).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Remove filter: Due is empty" }));
    expect(published().conditions).toEqual([
      { property: "due_date", condition: "equal", value: "2026-11-08" },
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(published()).toEqual(EMPTY);
  });

  it("says what the table matched", () => {
    renderWithProviders(<Host matched={3} />);
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    expect(screen.getByText("3 records match")).toBeInTheDocument();
  });

  it("closes on Done and returns focus to the Filter button", async () => {
    stubMedia(false);
    renderWithProviders(<Host />);
    const trigger = screen.getByRole("button", { name: "Filter" });
    fireEvent.click(trigger);
    const panel = await screen.findByRole("dialog", { name: "Filter" });

    fireEvent.click(within(panel).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("puts the footer's primary action on a left hand's thumb edge", async () => {
    stubMedia(true);
    renderWithProviders(
      <HandednessProvider value={{ handedness: "left", setHandedness: () => undefined }}>
        <Host saveView={{ onSave: () => undefined, pending: false }} />
      </HandednessProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));

    const sheet = await screen.findByRole("dialog");
    const row = sheet.querySelector("[data-thumb-row]");
    expect(row).toHaveAttribute("data-thumb-row", "left");
    const actions = within(row as HTMLElement).getAllByRole("button");
    expect(actions[0]).toHaveTextContent("Done");
    expect(actions.at(-1)).toHaveTextContent("Clear all");
  });

  it("offers an unsaved query's Save view in the footer", async () => {
    stubMedia(true);
    const onSave = vi.fn();
    renderWithProviders(<Host saveView={{ onSave, pending: false }} />);
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));

    const sheet = await screen.findByRole("dialog");
    fireEvent.click(within(sheet).getByRole("button", { name: "Save view" }));
    expect(onSave).toHaveBeenCalledOnce();
  });

  it("opens as the shared sheet on a phone with its footer above the keyboard", async () => {
    stubMedia(true);
    renderWithProviders(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));

    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByRole("button", { name: "Done" })).toBeInTheDocument();
    expect(sheet.querySelector(".sheet-footer")).not.toBeNull();
    expect(within(sheet).getByText("Every record in this type.")).toBeInTheDocument();
  });
});
