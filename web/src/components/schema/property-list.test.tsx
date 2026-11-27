import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { PropertyDef } from "@/api/types";
import { PropertyList } from "@/components/schema/property-list";
import { renderWithProviders } from "@/test/harness";

const properties: PropertyDef[] = [
  { key: "room", name: "Room", format: "text" },
  {
    key: "days_since_watered",
    name: "Days since watered",
    format: "number",
    compute: {
      kind: "formula",
      expression: "days(last_completed_at, today())",
    },
  },
];

function renderList({ creating = false }: { creating?: boolean } = {}) {
  return renderWithProviders(
    <PropertyList
      spaceId="s1"
      properties={properties}
      types={[]}
      selectedKey={undefined}
      canEdit
      onSelect={() => undefined}
      onCreated={() => undefined}
      creating={creating}
      onCreatingChange={() => undefined}
    />,
  );
}

describe("PropertyList", () => {
  it("marks a calculated definition with its result format", () => {
    renderList();
    expect(screen.getByText("Formula · Number")).toBeInTheDocument();
  });

  it("never offers the calculated list format to a stored property", async () => {
    renderList({ creating: true });

    fireEvent.click(screen.getByRole("combobox", { name: "Format" }));
    await screen.findByRole("listbox");
    const labels = screen.getAllByRole("option").map((option) => option.textContent);
    expect(labels).not.toContain("List");
    expect(labels).toContain("Attachments");
  });

  it("reveals the expression field when the new property is a formula", () => {
    renderList({ creating: true });
    fireEvent.click(screen.getByRole("radio", { name: "Formula" }));

    expect(screen.getByLabelText("Expression")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Format" })).not.toBeInTheDocument();
  });
});
