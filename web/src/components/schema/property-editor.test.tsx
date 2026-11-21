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

  it("keeps the key tools behind one disclosure", () => {
    const amount: PropertyDef = { key: "amount", name: "Amount", format: "number" };
    stubFetch((input) => {
      throw new Error(`unstubbed ${requestUrl(input)}`);
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

    const tools = screen.getByText("More tools").closest("details");
    expect(tools?.open).toBe(false);
    fireEvent.click(screen.getByText("More tools", { selector: "summary" }));
    expect(tools?.open).toBe(true);
    expect(screen.getByLabelText("New key")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Turn into a relation…" }),
    ).toBeInTheDocument();
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

  it("hides membership on a calculation, which captures nothing", () => {
    stubFetch((input) => {
      throw new Error(`unstubbed ${requestUrl(input)}`);
    });
    const computed: TypeProperty = {
      key: "days_since_watered",
      required: false,
      featured: true,
    };
    renderWithProviders(
      <PropertyEditorForm
        spaceId="s1"
        property={formula}
        types={[]}
        library={[formula]}
        canEdit
        type={{ ...plant, properties: [computed] }}
        member={computed}
      />,
    );

    expect(screen.getByText("Definition")).toBeInTheDocument();
    expect(screen.queryByLabelText("Required")).not.toBeInTheDocument();
    expect(screen.queryByText("On this type")).not.toBeInTheDocument();
  });

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

describe("PropertyEditorForm relation rules", () => {
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
  const active: PropertyDef = { key: "active", name: "Active", format: "checkbox" };
  const person: TypeDef = {
    key: "person",
    name: "Person",
    name_plural: "People",
    description: "",
    schedule: false,
    properties: [{ key: "active", required: false, featured: true }],
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

  function stubRelationWrites(property: PropertyDef) {
    let body: Record<string, unknown> | null = null;
    stubFetch((input, init) => {
      const url = requestUrl(input);
      if ((init?.method ?? "GET") === "PATCH") {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return jsonResponse({ ...property, ...body });
      }
      if (url.endsWith("/api/spaces/s1/types/person")) {
        return jsonResponse(person);
      }
      if (url.endsWith("/api/spaces/s1")) {
        return jsonResponse(space);
      }
      throw new Error(`unstubbed ${url}`);
    });
    return () => body;
  }

  const supervisor: PropertyDef = {
    key: "supervisor",
    name: "Supervisor",
    format: "relation",
    target_type: "person",
  };

  it("offers a target filter and writes one source per target", async () => {
    const body = stubRelationWrites(supervisor);
    renderWithProviders(
      <PropertyEditorForm
        spaceId="s1"
        property={supervisor}
        types={[]}
        library={[supervisor, active]}
        canEdit
      />,
    );

    expect(await screen.findByText("Only linked records matching")).toBeInTheDocument();
    expect(
      await screen.findByText("Every record of the linked type."),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByLabelText("A record can be linked only once"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save property" }));

    await waitFor(() => expect(body()).not.toBeNull());
    expect(body()).toEqual({ name: "Supervisor", one_to_one: true });
  });

  it("clears a relation filter with null when its last condition is removed", async () => {
    const filtered: PropertyDef = {
      ...supervisor,
      target_filter: {
        op: "and",
        conditions: [{ property: "active", condition: "equal", value: true }],
      },
    };
    const body = stubRelationWrites(filtered);
    renderWithProviders(
      <PropertyEditorForm
        spaceId="s1"
        property={filtered}
        types={[]}
        library={[filtered, active]}
        canEdit
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Remove condition" }));
    fireEvent.click(screen.getByRole("button", { name: "Save property" }));

    await waitFor(() => expect(body()).not.toBeNull());
    expect(body()).toEqual({ name: "Supervisor", target_filter: null });
  });

  it("leaves an untouched relation's rules out of a rename", async () => {
    const narrowed: PropertyDef = {
      ...supervisor,
      one_to_one: true,
      target_filter: {
        op: "and",
        conditions: [{ property: "active", condition: "equal", value: true }],
      },
    };
    const body = stubRelationWrites(narrowed);
    renderWithProviders(
      <PropertyEditorForm
        spaceId="s1"
        property={narrowed}
        types={[]}
        library={[narrowed, active]}
        canEdit
      />,
    );

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Lead" } });
    fireEvent.click(screen.getByRole("button", { name: "Save property" }));

    await waitFor(() => expect(body()).not.toBeNull());
    expect(body()).toEqual({ name: "Lead" });
  });

  it("states why a relation a rollup reads cannot be narrowed", async () => {
    const related: PropertyDef = {
      key: "related_plant",
      name: "Related plant",
      format: "relation",
      target_type: "person",
      multi: true,
    };
    const titles: PropertyDef = {
      key: "related_titles",
      name: "Related titles",
      format: "list",
      compute: {
        kind: "rollup",
        relation: "related_plant",
        property: "title",
        aggregate: "list",
      },
    };
    stubRelationWrites(related);
    renderWithProviders(
      <PropertyEditorForm
        spaceId="s1"
        property={related}
        types={[]}
        library={[related, active, titles]}
        canEdit
      />,
    );

    expect(
      await screen.findByText(/decides which linked records count, so this relation stays open/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Add condition" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByLabelText("A record can be linked only once"),
    ).toBeDisabled();
  });
});
