import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { PropertyDef } from "@/api/types";
import { PropertyCell } from "@/components/property-cell";
import { renderWithProviders } from "@/test/harness";

afterEach(cleanup);

const formula: PropertyDef = {
  key: "label",
  name: "Label",
  format: "text",
  compute: { kind: "formula", expression: 'title + " / " + room' },
};

const rollup: PropertyDef = {
  key: "room_titles",
  name: "Room titles",
  format: "list",
  compute: { kind: "rollup", relation: "room", property: "title", aggregate: "list" },
};

function renderCell(property: PropertyDef, value: unknown, label: string) {
  return render(
    <PropertyCell
      spaceId="space"
      property={property}
      cell={{ value, label }}
      schedule={undefined}
      canEdit
      rowTitle="Monstera"
      description={`Formula: ${property.compute?.expression ?? "count"}`}
      onCommit={() => Promise.resolve({ ok: true })}
    />,
  );
}

describe("a calculated cell", () => {
  it("is read-only text with no editor to open", () => {
    renderCell(formula, "Monstera / kitchen", "Monstera / kitchen");
    expect(screen.queryByRole("button")).toBeNull();
    const cell = screen.getByText("Monstera / kitchen");
    const readOnly = cell.closest("[aria-readonly='true']");
    expect(readOnly).not.toBeNull();
    expect(readOnly).toHaveAttribute("title", "Formula: title + \" / \" + room");
  });

  it("renders a list rollup as its joined labels", () => {
    renderCell(rollup, ["Monstera", "Fern"], "Monstera, Fern");
    expect(screen.getByText("Monstera, Fern")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("does not change a stored cell's editor", () => {
    const stored: PropertyDef = { key: "room", name: "Room", format: "text" };
    renderCell(stored, "kitchen", "kitchen");
    expect(
      screen.getByRole("button", { name: /Edit Room for “Monstera”/ }),
    ).toBeInTheDocument();
  });
});

describe("a floating editor", () => {
  it("returns focus to its cell when it closes", async () => {
    const select: PropertyDef = {
      key: "room",
      name: "Room",
      format: "select",
      options: [{ key: "kitchen", name: "Kitchen", color: "red" }],
    };
    renderWithProviders(
      <>
        {/* The toolbar control the reader touched before the cell. */}
        <button type="button">Columns</button>
        <PropertyCell
          spaceId="space"
          property={select}
          cell={{ value: "kitchen", label: "Kitchen" }}
          schedule={undefined}
          canEdit
          rowTitle="Monstera"
          onCommit={() => Promise.resolve({ ok: true })}
        />
      </>,
    );

    act(() => screen.getByRole("button", { name: "Columns" }).focus());
    const cell = screen.getByRole("button", { name: /Edit Room for “Monstera”/ });
    act(() => cell.focus());
    fireEvent.click(cell);

    const editor = await screen.findByLabelText("Room editor for “Monstera”");
    fireEvent.keyDown(editor, { key: "Escape" });

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Edit Room for “Monstera”/ })).toHaveFocus(),
    );
  });
});
