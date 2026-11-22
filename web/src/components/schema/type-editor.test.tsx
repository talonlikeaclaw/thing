import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { RouterProvider, createMemoryRouter, useLocation } from "react-router";
import { describe, expect, it } from "vitest";

import type { PropertyDef, SpaceDetail, TypeDef, ViewDef } from "@/api/types";
import { TypeEditor, TypeEditorSheet } from "@/components/schema/type-editor";
import { ToastProvider } from "@/components/ui/toast";
import {
  jsonResponse,
  requestUrl,
  stubFetch,
  testQueryClient,
} from "@/test/harness";

const table: ViewDef = {
  key: "all",
  name: "All",
  kind: "table",
  sorts: [],
  filter: { op: "and", conditions: [] },
  columns: ["title", "room"],
  widths: {},
};

const properties: PropertyDef[] = [{ key: "room", name: "Room", format: "text" }];

function plant(): TypeDef {
  return {
    key: "plant",
    name: "Plant",
    name_plural: "Plants",
    description: "",
    schedule: false,
    properties: [{ key: "room", required: true, featured: true, default: "study" }],
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

/** Where the router ended up, so a test can prove a leave happened. */
function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

/**
 * The editor guards unsaved changes with a router blocker, which only a data
 * router provides; the app's own router is one.
 */
function renderEditor(ui: ReactElement) {
  const router = createMemoryRouter(
    [{ path: "/s/:spaceId/schema", element: <>{ui}<LocationProbe /></> }],
    { initialEntries: ["/s/s1/schema?type=plant"] },
  );
  return render(
    <QueryClientProvider client={testQueryClient()}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("TypeEditor", () => {
  it("saves the type's own fields and leaves its memberships alone", async () => {
    let written: unknown = null;
    stubFetch((input, init) => {
      const url = requestUrl(input);
      if ((init?.method ?? "GET") === "PATCH") {
        written = JSON.parse(String(init?.body));
        return jsonResponse({ ...plant(), name: "Plant renamed" });
      }
      if (url.endsWith("/api/spaces/s1")) {
        return jsonResponse(space);
      }
      throw new Error(`unstubbed ${url}`);
    });

    renderEditor(
      <TypeEditor
        spaceId="s1"
        type={plant()}
        properties={properties}
        recordCount={0}
        canEdit
      />,
    );

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Plant renamed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save type" }));

    await waitFor(() => expect(written).not.toBeNull());
    expect(written).toEqual({
      name: "Plant renamed",
      name_plural: "Plants",
      icon: null,
      description: "",
      schedule: false,
      schedule_labels: {},
    });
  });

  it("summarises each membership and opens the one property sheet", () => {
    stubFetch((input) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/spaces/s1")) {
        return jsonResponse(space);
      }
      throw new Error(`unstubbed ${url}`);
    });

    renderEditor(
      <TypeEditor
        spaceId="s1"
        type={plant()}
        properties={properties}
        recordCount={0}
        canEdit
      />,
    );

    expect(screen.getByText("required · default study")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Manage properties" }));
    expect(screen.getByRole("heading", { name: "Properties" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit Room" })).toBeInTheDocument();
  });
});

describe("TypeEditorSheet", () => {
  it("renders the shared form in the sheet, with the server's record count", async () => {
    stubFetch((input) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/spaces/s1/types")) {
        return jsonResponse([
          {
            key: "plant",
            name: "Plant",
            name_plural: "Plants",
            description: "",
            schedule: false,
            property_count: 1,
            object_count: 4,
          },
        ]);
      }
      if (url.endsWith("/api/spaces/s1")) {
        return jsonResponse(space);
      }
      throw new Error(`unstubbed ${url}`);
    });

    renderEditor(
      <TypeEditorSheet
        spaceId="s1"
        type={plant()}
        properties={properties}
        canEdit
        onClose={() => undefined}
      />,
    );

    expect(screen.getByRole("dialog", { name: "Plant" })).toBeInTheDocument();
    // The sheet's header carries the identity; the form drops its own rule.
    expect(screen.getAllByRole("heading", { level: 2, name: "Plant" })).toHaveLength(1);
    expect(screen.getByText("Definition")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("Plant");
    // A delete names the records the server would move, not a guess from props.
    expect(await screen.findByText(/Its 4 live records move to Trash/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Move these 4 records to trash/)).toBeInTheDocument();
  });

  it("leaves for the schema page once the type is deleted", async () => {
    let deleted = false;
    stubFetch((input, init) => {
      const url = requestUrl(input);
      if ((init?.method ?? "GET") === "DELETE") {
        deleted = true;
        return jsonResponse({});
      }
      if (url.endsWith("/api/spaces/s1/types")) {
        return jsonResponse([
          {
            key: "plant",
            name: "Plant",
            name_plural: "Plants",
            description: "",
            schedule: false,
            property_count: 1,
            object_count: 0,
          },
        ]);
      }
      if (url.endsWith("/api/spaces/s1")) {
        return jsonResponse(space);
      }
      throw new Error(`unstubbed ${url}`);
    });

    const closes: number[] = [];
    renderEditor(
      <TypeEditorSheet
        spaceId="s1"
        type={plant()}
        properties={properties}
        canEdit
        onClose={() => closes.push(1)}
      />,
    );

    fireEvent.change(await screen.findByLabelText(/Type plant to confirm/), {
      target: { value: "plant" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete this type" }));

    await waitFor(() => expect(deleted).toBe(true));
    await waitFor(() => expect(closes).toHaveLength(1));
    expect(screen.getByTestId("location")).toHaveTextContent("/s/s1/schema");
  });
});
