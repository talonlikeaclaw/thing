import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { PropertyDef, TypeDef, ViewDef } from "@/api/types";
import { AddPropertyDialog } from "@/components/add-property";
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

function album(properties: TypeDef["properties"] = []): TypeDef {
  return {
    key: "album",
    name: "Album",
    name_plural: "Albums",
    description: "",
    schedule: false,
    properties,
    views: [table],
    default_view: "all",
  };
}

function artistType(): TypeDef {
  return {
    key: "artist",
    name: "Artist",
    name_plural: "Artists",
    description: "",
    schedule: false,
    properties: [],
    views: [table],
    default_view: "all",
  };
}

const room: PropertyDef = { key: "room", name: "Room", format: "text" };
const artist: PropertyDef = { key: "artist", name: "Artist", format: "text" };

interface Call {
  method: string;
  url: string;
  body: Record<string, unknown> | null;
}

/** The whole request log, so a test can assert order and reuse. */
function logCalls(): Call[] {
  return [];
}

describe("AddPropertyDialog", () => {
  it("adds an existing library property to the type from a record", async () => {
    const calls = logCalls();
    stubFetch((input, init) => {
      const url = requestUrl(input);
      const method = init?.method ?? "GET";
      if (method === "PATCH") {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        calls.push({ method, url, body });
        return jsonResponse(album([{ key: "artist", required: false, featured: true }]));
      }
      if (url.endsWith("/api/spaces/s1/types")) {
        return jsonResponse([]);
      }
      throw new Error(`unstubbed ${method} ${url}`);
    });

    const onClose = vi.fn();
    renderWithProviders(
      <AddPropertyDialog
        spaceId="s1"
        type={album([{ key: "room", required: false, featured: true }])}
        library={[room, artist]}
        onClose={onClose}
      />,
    );

    // The record surface omits the view: no column stage is promised.
    expect(screen.queryByText("Add the column to this view")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Existing" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: "Add property" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      method: "PATCH",
      url: "/api/spaces/s1/types/album",
      body: {
        properties: [
          { key: "room", required: false, featured: true },
          { key: "artist", required: false, featured: true },
        ],
      },
    });
  });

  it("adds the column to the view when the table passes one", async () => {
    const calls = logCalls();
    stubFetch((input, init) => {
      const url = requestUrl(input);
      const method = init?.method ?? "GET";
      if (method === "PATCH") {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        calls.push({ method, url, body });
        if (url.includes("/views/all")) {
          return jsonResponse(album([{ key: "artist", required: false, featured: true }]));
        }
        return jsonResponse(album([{ key: "artist", required: false, featured: true }]));
      }
      if (url.endsWith("/api/spaces/s1/types")) {
        return jsonResponse([]);
      }
      throw new Error(`unstubbed ${method} ${url}`);
    });

    renderWithProviders(
      <AddPropertyDialog
        spaceId="s1"
        type={album([{ key: "room", required: false, featured: true }])}
        library={[room, artist]}
        view={table}
        onClose={() => undefined}
      />,
    );

    expect(screen.getByText("Add the column to this view")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add to table" }));

    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]).toMatchObject({
      method: "PATCH",
      url: "/api/spaces/s1/types/album/views/all",
      body: { columns: ["title", "artist"] },
    });
  });

  it("creates a relation to a new type in one flow", async () => {
    const calls = logCalls();
    stubFetch((input, init) => {
      const url = requestUrl(input);
      const method = init?.method ?? "GET";
      const body =
        init?.body === undefined
          ? null
          : (JSON.parse(String(init.body)) as Record<string, unknown>);
      if (method === "GET" && url.endsWith("/api/spaces/s1/types")) {
        return jsonResponse([]);
      }
      if (method === "POST" && url.endsWith("/api/spaces/s1/types")) {
        calls.push({ method, url, body });
        return jsonResponse(artistType(), 201);
      }
      if (method === "POST" && url.endsWith("/api/spaces/s1/properties")) {
        calls.push({ method, url, body });
        return jsonResponse(
          {
            key: "artist",
            name: "Artist",
            format: "relation",
            target_type: "artist",
            multi: true,
          },
          201,
        );
      }
      if (method === "PATCH" && url.endsWith("/api/spaces/s1/types/album")) {
        calls.push({ method, url, body });
        return jsonResponse(album([{ key: "artist", required: false, featured: true }]));
      }
      throw new Error(`unstubbed ${method} ${url}`);
    });

    const onClose = vi.fn();
    renderWithProviders(
      <AddPropertyDialog
        spaceId="s1"
        type={album()}
        library={[]}
        onClose={onClose}
      />,
    );

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Artist" } });
    fireEvent.click(screen.getByRole("radio", { name: "Relation" }));
    fireEvent.change(screen.getByLabelText("Type name"), {
      target: { value: "Artist" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add property" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      "POST /api/spaces/s1/types",
      "POST /api/spaces/s1/properties",
      "PATCH /api/spaces/s1/types/album",
    ]);
    expect(calls[0]?.body).toMatchObject({ name: "Artist" });
    expect(calls[1]?.body).toMatchObject({
      name: "Artist",
      format: "relation",
      target_type: "artist",
      multi: true,
    });
  });

  it("retries from the failed type stage without creating a second type", async () => {
    const calls = logCalls();
    let typeAttempts = 0;
    stubFetch((input, init) => {
      const url = requestUrl(input);
      const method = init?.method ?? "GET";
      const body =
        init?.body === undefined
          ? null
          : (JSON.parse(String(init.body)) as Record<string, unknown>);
      if (method === "GET" && url.endsWith("/api/spaces/s1/types")) {
        return jsonResponse([]);
      }
      if (method === "POST" && url.endsWith("/api/spaces/s1/types")) {
        calls.push({ method, url, body });
        typeAttempts += 1;
        if (typeAttempts === 1) {
          return jsonResponse(
            { error: { code: "internal", message: "The server failed." } },
            500,
          );
        }
        return jsonResponse(artistType(), 201);
      }
      if (method === "POST" && url.endsWith("/api/spaces/s1/properties")) {
        calls.push({ method, url, body });
        return jsonResponse(
          {
            key: "artist",
            name: "Artist",
            format: "relation",
            target_type: "artist",
            multi: true,
          },
          201,
        );
      }
      if (method === "PATCH" && url.endsWith("/api/spaces/s1/types/album")) {
        calls.push({ method, url, body });
        return jsonResponse(album([{ key: "artist", required: false, featured: true }]));
      }
      throw new Error(`unstubbed ${method} ${url}`);
    });

    const onClose = vi.fn();
    renderWithProviders(
      <AddPropertyDialog
        spaceId="s1"
        type={album()}
        library={[]}
        onClose={onClose}
      />,
    );

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Artist" } });
    fireEvent.click(screen.getByRole("radio", { name: "Relation" }));
    fireEvent.change(screen.getByLabelText("Type name"), {
      target: { value: "Artist" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add property" }));

    expect(await screen.findByText("Could not create the type.")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(calls.map((call) => call.url)).toEqual(["/api/spaces/s1/types"]);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      "POST /api/spaces/s1/types",
      "POST /api/spaces/s1/types",
      "POST /api/spaces/s1/properties",
      "PATCH /api/spaces/s1/types/album",
    ]);
    expect(typeAttempts).toBe(2);
  });

  it("creates a formula property with its result type and expression", async () => {
    const calls = logCalls();
    stubFetch((input, init) => {
      const url = requestUrl(input);
      const method = init?.method ?? "GET";
      const body =
        init?.body === undefined
          ? null
          : (JSON.parse(String(init.body)) as Record<string, unknown>);
      if (method === "GET" && url.endsWith("/api/spaces/s1/types")) {
        return jsonResponse([]);
      }
      if (method === "POST" && url.endsWith("/api/spaces/s1/properties")) {
        calls.push({ method, url, body });
        return jsonResponse(
          {
            key: "days_since_watered",
            name: "Days since watered",
            format: "number",
            compute: body?.compute,
          },
          201,
        );
      }
      if (method === "PATCH" && url.endsWith("/api/spaces/s1/types/album")) {
        calls.push({ method, url, body });
        return jsonResponse(
          album([{ key: "days_since_watered", required: false, featured: true }]),
        );
      }
      throw new Error(`unstubbed ${method} ${url}`);
    });

    const onClose = vi.fn();
    renderWithProviders(
      <AddPropertyDialog spaceId="s1" type={album()} library={[]} onClose={onClose} />,
    );

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Days since watered" },
    });
    fireEvent.click(screen.getByRole("radio", { name: "Formula" }));
    fireEvent.change(screen.getByLabelText("Expression"), {
      target: { value: "days(last_completed_at, today())" },
    });
    fireEvent.click(screen.getByRole("combobox", { name: "Result type" }));
    const number = await screen.findByRole("option", { name: "Number" });
    fireEvent.pointerDown(number, { pointerType: "mouse" });
    fireEvent.click(number);
    fireEvent.click(screen.getByRole("button", { name: "Add property" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(calls[0]?.body).toEqual({
      name: "Days since watered",
      format: "number",
      compute: {
        kind: "formula",
        expression: "days(last_completed_at, today())",
      },
    });
    expect(calls[1]?.method).toBe("PATCH");
  });

  it("derives a rollup's result type from its aggregate", async () => {
    const calls = logCalls();
    stubFetch((input, init) => {
      const url = requestUrl(input);
      const method = init?.method ?? "GET";
      const body =
        init?.body === undefined
          ? null
          : (JSON.parse(String(init.body)) as Record<string, unknown>);
      if (method === "GET" && url.endsWith("/api/spaces/s1/types")) {
        return jsonResponse([]);
      }
      if (method === "POST" && url.endsWith("/api/spaces/s1/properties")) {
        calls.push({ method, url, body });
        return jsonResponse(
          {
            key: "related_titles",
            name: "Related titles",
            format: "list",
            compute: body?.compute,
          },
          201,
        );
      }
      if (method === "PATCH" && url.endsWith("/api/spaces/s1/types/album")) {
        calls.push({ method, url, body });
        return jsonResponse(
          album([{ key: "related_titles", required: false, featured: true }]),
        );
      }
      throw new Error(`unstubbed ${method} ${url}`);
    });

    const onClose = vi.fn();
    renderWithProviders(
      <AddPropertyDialog
        spaceId="s1"
        type={album([{ key: "related_plant", required: false, featured: true }])}
        library={[
          {
            key: "related_plant",
            name: "Related plant",
            format: "relation",
            target_type: "artist",
          },
          { key: "height", name: "Height", format: "number" },
        ]}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "New" }));
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Related titles" },
    });
    fireEvent.click(screen.getByRole("radio", { name: "Rollup" }));
    fireEvent.click(screen.getByRole("combobox", { name: "Aggregate" }));
    const list = await screen.findByRole("option", { name: "List" });
    fireEvent.pointerDown(list, { pointerType: "mouse" });
    fireEvent.click(list);

    const result = screen.getByRole("combobox", { name: "Result type" });
    expect(result).toBeDisabled();
    expect(result).toHaveTextContent("List");

    fireEvent.click(screen.getByRole("button", { name: "Add property" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(calls[0]?.body).toEqual({
      name: "Related titles",
      format: "list",
      compute: {
        kind: "rollup",
        relation: "related_plant",
        aggregate: "list",
        property: "title",
      },
    });
  });

  it("shows a server refusal at the member stage", async () => {
    stubFetch((input, init) => {
      const url = requestUrl(input);
      const method = init?.method ?? "GET";
      const body =
        init?.body === undefined
          ? null
          : (JSON.parse(String(init.body)) as Record<string, unknown>);
      if (method === "GET" && url.endsWith("/api/spaces/s1/types")) {
        return jsonResponse([]);
      }
      if (method === "POST" && url.endsWith("/api/spaces/s1/properties")) {
        return jsonResponse(
          {
            key: "days_since_watered",
            name: "Days since watered",
            format: "number",
            compute: body?.compute,
          },
          201,
        );
      }
      if (method === "PATCH" && url.endsWith("/api/spaces/s1/types/album")) {
        return jsonResponse(
          {
            error: {
              code: "validation",
              message: "days(last_completed_at) is not a stored property of this type",
            },
          },
          422,
        );
      }
      throw new Error(`unstubbed ${method} ${url}`);
    });

    renderWithProviders(
      <AddPropertyDialog spaceId="s1" type={album()} library={[]} onClose={vi.fn()} />,
    );

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Days since watered" },
    });
    fireEvent.click(screen.getByRole("radio", { name: "Formula" }));
    fireEvent.change(screen.getByLabelText("Expression"), {
      target: { value: "days(last_completed_at)" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add property" }));

    expect(await screen.findByText("Could not add the property to this type.")).toBeInTheDocument();
    expect(
      screen.getByText("days(last_completed_at) is not a stored property of this type"),
    ).toBeInTheDocument();
  });
});
