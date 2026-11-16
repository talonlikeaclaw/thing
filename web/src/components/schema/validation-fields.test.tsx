import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  ValidationFields,
  emptyValidationDraft,
  validationApplies,
  validationDraft,
  validationPayload,
} from "@/components/schema/validation-fields";
import { renderWithProviders } from "@/test/harness";

describe("ValidationFields", () => {
  it("offers a pattern and uniqueness on a text property", () => {
    renderWithProviders(
      <ValidationFields
        draft={emptyValidationDraft()}
        onChange={() => undefined}
        format="text"
        idPrefix="property-code"
        initialOpen
      />,
    );

    expect(screen.getByLabelText("Pattern")).toBeInTheDocument();
    expect(screen.getByLabelText("One record per value")).toBeInTheDocument();
    expect(screen.queryByLabelText("Minimum")).toBeNull();
    expect(screen.queryByLabelText("Maximum")).toBeNull();
  });

  it("offers bounds and uniqueness on a number property", () => {
    renderWithProviders(
      <ValidationFields
        draft={emptyValidationDraft()}
        onChange={() => undefined}
        format="number"
        idPrefix="property-amount"
        initialOpen
      />,
    );

    expect(screen.getByLabelText("Minimum")).toBeInTheDocument();
    expect(screen.getByLabelText("Maximum")).toBeInTheDocument();
    expect(screen.getByLabelText("One record per value")).toBeInTheDocument();
    expect(screen.queryByLabelText("Pattern")).toBeNull();
  });

  it("offers nothing on a multi-value format", () => {
    renderWithProviders(
      <ValidationFields
        draft={emptyValidationDraft()}
        onChange={() => undefined}
        format="multi_select"
        idPrefix="property-tags"
        initialOpen
      />,
    );

    expect(screen.queryByText("Validation", { selector: "summary" })).toBeNull();
    expect(screen.queryByLabelText("One record per value")).toBeNull();
  });

  it("keeps its disclosure closed until the reader opens it", () => {
    renderWithProviders(
      <ValidationFields
        draft={emptyValidationDraft()}
        onChange={() => undefined}
        format="number"
        idPrefix="property-amount"
      />,
    );

    const disclosure = screen.getByLabelText("Minimum").closest("details");
    expect(disclosure?.open).toBe(false);
    fireEvent.click(screen.getByText("Validation", { selector: "summary" }));
    expect(disclosure?.open).toBe(true);
  });
});

describe("validationPayload", () => {
  it("writes nothing when no rule is set", () => {
    expect(validationPayload(emptyValidationDraft(), "number")).toBeNull();
    expect(validationPayload(emptyValidationDraft(), "text")).toBeNull();
  });

  it("carries a bound in its format's variant", () => {
    expect(
      validationPayload({ min: "0", max: "500", pattern: "", unique: false }, "number"),
    ).toEqual({ min: 0, max: 500 });
    expect(
      validationPayload(
        { min: "2026-01-01", max: "", pattern: "", unique: false },
        "date",
      ),
    ).toEqual({ min: "2026-01-01" });
  });

  it("carries only the fields the format can honour", () => {
    const draft = {
      min: "0",
      max: "500",
      pattern: "[A-Z]{2}",
      unique: true,
    };
    expect(validationPayload(draft, "text")).toEqual({
      pattern: "[A-Z]{2}",
      unique: true,
    });
    expect(validationPayload(draft, "number")).toEqual({
      min: 0,
      max: 500,
      unique: true,
    });
    expect(validationPayload(draft, "multi_select")).toBeNull();
    expect(validationPayload(draft, "relation", true)).toBeNull();
  });

  it("reads a stored block back without changing its spelling", () => {
    expect(validationDraft({ min: 0, pattern: "[A-Z]+", unique: true })).toEqual({
      min: "0",
      max: "",
      pattern: "[A-Z]+",
      unique: true,
    });
    expect(validationDraft(undefined)).toEqual(emptyValidationDraft());
  });
});

describe("validationApplies", () => {
  it("names the formats that have a rule to state", () => {
    expect(validationApplies("number")).toBe(true);
    expect(validationApplies("date")).toBe(true);
    expect(validationApplies("text")).toBe(true);
    expect(validationApplies("email")).toBe(true);
    expect(validationApplies("checkbox")).toBe(true);
    expect(validationApplies("relation", false)).toBe(true);
    expect(validationApplies("relation", true)).toBe(false);
    expect(validationApplies("multi_select")).toBe(false);
    expect(validationApplies("attachments")).toBe(false);
    expect(validationApplies("recurrence")).toBe(false);
    expect(validationApplies("list")).toBe(false);
  });
});
