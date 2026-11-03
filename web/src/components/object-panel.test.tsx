import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// The dirty guard needs a data router; this test covers the rename write path.
vi.mock("@/lib/use-dirty-guard", () => ({
  useDirtyGuard: () => null,
}));

import type { ObjectDetail, TypeDef } from "@/api/types";
import { ObjectPanel } from "@/components/object-panel";
import { jsonResponse, renderWithProviders, requestUrl, stubFetch } from "@/test/harness";

const types = [
  {
    key: "plant",
    name: "Plant",
    name_plural: "Plants",
    description: "",
    schedule: false,
    property_count: 0,
    object_count: 1,
  },
  {
    key: "task",
    name: "Task",
    name_plural: "Tasks",
    description: "",
    schedule: false,
    property_count: 0,
    object_count: 1,
  },
];

const plantType: TypeDef = {
  key: "plant",
  name: "Plant",
  name_plural: "Plants",
  description: "",
  schedule: false,
  properties: [],
  views: [],
  default_view: "",
};

function targetDetail(overrides: Partial<ObjectDetail> = {}): ObjectDetail {
  return {
    id: "o1",
    type: "plant",
    title: "Monstera",
    rev: 1,
    created_at: "2026-11-01T12:00:00Z",
    updated_at: "2026-11-01T12:00:00Z",
    created_by: "u1",
    updated_by: "u1",
    properties: {},
    body: "",
    missing_relations: [],
    backlinks: [
      {
        kind: "mention",
        id: "o2",
        type: "task",
        title: "Water the monstera",
        snippet: "Next to the [[plant/Monstera]].",
        count: 2,
      },
    ],
    ...overrides,
  };
}

const sourceDetail: ObjectDetail = {
  id: "o2",
  type: "task",
  title: "Water the monstera",
  rev: 3,
  created_at: "2026-11-01T12:00:00Z",
  updated_at: "2026-11-01T12:00:00Z",
  created_by: "u1",
  updated_by: "u1",
  properties: {},
  body: "Next to the [[plant/Monstera]] and again [[plant/Monstera]].",
  missing_relations: [],
  links: [
    {
      raw: "plant/Monstera",
      type: "plant",
      title: "Monstera",
      status: "ok",
      id: "o1",
    },
  ],
};

describe("ObjectPanel rename repair", () => {
  it("asks before a title change strands mentions, then rewrites each source", async () => {
    const writes: { url: string; body: Record<string, unknown> }[] = [];
    const fetchMock = stubFetch((input, init) => {
      const url = requestUrl(input);
      const method = init?.method ?? "GET";
      if (method === "PATCH") {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        writes.push({ url, body });
        if (url.endsWith("/objects/o1")) {
          return jsonResponse(
            targetDetail({
              title: "Monstera deliciosa",
              rev: 2,
              backlinks: [],
              updated_at: "2026-11-02T12:00:00Z",
            }),
          );
        }
        if (url.endsWith("/objects/o2")) {
          return jsonResponse({
            ...sourceDetail,
            rev: 4,
            body: body.body,
            links: [],
          });
        }
      }
      if (url.endsWith("/api/spaces/s1/types")) {
        return jsonResponse(types);
      }
      if (url.includes("/objects/o2?with=links,backlinks")) {
        return jsonResponse(sourceDetail);
      }
      throw new Error(`unstubbed ${method} ${url}`);
    });

    renderWithProviders(
      <ObjectPanel
        spaceId="s1"
        type={plantType}
        object={targetDetail()}
        properties={[]}
        canEdit
        timeZone="UTC"
        reloadObject={async () => targetDetail()}
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), {
      target: { value: "Monstera deliciosa" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByRole("heading", { name: "Rename and update links?" }),
    ).toBeInTheDocument();
    expect(writes).toEqual([]);

    const update = screen.getByRole("button", { name: "Update links" });
    await waitFor(() => expect(update).toBeEnabled());
    fireEvent.click(update);

    expect(await screen.findByText("Updated 1 record that link here.")).toBeInTheDocument();
    expect(writes).toHaveLength(2);
    expect(writes[0]).toMatchObject({
      url: "/api/spaces/s1/objects/o1",
      body: { rev: 1, title: "Monstera deliciosa" },
    });
    expect(writes[1]).toEqual({
      url: "/api/spaces/s1/objects/o2",
      body: {
        rev: 3,
        body: "Next to the [[plant/Monstera deliciosa]] and again [[plant/Monstera deliciosa]].",
      },
    });
    expect(fetchMock).toHaveBeenCalled();
  });


  it("skips a source that changed after the preview and reports it", async () => {
    const writes: { url: string; body: Record<string, unknown> }[] = [];
    stubFetch((input, init) => {
      const url = requestUrl(input);
      const method = init?.method ?? "GET";
      if (method === "PATCH") {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        writes.push({ url, body });
        if (url.endsWith("/objects/o1")) {
          return jsonResponse(
            targetDetail({
              title: "Monstera deliciosa",
              rev: 2,
              backlinks: [],
            }),
          );
        }
        if (url.endsWith("/objects/o2")) {
          return jsonResponse(
            {
              error: {
                code: "conflict",
                message: "This record changed since you loaded it.",
                details: { current_rev: 4 },
              },
            },
            409,
          );
        }
      }
      if (url.endsWith("/api/spaces/s1/types")) {
        return jsonResponse(types);
      }
      if (url.includes("/objects/o2?with=links,backlinks")) {
        return jsonResponse(sourceDetail);
      }
      throw new Error(`unstubbed ${method} ${url}`);
    });

    renderWithProviders(
      <ObjectPanel
        spaceId="s1"
        type={plantType}
        object={targetDetail()}
        properties={[]}
        canEdit
        timeZone="UTC"
        reloadObject={async () => targetDetail()}
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), {
      target: { value: "Monstera deliciosa" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("heading", { name: "Rename and update links?" });
    const update = screen.getByRole("button", { name: "Update links" });
    await waitFor(() => expect(update).toBeEnabled());
    fireEvent.click(update);

    expect(
      await screen.findByText(
        "Updated 0 records that link here; skipped 1 changed record.",
      ),
    ).toBeInTheDocument();
    expect(writes).toHaveLength(2);
    expect(writes[1]).toMatchObject({ url: "/api/spaces/s1/objects/o2", body: { rev: 3 } });
  });

  it("renames only when asked, leaving the source body untouched", async () => {
    const writes: { url: string; body: Record<string, unknown> }[] = [];
    stubFetch((input, init) => {
      const url = requestUrl(input);
      const method = init?.method ?? "GET";
      if (method === "PATCH") {
        writes.push({ url, body: JSON.parse(String(init?.body)) });
        return jsonResponse(
          targetDetail({
            title: "Monstera deliciosa",
            rev: 2,
            backlinks: [],
          }),
        );
      }
      if (url.endsWith("/api/spaces/s1/types")) {
        return jsonResponse(types);
      }
      if (url.includes("/objects/o2?with=links,backlinks")) {
        return jsonResponse(sourceDetail);
      }
      throw new Error(`unstubbed ${method} ${url}`);
    });

    renderWithProviders(
      <ObjectPanel
        spaceId="s1"
        type={plantType}
        object={targetDetail()}
        properties={[]}
        canEdit
        timeZone="UTC"
        reloadObject={async () => targetDetail()}
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), {
      target: { value: "Monstera deliciosa" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("heading", { name: "Rename and update links?" });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Update links" })).toBeEnabled(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Rename only" }));

    expect(await screen.findByText("Renamed to “Monstera deliciosa”.")).toBeInTheDocument();
    expect(writes).toEqual([
      {
        url: "/api/spaces/s1/objects/o1",
        body: { rev: 1, title: "Monstera deliciosa", icon: null, body: "" },
      },
    ]);
  });
});
