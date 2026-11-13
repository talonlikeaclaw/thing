import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  DisplayFields,
  displayDraft,
  displayPayload,
  emptyDisplayDraft,
} from "@/components/schema/display-fields";
import { renderWithProviders } from "@/test/harness";

describe("DisplayFields", () => {
  it("offers only the alignment on a text property", () => {
    renderWithProviders(
      <DisplayFields
        draft={emptyDisplayDraft()}
        onChange={() => undefined}
        format="text"
        idPrefix="property-room"
        initialOpen
      />,
    );

    expect(screen.getByRole("radiogroup", { name: "Alignment" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Currency")).toBeNull();
    expect(screen.queryByLabelText("Decimals")).toBeNull();
    expect(screen.queryByText("Thousands separators")).toBeNull();
  });

  it("offers the number grammar on a number property", () => {
    renderWithProviders(
      <DisplayFields
        draft={emptyDisplayDraft()}
        onChange={() => undefined}
        format="number"
        idPrefix="property-amount"
        initialOpen
      />,
    );

    expect(screen.getByLabelText("Currency")).toBeInTheDocument();
    expect(screen.getByLabelText("Decimals")).toBeInTheDocument();
    expect(screen.getByLabelText("Thousands separators")).toBeInTheDocument();
  });

  it("keeps its disclosure closed until the reader opens it", () => {
    renderWithProviders(
      <DisplayFields
        draft={emptyDisplayDraft()}
        onChange={() => undefined}
        format="number"
        idPrefix="property-amount"
      />,
    );

    const disclosure = screen.getByLabelText("Currency").closest("details");
    expect(disclosure?.open).toBe(false);
    fireEvent.click(screen.getByText("Display", { selector: "summary" }));
    expect(disclosure?.open).toBe(true);
  });
});

describe("displayPayload", () => {
  it("writes nothing when every field is a default", () => {
    expect(displayPayload(emptyDisplayDraft(), "number")).toBeNull();
    expect(displayPayload(emptyDisplayDraft(), "text")).toBeNull();
  });

  it("carries only the fields the format can honour", () => {
    expect(
      displayPayload(
        { align: "auto", currency: "USD", decimals: "2", grouping: true },
        "text",
      ),
    ).toBeNull();
    expect(
      displayPayload(
        { align: "left", currency: "USD", decimals: "0", grouping: false },
        "number",
      ),
    ).toEqual({ align: "left", currency: "USD", decimals: 0, grouping: false });
  });

  it("reads a stored block back without changing its spelling", () => {
    expect(displayDraft({ currency: "EUR", decimals: 2 })).toEqual({
      align: "auto",
      currency: "EUR",
      decimals: "2",
      grouping: true,
    });
    expect(displayDraft(undefined)).toEqual(emptyDisplayDraft());
  });
});
