import { fireEvent, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { ViewSheet, type ViewSheetPanel } from "@/components/views/view-sheet";
import { renderWithProviders } from "@/test/harness";

/** The sheet over one panel the host owns, like the type page. */
function Host({ canEdit = true }: { canEdit?: boolean } = {}) {
  const [open, setOpen] = useState(true);
  const [panel, setPanel] = useState<ViewSheetPanel>("columns");
  const available: ViewSheetPanel[] = canEdit
    ? ["columns", "sort", "settings", "save", "data"]
    : ["sort", "data"];
  return (
    <div>
      <output data-testid="panel">{panel}</output>
      <ViewSheet
        open={open}
        onOpenChange={setOpen}
        panel={panel}
        onPanelChange={setPanel}
        viewName="All"
        kind="table"
        available={available}
        counts={{ sorts: 2, columns: 7 }}
        panels={{
          sort: <p>Sort body</p>,
          columns: <p>Columns body</p>,
          settings: <p>Settings body</p>,
          save: <p>Save body</p>,
          data: <p>Data body</p>,
        }}
      />
    </div>
  );
}

describe("ViewSheet", () => {
  it("puts every view surface one tab from the view", () => {
    renderWithProviders(<Host />);

    expect(screen.getByRole("tab", { name: "Columns, 7" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Sort, 2" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "General" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Save as view" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Data" })).toBeInTheDocument();
    // The sheet names the view it edits and says what the view holds.
    expect(screen.getByText("All")).toBeInTheDocument();
    expect(screen.getByText("table view · 7 columns · 2 sorts")).toBeInTheDocument();
    expect(screen.getByText("Columns body")).toBeInTheDocument();
  });

  it("swaps the body in place without a menu or a Back step", () => {
    renderWithProviders(<Host />);

    fireEvent.click(screen.getByRole("tab", { name: "Sort, 2" }));
    expect(screen.getByTestId("panel")).toHaveTextContent("sort");
    expect(screen.getByText("Sort body")).toBeInTheDocument();
    expect(screen.queryByText("Columns body")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "General" }));
    expect(screen.getByText("Settings body")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Back" })).not.toBeInTheDocument();
  });

  it("withholds the editor tabs from a viewer", () => {
    renderWithProviders(<Host canEdit={false} />);

    expect(screen.queryByRole("tab", { name: /Columns/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "General" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Save as view" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Sort, 2" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Data" })).toBeInTheDocument();
  });

  it("moves between panels with the arrow keys", () => {
    renderWithProviders(<Host />);

    const columns = screen.getByRole("tab", { name: "Columns, 7" });
    expect(columns).toHaveAttribute("tabindex", "0");

    fireEvent.keyDown(columns, { key: "ArrowRight" });
    expect(screen.getByTestId("panel")).toHaveTextContent("sort");
    expect(screen.getByRole("tab", { name: "Sort, 2" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Columns, 7" })).toHaveAttribute("tabindex", "-1");

    fireEvent.keyDown(screen.getByRole("tab", { name: "Sort, 2" }), { key: "End" });
    expect(screen.getByTestId("panel")).toHaveTextContent("data");
  });

  it("closes back to its opener", () => {
    renderWithProviders(<Host />);

    fireEvent.click(screen.getByRole("button", { name: "Close view" }));
    expect(screen.queryByRole("tab", { name: "Data" })).not.toBeInTheDocument();
  });
});
