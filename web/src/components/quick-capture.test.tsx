import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { PropertyDef, SpaceDetail, TypeDef, ViewDef } from "@/api/types";
import { QuickCaptureProvider, useQuickCapture } from "@/components/quick-capture";
import { jsonResponse, renderWithProviders, requestUrl, stubFetch } from "@/test/harness";

const table: ViewDef = {
  key: "all",
  name: "All",
  kind: "table",
  sorts: [],
  filter: { op: "and", conditions: [] },
  columns: ["title"],
  widths: {},
};

const properties: PropertyDef[] = [
  { key: "room", name: "Room", format: "text" },
  { key: "price", name: "Price", format: "number" },
];

function plant(): TypeDef {
  return {
    key: "plant",
    name: "Plant",
    name_plural: "Plants",
    description: "",
    schedule: false,
    properties: [
      { key: "room", required: true, featured: true, default: "study" },
      { key: "price", required: false, featured: true, default: 0 },
    ],
    views: [table],
    default_view: "all",
  };
}

const space: SpaceDetail = {
  id: "s1",
  name: "Garden",
  icon: null,
  accent: null,
  timezone: "America/Toronto",
  created_at: "2026-11-01T00:00:00Z",
  role: "owner",
  members: [],
  type_count: 1,
};

function Opener() {
  const capture = useQuickCapture();
  return (
    <button type="button" onClick={() => capture.open("plant")}>
      Open capture
    </button>
  );
}

/** Stubs every read the sheet makes and records the create's body. */
function stubCapture() {
  let created: Record<string, unknown> | null = null;
  stubFetch((input, init) => {
    const url = requestUrl(input);
    if ((init?.method ?? "GET") === "POST") {
      created = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse({
        id: "o1",
        type: "plant",
        title: "Monstera",
        rev: 1,
        created_at: "2026-11-16T12:00:00Z",
        updated_at: "2026-11-16T12:00:00Z",
        created_by: "u1",
        updated_by: "u1",
        properties: {},
        body: "",
        missing_relations: [],
      });
    }
    if (url.endsWith("/api/auth/me")) {
      return jsonResponse({ id: "u1", email: "a@b.c", name: "Talen" });
    }
    if (url.endsWith("/api/spaces/s1")) {
      return jsonResponse(space);
    }
    if (url.endsWith("/api/spaces/s1/types")) {
      return jsonResponse([
        {
          key: "plant",
          name: "Plant",
          name_plural: "Plants",
          description: "",
          schedule: false,
          property_count: 2,
          object_count: 0,
        },
      ]);
    }
    if (url.endsWith("/api/spaces/s1/types/plant")) {
      return jsonResponse(plant());
    }
    if (url.endsWith("/api/spaces/s1/properties")) {
      return jsonResponse(properties);
    }
    throw new Error(`unstubbed ${url}`);
  });
  return () => created;
}

async function openCapture() {
  renderWithProviders(
    <QuickCaptureProvider spaceId="s1">
      <Opener />
    </QuickCaptureProvider>,
    { route: "/s/s1" },
  );
  fireEvent.click(screen.getByRole("button", { name: "Open capture" }));
  fireEvent.change(await screen.findByLabelText("Title"), {
    target: { value: "Monstera" },
  });
}

describe("QuickCapture defaults", () => {
  it("shows a default in the draft and sends it with the record", async () => {
    const created = stubCapture();
    await openCapture();

    fireEvent.click(await screen.findByRole("button", { name: /Other fields/ }));
    expect(await screen.findByLabelText("Price")).toHaveValue(0);

    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(created()).not.toBeNull());
    expect(created()?.properties).toEqual({ room: "study", price: 0 });
  });

  it("sends nothing for a default the draft cleared", async () => {
    const created = stubCapture();
    await openCapture();

    fireEvent.click(await screen.findByRole("button", { name: /Other fields/ }));
    fireEvent.change(await screen.findByLabelText("Price"), { target: { value: "" } });

    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(created()).not.toBeNull());
    expect(created()?.properties).toEqual({ room: "study" });
  });
});
