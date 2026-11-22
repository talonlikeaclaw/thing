import { fireEvent, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import type { PropertyDef, TypeDef } from "@/api/types";
import {
  ComputedFields,
  computedDraft,
  computedDraftProblem,
  computedPatch,
  computedPayload,
  emptyComputedDraft,
  type ComputedDraft,
} from "@/components/schema/computed-fields";
import { renderWithProviders } from "@/test/harness";

const relation: PropertyDef = {
  key: "related_plant",
  name: "Related plant",
  format: "relation",
  target_type: "plant",
};

const height: PropertyDef = {
  key: "height",
  name: "Height",
  format: "number",
};

const room: PropertyDef = {
  key: "room",
  name: "Room",
  format: "text",
};

const formula: PropertyDef = {
  key: "days_since_watered",
  name: "Days since watered",
  format: "number",
  compute: {
    kind: "formula",
    expression: "days(last_completed_at, today())",
  },
};

const rollup: PropertyDef = {
  key: "related_titles",
  name: "Related titles",
  format: "list",
  compute: {
    kind: "rollup",
    relation: "related_plant",
    aggregate: "list",
    property: "title",
  },
};

const plant: TypeDef = {
  key: "plant",
  name: "Plant",
  name_plural: "Plants",
  description: "",
  schedule: false,
  properties: [
    { key: "related_plant", required: false, featured: true },
    { key: "height", required: false, featured: true },
    { key: "room", required: false, featured: true },
  ],
  views: [],
  default_view: "table",
};

function draftOf(property: PropertyDef | undefined): ComputedDraft {
  return computedDraft(property);
}

describe("computed property authoring", () => {
  it("turns a saved calculation into a patch and a create payload", () => {
    expect(computedPatch(draftOf(formula))).toEqual({
      compute: {
        kind: "formula",
        expression: "days(last_completed_at, today())",
      },
    });
    expect(computedPayload(draftOf(rollup))).toEqual({
      format: "list",
      compute: {
        kind: "rollup",
        relation: "related_plant",
        aggregate: "list",
        property: "title",
      },
    });
    expect(computedPatch(draftOf({ key: "room", name: "Room", format: "text" }))).toEqual({});
    expect(computedPayload(emptyComputedDraft())).toEqual({ format: "text" });
  });

  it("carries a rollup's target filter in the draft and the patch", () => {
    const filtered: PropertyDef = {
      key: "study_titles",
      name: "Study titles",
      format: "list",
      compute: {
        kind: "rollup",
        relation: "related_plant",
        aggregate: "list",
        property: "title",
        filter: {
          op: "and",
          conditions: [{ property: "room", condition: "equal", value: "study" }],
        },
      },
    };

    expect(computedDraft(filtered).filter).toEqual(filtered.compute?.filter);
    expect(computedPayload(computedDraft(filtered))).toEqual({
      format: "list",
      compute: {
        kind: "rollup",
        relation: "related_plant",
        aggregate: "list",
        property: "title",
        filter: {
          op: "and",
          conditions: [{ property: "room", condition: "equal", value: "study" }],
        },
      },
    });
    expect(
      computedPayload({
        ...emptyComputedDraft(),
        kind: "rollup",
        relation: "related_plant",
        format: "number",
      }).compute,
    ).not.toHaveProperty("filter");
  });

  it("refuses an empty expression or relation on its own", () => {
    expect(computedDraftProblem({ ...emptyComputedDraft(), kind: "formula" })).toBe(
      "Write an expression.",
    );
    expect(
      computedDraftProblem({
        ...emptyComputedDraft(),
        kind: "formula",
        expression: "x".repeat(501),
      }),
    ).toContain("the limit is 500");
    expect(computedDraftProblem({ ...emptyComputedDraft(), kind: "rollup" })).toBe(
      "Choose a relation.",
    );
  });

  it("derives a list result from the rollup aggregate", async () => {
    function Host() {
      const [draft, setDraft] = useState<ComputedDraft>(() => draftOf(undefined));
      return (
        <>
          <output data-testid="draft">{JSON.stringify(draft)}</output>
          <ComputedFields
            draft={draft}
            onChange={setDraft}
            library={[relation, height]}
            type={plant}
            types={[plant]}
            idPrefix="test"
          />
        </>
      );
    }
    renderWithProviders(<Host />);

    fireEvent.click(screen.getByRole("radio", { name: "Summary" }));
    fireEvent.click(screen.getByRole("combobox", { name: "Aggregate" }));
    const option = await screen.findByRole("option", { name: "List" });
    fireEvent.pointerDown(option, { pointerType: "mouse" });
    fireEvent.click(option);

    const draft = JSON.parse(screen.getByTestId("draft").textContent ?? "{}") as ComputedDraft;
    expect(draft.format).toBe("list");
    expect(draft.property).toBe("title");
    expect(
      screen.queryByRole("combobox", { name: "Result type" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Follows the aggregate and the linked property."),
    ).toBeInTheDocument();
  });

  it("suggests the type's stored properties while typing an expression", () => {
    renderWithProviders(
      <ComputedFields
        draft={{
          ...emptyComputedDraft(),
          kind: "formula",
          expression: "hei",
        }}
        onChange={() => undefined}
        library={[relation, height]}
        type={plant}
        types={[plant]}
        idPrefix="test"
      />,
    );

    const suggestions = screen.getByLabelText("Formula suggestions");
    expect(suggestions).toHaveTextContent("height");
    expect(suggestions).not.toHaveTextContent("related_plant");
  });

  it("explains what a rollup does", () => {
    renderWithProviders(
      <ComputedFields
        draft={{
          ...emptyComputedDraft(),
          kind: "rollup",
          relation: "related_plant",
          format: "number",
        }}
        onChange={() => undefined}
        library={[relation, height]}
        type={plant}
        types={[plant]}
        idPrefix="test"
      />,
    );

    expect(
      screen.getByText(/Summarises the records a relation points at/),
    ).toBeInTheDocument();
    expect(screen.getByText("Counts the linked records this row has.")).toBeInTheDocument();
  });

  it("keeps a rollup's target filter when the aggregate changes", async () => {
    function Host() {
      const [draft, setDraft] = useState<ComputedDraft>(() => ({
        ...draftOf(undefined),
        kind: "rollup",
        relation: "related_plant",
        aggregate: "count",
        format: "number",
        filter: {
          op: "and",
          conditions: [{ property: "room", condition: "equal", value: "study" }],
        },
      }));
      return (
        <>
          <output data-testid="draft">{JSON.stringify(draft)}</output>
          <ComputedFields
            draft={draft}
            onChange={setDraft}
            library={[relation, height, room]}
            type={plant}
            types={[plant]}
            idPrefix="test"
          />
        </>
      );
    }
    renderWithProviders(<Host />);

    fireEvent.click(screen.getByRole("combobox", { name: "Aggregate" }));
    const option = await screen.findByRole("option", { name: "Sum" });
    fireEvent.pointerDown(option, { pointerType: "mouse" });
    fireEvent.click(option);

    const draft = JSON.parse(screen.getByTestId("draft").textContent ?? "{}") as ComputedDraft;
    expect(draft.aggregate).toBe("sum");
    expect(draft.filter).toEqual({
      op: "and",
      conditions: [{ property: "room", condition: "equal", value: "study" }],
    });
    expect(screen.getByText("Only linked records matching")).toBeInTheDocument();
  });

  it("opens the insert catalog on its fields and keeps the language folded", () => {
    renderWithProviders(
      <ComputedFields
        draft={{ ...emptyComputedDraft(), kind: "formula", format: "number" }}
        onChange={() => undefined}
        library={[relation, height]}
        type={plant}
        types={[plant]}
        idPrefix="test"
      />,
    );
    const tabs = screen.getByRole("tablist", { name: "Insert categories" });
    expect(within(tabs).getByRole("tab", { name: /^Fields/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveTextContent("height");
    expect(panel).toHaveTextContent("Number");
    expect(panel).not.toHaveTextContent("round(number, digits)");
    expect(screen.queryByLabelText("Formula suggestions")).not.toBeInTheDocument();
    expect(screen.getByText("Examples")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "price * quantity" }),
    ).toBeInTheDocument();

    fireEvent.click(within(tabs).getByRole("tab", { name: /^Numbers/ }));
    expect(screen.getByRole("tabpanel")).toHaveTextContent("round(number, digits)");
  });

  it("inserts a function and an operator from their folds", () => {
    function Host() {
      const [draft, setDraft] = useState<ComputedDraft>(() => ({
        ...draftOf(undefined),
        kind: "formula",
        format: "number",
        expression: "height",
      }));
      return (
        <>
          <output data-testid="draft">{JSON.stringify(draft)}</output>
          <ComputedFields
            draft={draft}
            onChange={setDraft}
            library={[relation, height, room]}
            type={plant}
            types={[plant]}
            idPrefix="test"
          />
        </>
      );
    }
    renderWithProviders(<Host />);

    const tabs = screen.getByRole("tablist", { name: "Insert categories" });
    fireEvent.click(within(tabs).getByRole("tab", { name: /^Dates/ }));
    fireEvent.click(
      within(screen.getByRole("tabpanel")).getByRole("button", {
        name: /^format_date/,
      }),
    );
    let draft = JSON.parse(screen.getByTestId("draft").textContent ?? "{}") as ComputedDraft;
    expect(draft.expression).toBe("format_date(");

    fireEvent.click(within(tabs).getByRole("tab", { name: /^Values & operators/ }));
    fireEvent.click(
      within(screen.getByRole("tabpanel")).getByRole("button", { name: "*" }),
    );
    draft = JSON.parse(screen.getByTestId("draft").textContent ?? "{}") as ComputedDraft;
    expect(draft.expression).toBe("format_date(*");
  });

  it("keeps an existing calculation's kind and result fixed", () => {
    const onDraft = () => undefined;
    renderWithProviders(
      <ComputedFields
        draft={draftOf(formula)}
        onChange={onDraft}
        library={[formula]}
        existing
        idPrefix="test"
      />,
    );

    expect(screen.queryByRole("radiogroup", { name: "Value kind" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Result type" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Expression")).toHaveValue(
      "days(last_completed_at, today())",
    );
  });
});
