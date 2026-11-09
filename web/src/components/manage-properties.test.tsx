import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { PropertyDef, TypeDef, ViewDef } from "@/api/types";
import { ManageProperties } from "@/components/manage-properties";
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

const room: PropertyDef = { key: "room", name: "Room", format: "text" };
const bedroom: PropertyDef = { key: "bedroom", name: "Bedroom", format: "checkbox" };
const size: PropertyDef = { key: "size", name: "Size", format: "number" };
const color: PropertyDef = { key: "color", name: "Colour", format: "text" };

function album(schedule = false): TypeDef {
  return {
    key: "album",
    name: "Album",
    name_plural: "Albums",
    description: "",
    schedule,
    properties: [
      { key: "room", required: false, featured: true },
      { key: "bedroom", required: false, featured: true },
      { key: "size", required: false, featured: true },
    ],
    views: [table],
    default_view: "all",
    ...(schedule
      ? {
          implicit_properties: [
            { key: "due_date", name: "Due", format: "date" as const },
          ],
        }
      : {}),
  };
}

describe("ManageProperties", () => {
  it("writes the member list when a property moves", async () => {
    let written: unknown = null;
    stubFetch((input, init) => {
      const url = requestUrl(input);
      if ((init?.method ?? "GET") === "PATCH") {
        written = JSON.parse(String(init?.body));
        return jsonResponse(album());
      }
      if (url.endsWith("/api/spaces/s1/types")) {
        return jsonResponse([]);
      }
      throw new Error(`unstubbed ${url}`);
    });

    renderWithProviders(
      <ManageProperties
        spaceId="s1"
        type={album()}
        library={[room, bedroom, size, color]}
        canEdit
        onClose={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Move Room: position 1 of 3" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Move to position 2" }));

    await waitFor(() => expect(written).not.toBeNull());
    expect(written).toEqual({
      properties: [
        { key: "bedroom", required: false, featured: true },
        { key: "room", required: false, featured: true },
        { key: "size", required: false, featured: true },
      ],
    });
  });

  it("removes a member from the type and shows the server's refusal in place", async () => {
    const writes: Record<string, unknown>[] = [];
    stubFetch((input, init) => {
      const url = requestUrl(input);
      if ((init?.method ?? "GET") === "PATCH") {
        writes.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        if (writes.length === 1) {
          return jsonResponse(album());
        }
        return jsonResponse(
          {
            error: {
              code: "conflict",
              message: "A view groups by this property.",
            },
          },
          409,
        );
      }
      if (url.endsWith("/api/spaces/s1/types")) {
        return jsonResponse([]);
      }
      throw new Error(`unstubbed ${url}`);
    });

    renderWithProviders(
      <ManageProperties
        spaceId="s1"
        type={album()}
        library={[room, bedroom, size, color]}
        canEdit
        onClose={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove Bedroom from this type" }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toEqual({
      properties: [
        { key: "room", required: false, featured: true },
        { key: "size", required: false, featured: true },
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: "Remove Room from this type" }));
    expect(
      await screen.findByText("A view groups by this property."),
    ).toBeInTheDocument();
  });

  it("searches the member list and counts the matches", () => {
    renderWithProviders(
      <ManageProperties
        spaceId="s1"
        type={album()}
        library={[room, bedroom, size, color]}
        canEdit
        onClose={() => undefined}
      />,
    );

    expect(screen.getByText("3 of 3")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search properties" }), {
      target: { value: "bed" },
    });
    expect(screen.getByText("1 of 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit Bedroom" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit Room" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search properties" }), {
      target: { value: "zzz" },
    });
    expect(screen.getByText("0 of 3")).toBeInTheDocument();
    expect(screen.getByText("No property matches “zzz”.")).toBeInTheDocument();
  });

  it("marks generated schedule properties read-only", () => {
    renderWithProviders(
      <ManageProperties
        spaceId="s1"
        type={album(true)}
        library={[room, bedroom, size, color]}
        canEdit
        onClose={() => undefined}
      />,
    );

    expect(screen.getByText("4 of 4")).toBeInTheDocument();
    expect(screen.getByText("generated")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit Due" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Remove Due from this type" }),
    ).not.toBeInTheDocument();
  });

  it("opens the add sheet and keeps the manage list behind it", async () => {
    stubFetch((input) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/spaces/s1/types")) {
        return jsonResponse([]);
      }
      throw new Error(`unstubbed ${url}`);
    });

    renderWithProviders(
      <ManageProperties
        spaceId="s1"
        type={album()}
        library={[room, bedroom, size, color]}
        canEdit
        onClose={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add property" }));
    expect(
      await screen.findByRole("heading", { name: "Add property" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close add property" }));
    expect(screen.getByRole("heading", { name: "Properties" })).toBeInTheDocument();
  });
});
