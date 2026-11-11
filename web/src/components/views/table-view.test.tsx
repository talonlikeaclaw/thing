import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

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
