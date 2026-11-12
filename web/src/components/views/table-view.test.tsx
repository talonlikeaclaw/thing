import { act, fireEvent, screen, within } from "@testing-library/react";
import { Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ObjectSummary, PropertyDef, TypeDef, ViewDef } from "@/api/types";
import { TableView } from "@/components/views/table-view";
import { renderWithProviders } from "@/test/harness";

const properties: PropertyDef[] = [
  { key: "size", name: "Size", format: "number" },
  {
    key: "days_since_watered",
    name: "Days since watered",
    format: "number",
    compute: { kind: "formula", expression: "1" },
  },
];

const view: ViewDef = {
  key: "all",
  name: "All",
  kind: "table",
  sorts: [],
  filter: { op: "and", conditions: [] },
  columns: ["title", "size", "days_since_watered"],
  // Both numeric columns are at the width floor, where the computed format's
  // words cannot fit and the stored one's can.
  widths: { size: 80, days_since_watered: 80 },
};

const type: TypeDef = {
  key: "plant",
  name: "Plant",
  name_plural: "Plants",
  description: "",
  schedule: false,
  properties: [
    { key: "size", required: false, featured: false },
    { key: "days_since_watered", required: false, featured: false },
  ],
  views: [view],
  default_view: "all",
};

const rows: ObjectSummary[] = [
  {
    id: "0190b6d0-0000-7000-8000-000000000001",
    type: "plant",
    title: "Monstera",
    rev: 1,
    updated_at: "2026-11-11T00:00:00Z",
    values: {
      size: { value: 3, label: "3" },
      days_since_watered: { value: 3, label: "3" },
    },
    missing_relations: [],
  },
];

/** The real grid over two narrow numeric columns, one of them calculated. */
function renderTable() {
  return renderWithProviders(
    <TableView
      spaceId="s1"
      type={type}
      view={view}
      rows={rows}
      properties={properties}
      canEdit
      completing={false}
      busy={false}
      sorts={[]}
      selected={new Set()}
      pendingRows={new Set()}
      bulkOpen={false}
      timeZone="UTC"
      onSort={() => undefined}
      onToggleRow={() => undefined}
      onToggleAll={() => undefined}
      onClearSelection={() => undefined}
      onTitleCommit={() => Promise.resolve({ ok: true })}
      onCellCommit={() => Promise.resolve({ ok: true })}
      onComplete={() => undefined}
      onDuplicate={() => undefined}
      onTrash={() => undefined}
      onFocusSearch={() => undefined}
      onResize={() => Promise.resolve()}
      layoutPending={false}
      onAddProperty={() => undefined}
    />,
  );
}

describe("a table header", () => {
  it("keeps a column's full name on the sort control when the label wraps", () => {
    renderTable();
    // The label wraps to three lines; the name is still the tooltip and the
    // sort control's accessible name, never a shortened spelling.
    const header = screen.getByRole("button", {
      name: /Sort by Days since watered/,
    });
    expect(header).toHaveAttribute("title", "Days since watered");
    expect(within(header).getByText("Days since watered")).toBeInTheDocument();
  });

  it("names the title column's text format like every property", () => {
    renderTable();
    const header = screen.getByRole("button", { name: /Sort by Title/ });
    const cell = header.closest("th");
    expect(cell).not.toBeNull();
    expect(within(cell as HTMLElement).getByTitle("Text")).toHaveTextContent("Text");
  });

  it("keeps a short format's words in a narrow column", () => {
    renderTable();
    const header = screen.getByRole("button", { name: /Sort by Size/ });
    const cell = header.closest("th");
    expect(cell).not.toBeNull();
    expect(within(cell as HTMLElement).getByTitle("Number")).toHaveTextContent("Number");
  });

  it("falls back to the format's glyph when its words do not fit", () => {
    renderTable();
    const header = screen.getByRole("button", {
      name: /Sort by Days since watered/,
    });
    const cell = header.closest("th");
    expect(cell).not.toBeNull();
    // "Formula · Number" is wider than the 80px column's text box; the glyph
    // pair carries the same meaning and the full spelling stays its tooltip.
    expect(
      within(cell as HTMLElement).queryByText("Formula · Number"),
    ).not.toBeInTheDocument();
    expect(within(cell as HTMLElement).getByTitle("Formula · Number")).toBeInTheDocument();
  });

  it("gives every phone header its property-type glyph", () => {
    const width = window.innerWidth;
    // A phone drops the format line, so each column carries its glyph pair
    // beside the name instead — stored formats and calculated kinds alike.
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    try {
      renderTable();
      const title = screen.getByRole("button", { name: /Sort by Title/ }).closest("th");
      expect(within(title as HTMLElement).getByTitle("Text")).toBeInTheDocument();
      const size = screen.getByRole("button", { name: /Sort by Size/ }).closest("th");
      expect(within(size as HTMLElement).getByTitle("Number")).toBeInTheDocument();
      const calculated = screen
        .getByRole("button", { name: /Sort by Days since watered/ })
        .closest("th");
      expect(
        within(calculated as HTMLElement).getByTitle("Formula · Number"),
      ).toBeInTheDocument();
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
    }
  });
});

/* The keyboard grid: a title column and two stored properties over two rows. */

const gridProperties: PropertyDef[] = [
  { key: "room", name: "Room", format: "text" },
  { key: "height", name: "Height", format: "number" },
];

const gridType: TypeDef = {
  key: "plant",
  name: "Plant",
  name_plural: "Plants",
  description: "",
  schedule: false,
  properties: gridProperties.map((property) => ({
    key: property.key,
    required: false,
    featured: true,
  })),
  views: [],
  default_view: "table",
};

const gridView: ViewDef = {
  key: "table",
  name: "Table",
  kind: "table",
  sorts: [],
  filter: { op: "and", conditions: [] },
  columns: ["title", "room", "height"],
};

const gridRows: ObjectSummary[] = [
  {
    id: "0193a000-0000-7000-8000-000000000001",
    type: "plant",
    title: "Monstera",
    rev: 1,
    updated_at: "2026-11-11T00:00:00Z",
    values: {
      room: { value: "kitchen", label: "kitchen" },
      height: { value: 120, label: "120" },
    },
    missing_relations: [],
  },
  {
    id: "0193a000-0000-7000-8000-000000000002",
    type: "plant",
    title: "Fern",
    rev: 1,
    updated_at: "2026-11-11T00:00:00Z",
    values: {
      room: { value: "study", label: "study" },
      height: { value: 40, label: "40" },
    },
    missing_relations: [],
  },
];

function gridElement(
  handlers: {
    onToggleRow?: (id: string) => void;
    onDuplicate?: (row: ObjectSummary) => void;
  } = {},
) {
  return (
    <TableView
      spaceId="space"
      type={gridType}
      view={gridView}
      rows={gridRows}
      properties={gridProperties}
      canEdit
      completing={false}
      busy={false}
      sorts={[]}
      selected={new Set()}
      pendingRows={new Set()}
      bulkOpen={false}
      timeZone="America/Toronto"
      onSort={() => undefined}
      onToggleRow={handlers.onToggleRow ?? (() => undefined)}
      onToggleAll={() => undefined}
      onClearSelection={() => undefined}
      onTitleCommit={() => Promise.resolve({ ok: true })}
      onCellCommit={() => Promise.resolve({ ok: true })}
      onComplete={() => undefined}
      onDuplicate={handlers.onDuplicate ?? (() => undefined)}
      onTrash={() => undefined}
      onFocusSearch={() => undefined}
      onResize={() => Promise.resolve()}
      layoutPending={false}
      onAddProperty={() => undefined}
    />
  );
}

function renderGrid(
  handlers: {
    onToggleRow?: (id: string) => void;
    onDuplicate?: (row: ObjectSummary) => void;
  } = {},
) {
  return renderWithProviders(gridElement(handlers));
}

/** The cell the grid addresses: the checkbox is column 0, the title column 1. */
function gridCell(container: HTMLElement, row: number, col: number): HTMLElement {
  const found = container.querySelector<HTMLElement>(`[data-cell="${row}:${col}"]`);
  if (!found) {
    throw new Error(`no cell at ${row}:${col}`);
  }
  return found;
}

/** Focus a cell the way a reader arrives at it, then hand it to the keyboard. */
function focusCell(container: HTMLElement, row: number, col: number): HTMLElement {
  const cell = gridCell(container, row, col);
  // The grid records the active cell on focus; flush that render before the
  // next key so the handler reads the cell the reader is on.
  act(() => cell.focus());
  expect(document.activeElement).toBe(cell);
  return cell;
}

function pressTab(target: HTMLElement, shiftKey = false): boolean {
  return fireEvent.keyDown(target, { key: "Tab", shiftKey });
}

describe("Tab in the table grid", () => {
  // The grid focuses the next cell inside a frame; resolve it synchronously so
  // the assertions read the state the reader would see.
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
  });

  it("moves to the next data cell and wraps to the next row", () => {
    const { container } = renderGrid();

    expect(pressTab(focusCell(container, 0, 1))).toBe(false);
    expect(document.activeElement).toBe(gridCell(container, 0, 2));

    expect(pressTab(gridCell(container, 0, 2))).toBe(false);
    expect(document.activeElement).toBe(gridCell(container, 0, 3));

    expect(pressTab(gridCell(container, 0, 3))).toBe(false);
    expect(document.activeElement).toBe(gridCell(container, 1, 1));
  });

  it("leaves the grid at the last data cell", () => {
    const { container } = renderGrid();
    const last = focusCell(container, 1, 3);

    // Not intercepted, so the browser's own Tab is what leaves the table.
    expect(pressTab(last)).toBe(true);
    expect(document.activeElement).toBe(last);
  });

  it("walks backwards with Shift+Tab and wraps to the previous row", () => {
    const { container } = renderGrid();

    expect(pressTab(focusCell(container, 0, 2), true)).toBe(false);
    expect(document.activeElement).toBe(gridCell(container, 0, 1));

    expect(pressTab(focusCell(container, 1, 1), true)).toBe(false);
    expect(document.activeElement).toBe(gridCell(container, 0, 3));
  });

  it("leaves the grid backwards at the first data cell", () => {
    const { container } = renderGrid();
    const first = focusCell(container, 0, 1);

    expect(pressTab(first, true)).toBe(true);
    expect(document.activeElement).toBe(first);
  });

  it("leaves the header controls and the row checkboxes alone", () => {
    const { container } = renderGrid();
    const selectAll = screen.getByRole("checkbox", {
      name: "Select every row on this page",
    });
    selectAll.focus();
    expect(pressTab(selectAll)).toBe(true);

    const checkbox = focusCell(container, 0, 0);
    expect(pressTab(checkbox)).toBe(true);
  });
});

describe("the grid's one tab stop", () => {
  it("starts on the first data cell, so Tab enters the grid there", () => {
    const { container } = renderGrid();
    expect(gridCell(container, 0, 1).tabIndex).toBe(0);
    expect(gridCell(container, 0, 1)).toHaveAttribute("data-active", "true");
    expect(gridCell(container, 0, 0).tabIndex).toBe(-1);
  });

  it("keeps the data cell tabbable after the row checkbox takes focus", () => {
    const { container } = renderGrid();
    const checkbox = screen.getByRole("checkbox", { name: /^Select “Monstera”/ });
    act(() => checkbox.focus());
    // The reader reaches the checkbox first; the browser's next Tab must still
    // find the active data cell instead of skipping to the action rail.
    expect(gridCell(container, 0, 1).tabIndex).toBe(0);
    expect(gridCell(container, 0, 1)).toHaveAttribute("data-active", "true");
  });

  it("addresses the row whose action has focus", () => {
    const onToggleRow = vi.fn();
    renderGrid({ onToggleRow });
    const duplicate = screen.getByRole("button", { name: "Duplicate Fern" });
    act(() => duplicate.focus());
    // The roving ring never leaves data, but a key pressed in the rail still
    // applies to the row the reader is on.
    fireEvent.keyDown(duplicate, { key: "x" });
    expect(onToggleRow).toHaveBeenCalledWith(gridRows[1]?.id);
  });

  it("opens the active record with O", () => {
    const { container } = renderWithProviders(
      <Routes>
        <Route path="/s/space/o/:id" element={<p>the record page</p>} />
        <Route path="*" element={gridElement()} />
      </Routes>,
      { route: "/s/space/t/plant" },
    );

    fireEvent.keyDown(focusCell(container, 1, 1), { key: "o" });
    expect(screen.getByText("the record page")).toBeInTheDocument();
  });

  it("keeps a tab stop on the first data cell after Escape clears the grid", () => {
    const { container } = renderGrid();
    fireEvent.keyDown(focusCell(container, 1, 1), { key: "Escape" });
    expect(gridCell(container, 0, 1).tabIndex).toBe(0);
    expect(gridCell(container, 0, 1)).not.toHaveAttribute("data-active");
    expect(gridCell(container, 1, 1).tabIndex).toBe(-1);
  });

  it("keeps the cell display buttons out of the Tab order", () => {
    renderGrid();
    const title = screen.getByRole("button", { name: /^Edit title for “Monstera”/ });
    const room = screen.getByRole("button", { name: /^Edit Room for “Monstera”/ });
    expect(title.tabIndex).toBe(-1);
    expect(room.tabIndex).toBe(-1);
  });

  it("opens the title editor with Enter", () => {
    const { container } = renderGrid();
    fireEvent.keyDown(focusCell(container, 0, 1), { key: "Enter" });
    expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue("Monstera");
    expect(screen.queryByRole("button", { name: /^Edit title for “Monstera”/ })).toBeNull();
  });
});

describe("the active cell", () => {
  it("paints no ring until the card takes focus", () => {
    const { container } = renderGrid();
    const active = gridCell(container, 0, 1);
    // The roving cell is marked from the first paint, but the grid is not
    // listening to the keyboard until it holds focus.
    expect(active).toHaveAttribute("data-active", "true");
    expect(active.className).not.toContain("inset_0_0_0_2px");

    focusCell(container, 0, 1);
    expect(gridCell(container, 0, 1).className).toContain("inset_0_0_0_2px");
  });

  it("is ringed and is the only data cell marked active", () => {
    const { container } = renderGrid();
    focusCell(container, 0, 2);

    const active = gridCell(container, 0, 2);
    expect(active).toHaveAttribute("data-active", "true");
    expect(active.className).toContain("inset_0_0_0_2px");

    const neighbour = gridCell(container, 0, 3);
    expect(neighbour).not.toHaveAttribute("data-active");
    expect(neighbour.className).not.toContain("inset_0_0_0_2px");
  });

  it("leaves a finger-only table unringed", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(pointer: coarse)",
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }));
    const { container } = renderGrid();
    expect(gridCell(container, 0, 1)).toHaveAttribute("data-active", "true");
    expect(gridCell(container, 0, 1).className).not.toContain("inset_0_0_0_2px");
  });

  it("marks data cells only, never a control column", () => {
    const { container } = renderGrid();
    expect(gridCell(container, 0, 1)).toHaveAttribute("data-grid-cell");
    expect(gridCell(container, 0, 2)).toHaveAttribute("data-grid-cell");
    expect(gridCell(container, 0, 3)).toHaveAttribute("data-grid-cell");
    expect(gridCell(container, 0, 0)).not.toHaveAttribute("data-grid-cell");
  });
});
