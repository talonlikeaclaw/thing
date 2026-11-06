import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// The dirty guard needs a data router; this test covers the rename write path.
vi.mock("@/lib/use-dirty-guard", () => ({
  useDirtyGuard: () => null,
}));

import type { ObjectDetail, PropertyDef, TypeDef } from "@/api/types";
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

const photoProperty: PropertyDef = {
  key: "photo",
  name: "Photo",
  format: "image",
};

const mediaType: TypeDef = {
  ...plantType,
  properties: [{ key: "photo", required: false, featured: true }],
};

const photoPath = "files/old/old-photo.png";

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


const pngBytes = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
  0x52,
]);

function chosenFile(name: string): File {
  return new File([pngBytes], name, { type: "image/png" });
}

describe("ObjectPanel attachments", () => {
  it("uploads an image and writes its path in the panel save", async () => {
    const writes: Record<string, unknown>[] = [];
    let uploads = 0;
    stubFetch((input, init) => {
      const url = requestUrl(input);
      const method = init?.method ?? "GET";
      if (method === "POST" && url.includes("/files?")) {
        uploads += 1;
        expect(url).toContain("name=photo.png");
        expect((init?.body as File).type).toBe("image/png");
        return jsonResponse(
          {
            path: "files/abc/photo.png",
            hash: "abc",
            name: "photo.png",
            mime: "image/png",
            size: pngBytes.length,
          },
          201,
        );
      }
      if (method === "PATCH" && url.endsWith("/objects/o1")) {
        writes.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return jsonResponse(
          targetDetail({
            rev: 2,
            properties: {
              photo: { value: "files/abc/photo.png", label: "photo.png" },
            },
          }),
        );
      }
      throw new Error(`unstubbed ${method} ${url}`);
    });

    renderWithProviders(
      <ObjectPanel
        spaceId="s1"
        type={mediaType}
        object={targetDetail()}
        properties={[photoProperty]}
        canEdit
        timeZone="UTC"
        reloadObject={async () => targetDetail()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Upload image"), {
      target: { files: [chosenFile("photo.png")] },
    });
    expect(await screen.findByText("photo.png")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({
      rev: 1,
      properties: { photo: "files/abc/photo.png" },
    });
    expect(uploads).toBe(1);
  });

  it("keeps the stored image when the upload is refused and offers Retry", async () => {
    let uploads = 0;
    stubFetch((input, init) => {
      const url = requestUrl(input);
      const method = init?.method ?? "GET";
      if (method === "POST" && url.includes("/files?")) {
        uploads += 1;
        return jsonResponse(
          {
            error: {
              code: "payload_too_large",
              message: "a file may be at most 10 MiB",
              details: {},
            },
          },
          413,
        );
      }
      throw new Error(`unstubbed ${method} ${url}`);
    });

    renderWithProviders(
      <ObjectPanel
        spaceId="s1"
        type={mediaType}
        object={targetDetail({
          properties: { photo: { value: photoPath, label: "old-photo.png" } },
        })}
        properties={[photoProperty]}
        canEdit
        timeZone="UTC"
        reloadObject={async () => targetDetail()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Upload image"), {
      target: { files: [chosenFile("new-photo.png")] },
    });

    expect(
      await screen.findByText("a file may be at most 10 MiB"),
    ).toBeInTheDocument();
    expect(screen.getByText("old-photo.png")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(uploads).toBe(2));
  });

  it("adds a cover from the record menu, saves it and removes it", async () => {
    const writes: Record<string, unknown>[] = [];
    stubFetch((input, init) => {
      const url = requestUrl(input);
      const method = init?.method ?? "GET";
      if (method === "POST" && url.includes("/files?")) {
        expect(url).toContain("name=cover.png");
        return jsonResponse(
          {
            path: "files/cover/cover.png",
            hash: "cover",
            name: "cover.png",
            mime: "image/png",
            size: pngBytes.length,
          },
          201,
        );
      }
      if (method === "PATCH" && url.endsWith("/objects/o1")) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        writes.push(body);
        return jsonResponse(
          targetDetail({
            rev: writes.length + 1,
            ...(body.cover === null ? {} : { cover: "files/cover/cover.png" }),
            ...(typeof body.cover_position === "string"
              ? { cover_position: body.cover_position }
              : {}),
          }),
        );
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

    fireEvent.click(screen.getByRole("button", { name: "More record actions" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add cover" }));
    fireEvent.change(screen.getByLabelText("Upload cover image"), {
      target: { files: [chosenFile("cover.png")] },
    });
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({ rev: 1, cover: "files/cover/cover.png" });

    fireEvent.click(screen.getByRole("button", { name: "More record actions" }));
    fireEvent.click(await screen.findByRole("button", { name: "Reposition cover" }));
    fireEvent.change(screen.getByLabelText("Cover horizontal position"), {
      target: { value: "20" },
    });
    fireEvent.change(screen.getByLabelText("Cover vertical position"), {
      target: { value: "80" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));

    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[1]).toMatchObject({
      rev: 2,
      cover_position: "20% 80%",
    });

    fireEvent.click(screen.getByRole("button", { name: "More record actions" }));
    fireEvent.click(await screen.findByRole("button", { name: "Remove cover" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));

    await waitFor(() => expect(writes).toHaveLength(3));
    expect(writes[2]).toMatchObject({
      rev: 3,
      cover: null,
      cover_position: null,
    });
  });
});
