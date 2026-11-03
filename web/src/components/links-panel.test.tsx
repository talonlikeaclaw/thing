import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ObjectDetail } from "@/api/types";
import { LinksPanel } from "@/components/links-panel";
import { jsonResponse, renderWithProviders, requestUrl, stubFetch } from "@/test/harness";

const types = [
  {
    key: "plant",
    name: "Plant",
    name_plural: "Plants",
    description: "",
    schedule: false,
    property_count: 0,
    object_count: 0,
  },
  {
    key: "task",
    name: "Task",
    name_plural: "Tasks",
    description: "",
    schedule: false,
    property_count: 0,
    object_count: 0,
  },
];

function objectDetail(overrides: Partial<ObjectDetail> = {}): ObjectDetail {
  return {
    id: "o1",
    type: "plant",
    title: "Monstera in the study",
    rev: 1,
    created_at: "2026-11-01T12:00:00Z",
    updated_at: "2026-11-01T12:00:00Z",
    created_by: "u1",
    updated_by: "u1",
    properties: {},
    body: "",
    missing_relations: [],
    ...overrides,
  };
}

function stubTypes() {
  stubFetch((input) => {
    const url = requestUrl(input);
    if (url.endsWith("/api/spaces/s1/types")) {
      return jsonResponse(types);
    }
    throw new Error(`unstubbed ${url}`);
  });
}

describe("LinksPanel", () => {
  it("lists incoming relations and mentions as separate groups with their counts", async () => {
    stubTypes();
    renderWithProviders(
      <LinksPanel
        spaceId="s1"
        object={objectDetail({
          backlinks: [
            {
              kind: "relation",
              id: "o2",
              type: "task",
              title: "Water the monstera",
              property: "related_plant",
              property_name: "Related plant",
            },
            {
              kind: "mention",
              id: "o3",
              type: "plant",
              title: "Fiddle-leaf fig",
              snippet: "Next to the monstera.",
              count: 2,
            },
          ],
        })}
      />,
    );

    expect(screen.getByRole("heading", { name: "Links" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Linked from" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Mentioned in" })).toBeInTheDocument();
    const [linkedFrom, mentionedIn] = screen.getAllByRole("list");
    expect(within(linkedFrom!).getByText("Water the monstera")).toBeInTheDocument();
    expect(within(linkedFrom!).getByText(/via Related plant/)).toBeInTheDocument();
    expect(await within(linkedFrom!).findByText(/Task/)).toBeInTheDocument();
    expect(within(mentionedIn!).getByText("Fiddle-leaf fig")).toBeInTheDocument();
    expect(within(mentionedIn!).getByText("×2")).toBeInTheDocument();
    expect(within(mentionedIn!).getByText("Next to the monstera.")).toBeInTheDocument();
    expect(screen.getByText("2", { selector: ".tnum" })).toBeInTheDocument();
  });

  it("offers the graph when there is an incoming row", () => {
    stubTypes();
    renderWithProviders(
      <LinksPanel
        spaceId="s1"
        object={objectDetail({
          backlinks: [
            {
              kind: "mention",
              id: "o3",
              type: "plant",
              title: "Fiddle-leaf fig",
              snippet: "Next to the monstera.",
              count: 1,
            },
          ],
        })}
      />,
    );

    expect(screen.getByText("Graph")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Graph scope" })).toBeInTheDocument();
  });

  it("shows the empty state and no graph when neither direction has a row", () => {
    stubTypes();
    renderWithProviders(<LinksPanel spaceId="s1" object={objectDetail()} />);

    expect(screen.getByText(/No links yet/)).toBeInTheDocument();
    expect(screen.queryByText("Graph")).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Graph scope" })).not.toBeInTheDocument();
  });
});
