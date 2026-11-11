import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router";
import { describe, expect, it, vi } from "vitest";

// The property editor's dirty guard needs a data router; these tests cover the
// page's tabs, search and navigation, not the discard prompt.
vi.mock("@/lib/use-dirty-guard", () => ({
  useDirtyGuard: () => null,
}));

import type { PropertyDef, TypeDef, TypeSummary } from "@/api/types";
import { SchemaPage } from "@/pages/schema";
import { jsonResponse, renderWithProviders, requestUrl, stubFetch } from "@/test/harness";

const space = {
  id: "s1",
  name: "Garden",
  icon: "🪴",
  accent: null,
  timezone: "UTC",
  created_at: "2026-10-01T12:00:00Z",
  role: "owner",
  members: [],
  type_count: 1,
};

const plantSummary: TypeSummary = {
  key: "plant",
  name: "Plant",
  name_plural: "Plants",
  description: "",
  schedule: false,
  property_count: 2,
  object_count: 2,
};

const properties: PropertyDef[] = [
  { key: "room", name: "Room", format: "select", options: [] },
  { key: "bedroom", name: "Bedroom", format: "text" },
  { key: "room_type", name: "Category", format: "text" },
  { key: "notes", name: "Notes", format: "text" },
];

const plantType: TypeDef = {
  key: "plant",
  name: "Plant",
  name_plural: "Plants",
  description: "",
  schedule: false,
  properties: [
    { key: "room", required: false, featured: true },
    { key: "notes", required: false, featured: false },
  ],
  views: [
    {
      key: "table",
      name: "Table",
      kind: "table",
      sorts: [],
      filter: { op: "and", conditions: [] },
      columns: ["title", "room", "notes"],
    },
  ],
  default_view: "table",
};

function stubSchema() {
  return stubFetch((input) => {
    const url = requestUrl(input);
    if (url.endsWith("/api/spaces/s1/types/plant")) {
      return jsonResponse(plantType);
    }
    if (url.endsWith("/api/spaces/s1/types")) {
      return jsonResponse([plantSummary]);
    }
    if (url.endsWith("/api/spaces/s1/properties")) {
      return jsonResponse(properties);
    }
    if (url.includes("/api/spaces/s1/objects?")) {
      return jsonResponse({
        view: "table",
        total: 3,
        offset: 0,
        limit: 1,
        has_more: true,
        objects: [],
      });
    }
    if (url.endsWith("/api/spaces/s1")) {
      return jsonResponse(space);
    }
    throw new Error(`unstubbed ${url}`);
  });
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

function renderSchema(route = "/s/s1/schema") {
  return renderWithProviders(
    <>
      <Routes>
        <Route path="/s/:spaceId/schema" element={<SchemaPage />} />
      </Routes>
      <LocationProbe />
    </>,
    { route },
  );
}

/** Answer the media question one device shape asks. */
function stubMedia(phone: boolean) {
  return vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        matches: phone && (query === "(max-width: 639px)" || query === "(pointer: coarse)"),
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }) as MediaQueryList,
  );
}

function listRows(label: string): HTMLElement[] {
  const region = screen.getByRole("region", { name: label });
  return [...region.querySelectorAll<HTMLElement>("ul > li")];
}

describe("SchemaPage", () => {
  it("shows one tab at a time and keeps the tab in the URL", async () => {
    stubSchema();
    renderSchema();

    const typesList = await screen.findByRole("region", { name: "Types" });
    expect(within(typesList).getByRole("button", { name: /Plant/ })).toBeInTheDocument();
    expect(document.getElementById("type-editor")).not.toBeNull();
    expect(screen.queryByRole("region", { name: "Properties" })).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: /Properties/ }));

    expect(screen.getByTestId("location")).toHaveTextContent("/s/s1/schema?tab=properties");
    expect(screen.getByRole("region", { name: "Properties" })).toBeInTheDocument();
    expect(document.getElementById("type-editor")).toBeNull();
    expect(screen.queryByRole("region", { name: "Types" })).toBeNull();
  });

  it("lets a selected property win over the tab parameter", async () => {
    stubSchema();
    renderSchema("/s/s1/schema?tab=types&property=room");

    expect(await screen.findByDisplayValue("Room")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Properties" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Properties/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("searches the property list by name and key and counts the matches", async () => {
    stubSchema();
    renderSchema("/s/s1/schema?tab=properties");

    fireEvent.change(await screen.findByRole("searchbox", { name: "Search properties" }), {
      target: { value: "ro" },
    });

    const rows = listRows("Properties");
    expect(rows).toHaveLength(3);
    const names = rows.map((row) => row.textContent ?? "");
    expect(names[0]).toContain("Room");
    expect(names[1]).toContain("Bedroom");
    expect(names[2]).toContain("Category");
    expect(screen.queryByText("room_type")).not.toBeInTheDocument();
    expect(screen.getByText("3 of 4")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search properties" }), {
      target: { value: "zzz" },
    });
    expect(screen.getByText("No property matches “zzz”.")).toBeInTheDocument();
  });

  it("searches the type list by name and key", async () => {
    stubSchema();
    renderSchema("/s/s1/schema?tab=types");

    fireEvent.change(await screen.findByRole("searchbox", { name: "Search types" }), {
      target: { value: "pla" },
    });

    expect(listRows("Types")).toHaveLength(1);
    expect(screen.getByText("1 of 1")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search types" }), {
      target: { value: "zzz" },
    });
    expect(screen.getByText("No type matches “zzz”.")).toBeInTheDocument();
  });

  it("keeps the record page's #type-editor deep link working", async () => {
    stubSchema();
    renderSchema("/s/s1/schema#type-editor");

    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/s/s1/schema?tab=types&type=plant",
      ),
    );
    expect(document.getElementById("type-editor")).not.toBeNull();
  });

  it("takes a deep-linked property to its editor and its usage", async () => {
    stubSchema();
    renderSchema("/s/s1/schema?property=room");

    expect(await screen.findByDisplayValue("Room")).toBeInTheDocument();
    expect(await screen.findByText("3 live records hold a value.")).toBeInTheDocument();
    const usage = screen.getByRole("region", { name: "Used by" });
    expect(within(usage).getByText("Plant")).toBeInTheDocument();
  });

  it("opens a type on a phone and returns to the list with Back", async () => {
    stubMedia(true);
    stubSchema();
    renderSchema();

    const list = await screen.findByRole("region", { name: "Types" });
    expect(document.getElementById("type-editor")).toBeNull();

    fireEvent.click(within(list).getByRole("button", { name: /Plant/ }));

    expect(await screen.findByRole("button", { name: "Back to types" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Types" })).toBeNull();
    expect(document.getElementById("type-editor")).not.toBeNull();
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/s/s1/schema?tab=types&type=plant",
    );

    fireEvent.click(screen.getByRole("button", { name: "Back to types" }));

    await waitFor(() =>
      expect(screen.getByRole("region", { name: "Types" })).toBeInTheDocument(),
    );
    expect(document.getElementById("type-editor")).toBeNull();
    expect(screen.getByTestId("location")).not.toHaveTextContent("type=plant");
  });

  it("opens the property editor on a phone with a way back to the list", async () => {
    stubMedia(true);
    stubSchema();
    renderSchema("/s/s1/schema?tab=properties&property=room");

    expect(await screen.findByRole("button", { name: "Back to properties" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("Room")).toBeInTheDocument();
  });
});
