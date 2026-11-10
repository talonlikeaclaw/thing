import { fireEvent, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { ViewSheet, type ViewSheetPanel } from "@/components/views/view-sheet";
import { renderWithProviders } from "@/test/harness";

/** The sheet over one panel the host owns, like the type page. */
function Host() {
  const [open, setOpen] = useState(true);
  const [panel, setPanel] = useState<ViewSheetPanel>("menu");
  return (
    <div>
      <output data-testid="panel">{panel}</output>
      <ViewSheet
        open={open}
        onOpenChange={setOpen}
        panel={panel}
        onPanelChange={setPanel}
        canEdit
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
  it("holds every view action with its active count", () => {
    renderWithProviders(<Host />);

    expect(screen.getByRole("button", { name: "Sort, 2" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Columns, 7" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View settings" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save as view…" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Data — CSV" })).toBeInTheDocument();
  });

  it("opens Sort and Columns in the same sheet behind Back", () => {
    renderWithProviders(<Host />);

    fireEvent.click(screen.getByRole("button", { name: "Sort, 2" }));
    expect(screen.getByText("Sort body")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    fireEvent.click(screen.getByRole("button", { name: "Columns, 7" }));
    expect(screen.getByText("Columns body")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("button", { name: "Sort, 2" })).toBeInTheDocument();
  });

  it("swaps the body in place and returns through Back", () => {
    renderWithProviders(<Host />);

    fireEvent.click(screen.getByRole("button", { name: "View settings" }));
    expect(screen.getByTestId("panel")).toHaveTextContent("settings");
    expect(screen.getByText("Settings body")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Data — CSV" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByTestId("panel")).toHaveTextContent("menu");
    expect(screen.getByRole("button", { name: "Data — CSV" })).toBeInTheDocument();
  });

  it("withholds the editor rows from a viewer", () => {
    renderWithProviders(
      <ViewSheet
        open
        onOpenChange={() => undefined}
        panel="menu"
        onPanelChange={() => undefined}
        canEdit={false}
        counts={{ sorts: 0, columns: 0 }}
        panels={{}}
      />,
    );

    expect(screen.queryByRole("button", { name: "View settings" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Columns, 0" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sort" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save as view…" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Data — CSV" })).toBeInTheDocument();
  });

  it("closes back to its opener", () => {
    renderWithProviders(<Host />);

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("button", { name: "Data — CSV" })).not.toBeInTheDocument();
  });
});
