import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ChoicePicker, type Choice } from "@/components/choice-picker";
import { renderWithProviders } from "@/test/harness";

const choices: Choice[] = [
  { id: "kitchen", label: "Kitchen", hint: "kitchen" },
  { id: "study", label: "Study", hint: "study" },
  { id: "hall", label: "Hall", hint: "hall" },
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

describe("ChoicePicker", () => {
  it("moves a highlighted row with the arrow keys and chooses it with Enter", async () => {
    stubMedia(false);
    const onChange = vi.fn();
    renderWithProviders(
      <ChoicePicker
        choices={choices}
        value={null}
        multiple={false}
        onChange={onChange}
        label="Filter Room value"
      />,
    );

    const trigger = screen.getByRole("button", { name: "Filter Room value" });
    expect(trigger).toHaveTextContent("Choose a value");
    fireEvent.click(trigger);

    const field = await screen.findByRole("combobox", { name: "Search filter room value" });
    const rows = screen.getAllByRole("option");
    expect(field.getAttribute("aria-activedescendant")).toBe(rows[0]?.id);

    fireEvent.keyDown(field, { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
    expect(field.getAttribute("aria-activedescendant")).toBe(
      screen.getAllByRole("option")[1]?.id,
    );

    fireEvent.keyDown(field, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("study");
  });

  it("closes on Escape and returns focus to its field", async () => {
    stubMedia(false);
    renderWithProviders(
      <ChoicePicker
        choices={choices}
        value={null}
        multiple={false}
        onChange={() => undefined}
        label="Filter Room value"
      />,
    );

    const trigger = screen.getByRole("button", { name: "Filter Room value" });
    fireEvent.click(trigger);
    await screen.findByRole("combobox");
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("combobox")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("toggles several values and marks each chosen row", async () => {
    stubMedia(false);
    const onChange = vi.fn();
    const { rerender } = renderWithProviders(
      <ChoicePicker
        choices={choices}
        value={null}
        multiple
        onChange={onChange}
        label="Filter Artist target"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Filter Artist target" }));
    fireEvent.click(await screen.findByRole("option", { name: /Kitchen/ }));
    expect(onChange).toHaveBeenLastCalledWith(["kitchen"]);

    rerender(
      <ChoicePicker
        choices={choices}
        value={["kitchen"]}
        multiple
        onChange={onChange}
        label="Filter Artist target"
      />,
    );
    const picked = screen.getAllByRole("option")[0];
    expect(picked).toHaveTextContent("Kitchen");
    expect(picked?.querySelector("svg")).not.toBeNull();
  });

  it("says when nothing matches", async () => {
    stubMedia(false);
    renderWithProviders(
      <ChoicePicker
        choices={choices}
        value={null}
        multiple={false}
        onChange={() => undefined}
        label="Filter Room value"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Filter Room value" }));
    fireEvent.change(await screen.findByRole("combobox"), { target: { value: "zzz" } });
    expect(screen.getByText("No value matches “zzz”.")).toBeInTheDocument();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("renders its list in place on a phone instead of a second overlay", () => {
    stubMedia(true);
    renderWithProviders(
      <ChoicePicker
        choices={choices}
        value={null}
        multiple={false}
        onChange={() => undefined}
        label="Filter Room value"
      />,
    );

    expect(screen.queryByRole("button", { name: "Filter Room value" })).not.toBeInTheDocument();
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });
});

describe("ChoicePicker while its list is still reading", () => {
  it("says what it is doing instead of showing an empty field", async () => {
    stubMedia(false);
    renderWithProviders(
      <ChoicePicker
        choices={[]}
        value={null}
        multiple={false}
        onChange={() => undefined}
        label="Filter Artist target"
        loading
      />,
    );

    expect(screen.getByRole("button", { name: "Filter Artist target" })).toHaveTextContent(
      "Reading values…",
    );
    fireEvent.click(screen.getByRole("button", { name: "Filter Artist target" }));
    await screen.findByRole("listbox");
    expect(screen.getAllByText("Reading values…")).toHaveLength(2);
    expect(screen.getByRole("listbox")).toHaveClass("min-h-24");
  });

  it("does not print a target's id while its title is unresolved", () => {
    stubMedia(false);
    renderWithProviders(
      <ChoicePicker
        choices={[]}
        value="m1"
        multiple={false}
        onChange={() => undefined}
        label="Filter Artist target"
        loading
      />,
    );

    const trigger = screen.getByRole("button", { name: "Filter Artist target" });
    expect(trigger).toHaveTextContent("Reading values…");
    expect(trigger).not.toHaveTextContent("m1");
  });
});
