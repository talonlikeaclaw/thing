import { describe, expect, it } from "vitest";

import { useRelationChoices } from "@/api/queries";
import type { ObjectList, PropertyDef, TypeSummary } from "@/api/types";
import { jsonResponse, renderWithProviders, requestUrl, stubFetch } from "@/test/harness";
import { screen } from "@testing-library/react";

const person: TypeSummary = {
  key: "person",
  name: "Person",
  name_plural: "People",
  description: "",
  schedule: false,
  property_count: 1,
  object_count: 1,
};

const list: ObjectList = {
  view: "all",
  total: 1,
  offset: 0,
  limit: 500,
  has_more: false,
  objects: [
    {
      id: "o1",
      type: "person",
      title: "Alice",
      rev: 1,
      updated_at: "2026-11-01T00:00:00Z",
      values: {},
      missing_relations: [],
    },
  ],
};

function Choices({ property }: { property: PropertyDef }) {
  const { choices, loading } = useRelationChoices("s1", property, true);
  return <p>{loading ? "loading" : choices.map((choice) => choice.title).join(", ")}</p>;
}

describe("useRelationChoices", () => {
  it("offers only the targets the relation's filter accepts", async () => {
    const property: PropertyDef = {
      key: "supervisor",
      name: "Supervisor",
      format: "relation",
      target_type: "person",
      target_filter: {
        op: "and",
        conditions: [{ property: "active", condition: "equal", value: true }],
      },
    };
    let listUrl = "";
    stubFetch((input) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/spaces/s1/types")) {
        return jsonResponse([person]);
      }
      if (url.includes("/api/spaces/s1/objects?")) {
        listUrl = url;
        return jsonResponse(list);
      }
      throw new Error(`unstubbed ${url}`);
    });

    renderWithProviders(<Choices property={property} />);

    expect(await screen.findByText("Alice")).toBeInTheDocument();
    const params = new URL(listUrl, "http://localhost").searchParams;
    expect(params.get("type")).toBe("person");
    expect(JSON.parse(params.get("filter") ?? "null")).toEqual(property.target_filter);
  });
});
