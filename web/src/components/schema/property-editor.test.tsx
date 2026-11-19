import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/use-dirty-guard", () => ({
  useDirtyGuard: () => null,
}));

import type { PropertyDef, TypeDef, TypeProperty } from "@/api/types";
import { PropertyEditorForm } from "@/components/schema/property-editor";
import { jsonResponse, renderWithProviders, requestUrl, stubFetch } from "@/test/harness";

const formula: PropertyDef = {
  key: "days_since_watered",
  name: "Days since watered",
  format: "number",
  compute: {
    kind: "formula",
    expression: "days(last_completed_at, today())",
  },
};

const room: PropertyDef = { key: "room", name: "Room", format: "text" };
const formulaUsingRoom: PropertyDef = {
  key: "room_length",
  name: "Room length",
  format: "number",
  compute: { kind: "formula", expression: "length(room)" },
};

describe("PropertyEditorForm", () => {
  it("saves an edited formula through the property patch", async () => {
    let body: Record<string, unknown> | null = null;
    stubFetch((input, init) => {
      const url = requestUrl(input);
      if ((init?.method ?? "GET") === "PATCH") {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return jsonResponse({
          ...formula,
          compute: body?.compute,
        });
      }
      throw new Error(`unstubbed ${url}`);
    });

    renderWithProviders(
      <PropertyEditorForm
        spaceId="s1"
        property={formula}
        types={[]}
        library={[formula, room]}
        canEdit
      />,
    );

    fireEvent.change(screen.getByLabelText("Expression"), {
      target: { value: "days(last_completed_at, today()) + 1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save property" }));

    await waitFor(() => expect(body).not.toBeNull());
    expect(body).toEqual({
      name: "Days since watered",
      compute: {
        kind: "formula",
        expression: "days(last_completed_at, today()) + 1",
      },
    });
  });

  it("names the calculated holders and disables delete", async () => {
    stubFetch((input, init) => {
      const url = requestUrl(input);
      if ((init?.method ?? "GET") === "DELETE") {
        return jsonResponse(
          {
            error: {
              code: "conflict",
              message: "computed properties use property",
              details: {
                reason: "computed properties use property",
                properties: ["room_length"],
              },
            },
          },
          409,
        );
      }
      throw new Error(`unstubbed ${url}`);
    });

    renderWithProviders(
      <PropertyEditorForm
        spaceId="s1"
        property={room}
        types={[]}
        library={[room, formulaUsingRoom]}
        canEdit
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete this property" }));

    expect(
      await screen.findByText(/A calculated property uses this property/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Room length" })).toHaveAttribute(
      "href",
      "/s/s1/schema?property=room_length",
    );
    expect(screen.getByRole("button", { name: "Delete this property" })).toBeDisabled();
  });
});

describe("PropertyEditorForm validation", () => {
  it("saves a bound with the rest of the property untouched", async () => {
    const amount: PropertyDef = { key: "amount", name: "Amount", format: "number" };
    let body: Record<string, unknown> | null = null;
    stubFetch((input, init) => {
      const url = requestUrl(input);
      if ((init?.method ?? "GET") === "PATCH") {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return jsonResponse({ ...amount, validation: body?.validation });
      }
      throw new Error(`unstubbed ${url}`);
    });

    renderWithProviders(
      <PropertyEditorForm
        spaceId="s1"
        property={amount}
        types={[]}
        library={[amount]}
        canEdit
      />,
    );

    fireEvent.change(screen.getByLabelText("Minimum"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Save property" }));

    await waitFor(() => expect(body).not.toBeNull());
    expect(body).toEqual({ name: "Amount", validation: { min: 0 } });
  });

  it("leaves an untouched block out of an unrelated rename", async () => {
    const amount: PropertyDef = {
      key: "amount",
      name: "Amount",
      format: "number",
      validation: { min: 0 },
    };
    let body: Record<string, unknown> | null = null;
    stubFetch((input, init) => {
      const url = requestUrl(input);
      if ((init?.method ?? "GET") === "PATCH") {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return jsonResponse({ ...amount, name: "Cost" });
      }
      throw new Error(`unstubbed ${url}`);
    });

    renderWithProviders(
      <PropertyEditorForm
        spaceId="s1"
        property={amount}
        types={[]}
        library={[amount]}
        canEdit
      />,
    );

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Cost" } });
    fireEvent.click(screen.getByRole("button", { name: "Save property" }));

    await waitFor(() => expect(body).not.toBeNull());
    expect(body).toEqual({ name: "Cost" });
  });

  it("clears a block with null when its last rule is removed", async () => {
    const code: PropertyDef = {
      key: "code",
      name: "Code",
      format: "text",
      validation: { pattern: "[A-Z]{2}" },
    };
    let body: Record<string, unknown> | null = null;
    stubFetch((input, init) => {
      const url = requestUrl(input);
      if ((init?.method ?? "GET") === "PATCH") {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return jsonResponse({ ...code, validation: body?.validation });
      }
      throw new Error(`unstubbed ${url}`);
    });

    renderWithProviders(
      <PropertyEditorForm
        spaceId="s1"
        property={code}
        types={[]}
        library={[code]}
        canEdit
      />,
    );

    fireEvent.change(screen.getByLabelText("Pattern"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save property" }));

    await waitFor(() => expect(body).not.toBeNull());
    expect(body).toEqual({ name: "Code", validation: null });
  });
});

describe("PropertyEditorForm display", () => {
  it("saves a currency with the rest of the property untouched", async () => {
    const amount: PropertyDef = { key: "amount", name: "Amount", format: "number" };
    let body: Record<string, unknown> | null = null;
    stubFetch((input, init) => {
      const url = requestUrl(input);
      if ((init?.method ?? "GET") === "PATCH") {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return jsonResponse({ ...amount, display: body?.display });
      }
      throw new Error(`unstubbed ${url}`);
    });

    renderWithProviders(
      <PropertyEditorForm
        spaceId="s1"
        property={amount}
        types={[]}
        library={[amount]}
        canEdit
      />,
    );

    // Display starts open in the property editor; the currency control is
    // reachable without unfolding it.
    fireEvent.click(screen.getByLabelText("Open currency list"));
    fireEvent.click(await screen.findByRole("option", { name: "USD" }));
    fireEvent.click(screen.getByRole("button", { name: "Save property" }));

    await waitFor(() => expect(body).not.toBeNull());
    expect(body).toEqual({
      name: "Amount",
      display: { currency: "USD" },
    });
  });
});

describe("PropertyEditorForm membership", () => {
  const member: TypeProperty = {
    key: "room",
    required: false,
    featured: true,
    default: "study",
  };
  const plant: TypeDef = {
    key: "plant",
    name: "Plant",
    name_plural: "Plants",
    description: "",
    schedule: false,
    properties: [member],
    views: [
      {
        key: "all",
        name: "All",
        kind: "table",
        sorts: [],
        filter: { op: "and", conditions: [] },
        columns: ["title"],
        widths: {},
      },
    ],
    default_view: "all",
  };
  const space = {
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

  function stubWrites() {
    const writes: { url: string; body: unknown }[] = [];
    stubFetch((input, init) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/spaces/s1")) {
        return jsonResponse(space);
      }
      if ((init?.method ?? "GET") === "PATCH") {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        writes.push({ url, body });
        if (url.endsWith("/types/plant")) {
          return jsonResponse({ ...plant, properties: body.properties });
        }
        return jsonResponse({ ...room, ...body });
      }
      throw new Error(`unstubbed ${url}`);
    });
    return writes;
  }

  it("writes the membership and leaves the untouched property out", async () => {
    const writes = stubWrites();
    renderWithProviders(
      <PropertyEditorForm
        spaceId="s1"
        property={room}
        types={[]}
        library={[room]}
        canEdit
        type={plant}
        member={member}
      />,
    );

    fireEvent.click(screen.getByLabelText("Required"));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]?.body).toEqual({
      properties: [{ key: "room", required: true, featured: true, default: "study" }],
    });
  });

  it("writes the property first and the membership second in one Save", async () => {
    const writes = stubWrites();
    renderWithProviders(
      <PropertyEditorForm
        spaceId="s1"
        property={room}
        types={[]}
        library={[room]}
        canEdit
        type={plant}
        member={member}
      />,
    );

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Room name" } });
    fireEvent.change(screen.getByLabelText("Room"), { target: { value: "attic" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[0]?.body).toEqual({ name: "Room name" });
    expect(writes[1]?.body).toEqual({
      properties: [{ key: "room", required: false, featured: true, default: "attic" }],
    });
  });

  it("leaves the membership out of an unrelated rename", async () => {
    const writes = stubWrites();
    renderWithProviders(
      <PropertyEditorForm
        spaceId="s1"
        property={room}
        types={[]}
        library={[room]}
        canEdit
        type={plant}
        member={member}
      />,
    );

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Room name" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]?.body).toEqual({ name: "Room name" });
  });
});
