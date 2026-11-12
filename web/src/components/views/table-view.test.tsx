import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
      scopeKey="scope"
      total={rows.length}
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
    scopeKey?: string;
    total?: number;
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
      scopeKey={handlers.scopeKey ?? "scope"}
      total={handlers.total ?? gridRows.length}
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
    scopeKey?: string;
    total?: number;
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

describe("the cell range", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
  });

  /** The data cells a range has marked; control columns never enter it. */
  function selectedCells(container: HTMLElement): HTMLElement[] {
    return Array.from(
      container.querySelectorAll<HTMLElement>('[data-grid-cell][aria-selected="true"]'),
    );
  }

  function shiftArrow(target: HTMLElement, key: string) {
    fireEvent.keyDown(target, { key, shiftKey: true });
    return document.activeElement as HTMLElement;
  }

  it("extends a rectangle over rows and columns with Shift and the arrows", () => {
    const { container } = renderGrid();
    let focus = shiftArrow(focusCell(container, 0, 1), "ArrowRight");
    focus = shiftArrow(focus, "ArrowDown");

    expect(selectedCells(container)).toHaveLength(4);
    for (const row of [0, 1]) {
      for (const col of [1, 2]) {
        expect(gridCell(container, row, col)).toHaveAttribute("aria-selected", "true");
      }
    }
    expect(gridCell(container, 1, 3)).toHaveAttribute("aria-selected", "false");
    // The live region names both corners while the bar names the shape.
    expect(screen.getByText("2 rows by 2 columns, 4 cells selected")).toBeInTheDocument();
    expect(screen.getByText(/4 cells · 2 rows × 2 columns/)).toBeInTheDocument();
    expect(focus).toBe(gridCell(container, 1, 2));
  });

  it("collapses the range on a plain move and keeps the active cell", () => {
    const { container } = renderGrid();
    fireEvent.keyDown(focusCell(container, 0, 1), { key: "ArrowRight", shiftKey: true });
    expect(screen.getByRole("group", { name: "Cell selection" })).toBeInTheDocument();

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowRight" });
    expect(selectedCells(container)).toHaveLength(0);
    expect(screen.queryByRole("group", { name: "Cell selection" })).toBeNull();
    expect(gridCell(container, 0, 3)).toHaveAttribute("data-active", "true");
  });

  it("extends from a keyboard anchor on a Shift click without opening an editor", () => {
    const { container } = renderGrid();
    fireEvent.keyDown(focusCell(container, 0, 1), { key: "ArrowRight", shiftKey: true });

    fireEvent.click(
      screen.getByRole("button", { name: /^Edit title for “Fern”/ }),
      { shiftKey: true },
    );

    expect(screen.queryByRole("textbox", { name: "Title" })).toBeNull();
    expect(selectedCells(container)).toHaveLength(2);
    expect(gridCell(container, 1, 1)).toHaveAttribute("aria-selected", "true");
    expect(gridCell(container, 0, 1)).toHaveAttribute("aria-selected", "true");
  });

  it("anchors a plain press, so the next Shift click grows from it", () => {
    const { container } = renderGrid();

    fireEvent.pointerDown(gridCell(container, 0, 2));
    expect(screen.getByText(/1 cell · 1 row × 1 column/)).toBeInTheDocument();

    fireEvent.click(gridCell(container, 1, 3), { shiftKey: true });

    expect(selectedCells(container)).toHaveLength(4);
    expect(gridCell(container, 0, 2)).toHaveAttribute("aria-selected", "true");
    expect(gridCell(container, 1, 3)).toHaveAttribute("aria-selected", "true");
  });

  it("keeps a touch tap out of the range model", () => {
    const { container } = renderGrid();

    fireEvent.pointerDown(gridCell(container, 0, 2), { pointerType: "touch" });

    expect(screen.queryByRole("group", { name: "Cell selection" })).toBeNull();
    expect(selectedCells(container)).toHaveLength(0);
    expect(gridCell(container, 0, 2)).toHaveAttribute("data-active", "true");
  });

  it("gives up the rectangle on Escape before it clears the grid", () => {
    const { container } = renderGrid();
    fireEvent.keyDown(focusCell(container, 0, 1), { key: "ArrowDown", shiftKey: true });

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Escape" });

    expect(selectedCells(container)).toHaveLength(0);
    expect(screen.queryByRole("group", { name: "Cell selection" })).toBeNull();
    expect(gridCell(container, 1, 1)).toHaveAttribute("data-active", "true");

    // The second Escape is the existing clear.
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Escape" });
    expect(gridCell(container, 1, 1)).not.toHaveAttribute("data-active");
  });

  it("clears both corners when the page's scope changes", () => {
    const { container, rerender } = renderGrid();
    fireEvent.keyDown(focusCell(container, 0, 1), { key: "ArrowRight", shiftKey: true });
    expect(screen.getByRole("group", { name: "Cell selection" })).toBeInTheDocument();

    rerender(gridElement({ scopeKey: "page-2" }));

    expect(screen.queryByRole("group", { name: "Cell selection" })).toBeNull();
    expect(selectedCells(container)).toHaveLength(0);
    expect(gridCell(container, 0, 1)).toHaveAttribute("data-active", "true");
  });
});

describe("copying cells", () => {
  // jsdom has no clipboard; the table only ever writes text.
  const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
  });

  afterEach(() => {
    if (originalClipboard) {
      Object.defineProperty(navigator, "clipboard", originalClipboard);
      return;
    }
    Reflect.deleteProperty(navigator, "clipboard");
  });

  /** The 2 × 2 rectangle over the title and Room columns of both rows. */
  function markRectangle(container: HTMLElement): HTMLElement {
    fireEvent.keyDown(focusCell(container, 0, 1), { key: "ArrowRight", shiftKey: true });
    fireEvent.keyDown(document.activeElement as HTMLElement, {
      key: "ArrowDown",
      shiftKey: true,
    });
    return document.activeElement as HTMLElement;
  }

  it("copies a marked rectangle as a TSV block on the keyboard", async () => {
    const { container } = renderGrid();
    const focus = markRectangle(container);

    fireEvent.keyDown(focus, { key: "c", ctrlKey: true });

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText).toHaveBeenCalledWith("Title\tRoom\nMonstera\tkitchen\nFern\tstudy");
    expect(await screen.findByRole("status")).toHaveTextContent("Copied 4 cells.");
  });

  it("copies the rectangle as a markdown table from the bar", async () => {
    const { container } = renderGrid();
    markRectangle(container);

    fireEvent.click(screen.getByRole("button", { name: "Copy as Markdown" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText).toHaveBeenCalledWith(
      [
        "| Title | Room |",
        "| --- | --- |",
        "| Monstera | kitchen |",
        "| Fern | study |",
      ].join("\n"),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Copied as a markdown table.",
    );
  });

  it("copies one focused cell's label without a header", async () => {
    const { container } = renderGrid();
    const focus = focusCell(container, 1, 2);

    fireEvent.keyDown(focus, { key: "c", metaKey: true });

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("study"));
    // The single cell has no bar, so its own polite region carries it too.
    expect(await screen.findByRole("status")).toHaveTextContent("Copied 1 cell.");
  });

  it("leaves mod+C to the browser while an editor has focus", () => {
    const { container } = renderGrid();
    fireEvent.keyDown(focusCell(container, 0, 1), { key: "Enter" });
    const editor = screen.getByRole("textbox", { name: "Title" });

    // Not prevented, so the editor's own select-all and copy keep working.
    expect(fireEvent.keyDown(editor, { key: "c", ctrlKey: true })).toBe(true);
    expect(writeText).not.toHaveBeenCalled();
  });

  it("leaves mod+C alone on a control column", () => {
    const { container } = renderGrid();
    const checkbox = focusCell(container, 0, 0);

    expect(fireEvent.keyDown(checkbox, { key: "c", ctrlKey: true })).toBe(true);
    expect(writeText).not.toHaveBeenCalled();
  });

  it("keeps the range and says so when the clipboard refuses", async () => {
    writeText.mockImplementationOnce(() => Promise.reject(new Error("denied")));
    const { container } = renderGrid();
    const focus = markRectangle(container);

    fireEvent.keyDown(focus, { key: "c", ctrlKey: true });

    expect(await screen.findByRole("alert")).toHaveTextContent("The browser refused the copy.");
    expect(screen.getByRole("group", { name: "Cell selection" })).toBeInTheDocument();
  });
});

/* The aggregation footer: one page of rows, summarised by format. */

const footerProperties: PropertyDef[] = [
  { key: "height", name: "Height", format: "number" },
  { key: "watered", name: "Watered", format: "checkbox" },
  { key: "due", name: "Due", format: "date" },
  {
    key: "linked",
    name: "Linked",
    format: "list",
    compute: { kind: "rollup", relation: "related", aggregate: "list" },
  },
  { key: "nursery", name: "Nursery", format: "text" },
];

const footerView: ViewDef = {
  key: "table",
  name: "Table",
  kind: "table",
  sorts: [],
  filter: { op: "and", conditions: [] },
  columns: ["title", "height", "watered", "due", "linked", "nursery"],
};

const footerRows: ObjectSummary[] = [
  {
    id: "0193d000-0000-7000-8000-000000000001",
    type: "plant",
    title: "Monstera",
    rev: 1,
    updated_at: "2026-11-11T00:00:00Z",
    values: {
      height: { value: 1, label: "1" },
      watered: { value: true, label: "" },
      due: { value: "2026-03-03", label: "Mar 3" },
      linked: { value: ["f"], label: "Fern" },
    },
    missing_relations: [],
  },
  {
    id: "0193d000-0000-7000-8000-000000000002",
    type: "plant",
    title: "Fern",
    rev: 1,
    updated_at: "2026-11-11T00:00:00Z",
    values: {
      height: { value: 2, label: "2" },
      watered: { value: false, label: "" },
      due: { value: "2026-11-09", label: "Nov 9" },
      linked: { value: ["f", "m"], label: "Fern, Monstera" },
    },
    missing_relations: [],
  },
  {
    id: "0193d000-0000-7000-8000-000000000003",
    type: "plant",
    title: "Cactus",
    rev: 1,
    updated_at: "2026-11-11T00:00:00Z",
    values: {},
    missing_relations: [],
  },
];

function footerElement({
  total = 3,
  canEdit = true,
}: { total?: number; canEdit?: boolean } = {}) {
  return (
    <TableView
      spaceId="space"
      type={gridType}
      view={footerView}
      rows={footerRows}
      properties={footerProperties}
      canEdit={canEdit}
      completing={false}
      busy={false}
      scopeKey="scope"
      total={total}
      sorts={[]}
      selected={new Set()}
      pendingRows={new Set()}
      bulkOpen={false}
      timeZone="America/Toronto"
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
    />
  );
}

function renderFooter(options: { total?: number; canEdit?: boolean } = {}) {
  return renderWithProviders(footerElement(options));
}

describe("the aggregation footer", () => {
  it("sums and averages a number column and names the filled cells", () => {
    renderFooter();

    expect(screen.getByText("Σ 3 · avg 1.5")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Height: 2 of 3 filled; sum 3; average 1.5; lowest 1; highest 2"),
    ).toBeInTheDocument();
  });

  it("counts checked boxes against the booleans it found", () => {
    renderFooter();
    expect(screen.getByText("1 of 2 checked")).toBeInTheDocument();
    expect(screen.getByLabelText("Watered: 2 of 3 filled; 1 checked")).toBeInTheDocument();
  });

  it("reads a date column as its earliest and latest day", () => {
    renderFooter();
    const day = (iso: string) =>
      new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      }).format(new Date(iso));
    expect(
      screen.getByText(`${day("2026-03-03T00:00:00Z")} – ${day("2026-11-09T00:00:00Z")}`),
    ).toBeInTheDocument();
  });

  it("counts the distinct labels of a calculated list column", () => {
    renderFooter();
    expect(screen.getByText("2 distinct")).toBeInTheDocument();
    expect(screen.getByLabelText("Linked: 2 of 3 filled; 2 distinct values")).toBeInTheDocument();
  });

  it("shows an empty column as an em dash with a spoken sentence", () => {
    renderFooter();
    expect(screen.getByLabelText("Nursery: none of the 3 rows have a value")).toHaveTextContent(
      "—",
    );
  });

  it("counts the title column as the rows it shows", () => {
    renderFooter();
    expect(screen.getByLabelText("Title: 3 rows")).toHaveTextContent("3 rows");
  });

  it("says when the footer covers only a page, and when it covers everything", () => {
    const { rerender } = renderFooter({ total: 340 });
    expect(
      screen.getByText("Summaries cover the 3 rows shown, not all 340."),
    ).toBeInTheDocument();

    rerender(footerElement({ total: 3 }));
    expect(screen.getByText("Summaries cover all 3 rows.")).toBeInTheDocument();
  });

  it("counts the footer as the grid's last row", () => {
    const { container } = renderFooter();
    expect(container.querySelector('[role="grid"]')).toHaveAttribute("aria-rowcount", "5");
  });

  it("renders for a viewer too", () => {
    renderFooter({ canEdit: false });
    expect(screen.getByText("Σ 3 · avg 1.5")).toBeInTheDocument();
  });
});
