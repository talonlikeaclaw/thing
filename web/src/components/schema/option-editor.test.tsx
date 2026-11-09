import { fireEvent, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { HandednessProvider } from "@/components/handedness";
import { OptionEditor } from "@/components/schema/option-editor";
import type { OptionDraft } from "@/lib/schema";
import { renderWithProviders } from "@/test/harness";

const drafts: OptionDraft[] = [
  { id: "kitchen", key: "kitchen", name: "Kitchen", color: "#c8d96b" },
  { id: "study", key: "study", name: "Study", color: "#7aa2f7" },
  { id: "balcony", key: "balcony", name: "Balcony", color: "#e0af68" },
];

function Host() {
  const [current, setCurrent] = useState<OptionDraft[]>(drafts);
  return (
    <div>
      <output data-testid="options">{JSON.stringify(current.map((draft) => draft.name))}</output>
      <OptionEditor drafts={current} onChange={setCurrent} canEdit idPrefix="room" />
    </div>
  );
}

function published(): string[] {
  return JSON.parse(screen.getByTestId("options").textContent ?? "[]") as string[];
}

describe("OptionEditor", () => {
  it("moves an option in one choice instead of repeated chevrons", () => {
    renderWithProviders(<Host />);

    fireEvent.click(screen.getByRole("button", { name: "Move Kitchen: position 1 of 3" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Move to position 3" }));

    expect(published()).toEqual(["Study", "Balcony", "Kitchen"]);
  });

  it("puts the position control on the thumb edge of a right hand", () => {
    renderWithProviders(<Host />);

    const position = screen.getByRole("button", { name: "Move Kitchen: position 1 of 3" });
    const remove = screen.getByRole("button", { name: "Remove Kitchen" });
    expect(
      remove.compareDocumentPosition(position) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("moves the row actions to the left thumb edge in left mode", () => {
    renderWithProviders(
      <HandednessProvider value={{ handedness: "left", setHandedness: () => undefined }}>
        <Host />
      </HandednessProvider>,
    );

    const position = screen.getByRole("button", { name: "Move Kitchen: position 1 of 3" });
    const remove = screen.getByRole("button", { name: "Remove Kitchen" });
    expect(
      position.compareDocumentPosition(remove) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
