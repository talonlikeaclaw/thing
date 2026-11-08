import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { PropertyDef } from "@/api/types";
import { PropertyPicker } from "@/components/property-picker";
import { renderWithProviders } from "@/test/harness";

const properties: PropertyDef[] = [
  { key: "room", name: "Room", format: "text" },
  { key: "bedroom", name: "Bedroom", format: "select" },
  { key: "room_type", name: "Category", format: "text" },
];

/** Answer the two media questions the picker asks for one device shape. */
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

describe("PropertyPicker", () => {
  it("filters as you type and shows a sentence when nothing matches", async () => {
    renderWithProviders(
      <PropertyPicker
        variant="list"
        autoFocus
        properties={properties}
        value={null}
        onChange={() => undefined}
      />,
    );

    const field = screen.getByRole("combobox", { name: "Choose property" });
    expect(field).toHaveFocus();

    fireEvent.change(field, { target: { value: "ro" } });
    expect(screen.getAllByRole("option").map((row) => row.textContent)).toEqual([
      expect.stringContaining("Room"),
      expect.stringContaining("Bedroom"),
      expect.stringContaining("Category"),
    ]);

    fireEvent.change(field, { target: { value: "zzz" } });
    expect(screen.getByText("No property matches “zzz”.")).toBeInTheDocument();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("moves the active row with the arrow keys and chooses it with Enter", () => {
    const onChange = vi.fn();
    renderWithProviders(
      <PropertyPicker
        variant="list"
        autoFocus
        properties={properties}
        value={null}
        onChange={onChange}
      />,
    );

    const field = screen.getByRole("combobox", { name: "Choose property" });
    fireEvent.keyDown(field, { key: "ArrowDown" });
    const rows = screen.getAllByRole("option");
    expect(rows[1]).toHaveAttribute("aria-selected", "true");
    expect(field.getAttribute("aria-activedescendant")).toBe(rows[1]?.id);

    fireEvent.keyDown(field, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("bedroom");
  });

  it("shows the chosen property and its format on the trigger", () => {
    renderWithProviders(
      <PropertyPicker properties={properties} value="room" onChange={() => undefined} />,
    );

    const trigger = screen.getByRole("button", { name: "Choose property: Room" });
    expect(trigger).toHaveTextContent("Room");
    expect(trigger).toHaveTextContent("Text");
  });

  it("prints the type's own properties before the rest of the library", () => {
    renderWithProviders(
      <PropertyPicker
        variant="list"
        properties={properties}
        carried={new Set(["bedroom"])}
        value={null}
        onChange={() => undefined}
      />,
    );

    const groups = screen.getAllByRole("group");
    expect(groups.map((group) => group.getAttribute("aria-label"))).toEqual([
      "On this type",
      "In this space",
    ]);
    const rows = screen.getAllByRole("option");
    expect(rows[0]).toHaveTextContent("Bedroom");
    expect(rows[1]).toHaveTextContent("Room");
  });

  it("opens a popover, chooses a row and returns focus to the trigger", async () => {
    stubMedia(false);
    const onChange = vi.fn();
    renderWithProviders(
      <PropertyPicker
        label="Add a property"
        properties={properties}
        value={null}
        onChange={onChange}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Add a property" });
    fireEvent.click(trigger);
    const field = await screen.findByRole("combobox", { name: "Choose property" });
    expect(field).toHaveFocus();

    fireEvent.click(screen.getByRole("option", { name: /Room/ }));
    expect(onChange).toHaveBeenCalledWith("room");
    await waitFor(() => expect(screen.queryByRole("combobox")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("opens the shared sheet on a phone with the search field focused", async () => {
    stubMedia(true);
    renderWithProviders(
      <PropertyPicker
        label="Add a property"
        properties={properties}
        value={null}
        onChange={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add a property" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    const field = screen.getByRole("combobox", { name: "Choose property" });
    await waitFor(() => expect(field).toHaveFocus());
  });
});
