import { fireEvent, screen, waitFor } from "@testing-library/react";
import { Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";

import type { Library } from "@/api/types";
import { LibraryPage } from "@/pages/library";
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
  type_count: 2,
};

const types = [
  {
    key: "plant",
    name: "Plant",
    name_plural: "Plants",
    description: "",
    schedule: false,
    property_count: 0,
    object_count: 2,
  },
  {
    key: "chore",
    name: "Chore",
    name_plural: "Chores",
    description: "",
    schedule: false,
    property_count: 0,
    object_count: 1,
  },
];

const library: Library = {
  items: [
    {
      path: "files/aa/leaf.png",
      name: "leaf.png",
      size: 2048,
      kind: "image",
      unused: false,
      records: [
        {
          id: "o1",
          rev: 2,
          title: "Monstera",
          icon: "🪴",
          type_key: "plant",
          type_name: "Plant",
          field: "photos",
          field_name: "Photos",
          trashed: false,
          updated_at: "2026-11-05T12:00:00Z",
        },
      ],
    },
    {
      path: "files/bb/garden-notes.pdf",
      name: "garden-notes.pdf",
      size: 9000,
      kind: "file",
      unused: false,
      records: [
        {
          id: "o2",
          rev: 1,
          title: "Repot",
          icon: null,
          type_key: "chore",
          type_name: "Chore",
          field: "cover",
          field_name: "Cover",
          trashed: false,
          updated_at: "2026-11-01T12:00:00Z",
        },
      ],
    },
    {
      path: "files/cc/orphan.png",
      name: "orphan.png",
      size: 512,
      kind: "image",
      unused: true,
      records: [],
    },
    {
      path: "files/dd/zinnia.png",
      name: "zinnia.png",
      size: 3000,
      kind: "image",
      unused: false,
      records: [
        {
          id: "o3",
          rev: 3,
          title: "Old zinnia",
          icon: null,
          type_key: "plant",
          type_name: "Plant",
          field: "body",
          field_name: "Body",
          trashed: true,
          updated_at: "2026-11-07T12:00:00Z",
        },
      ],
    },
  ],
  total_bytes: 14560,
  unused_bytes: 512,
};


const plantType = {
  key: "plant",
  name: "Plant",
  name_plural: "Plants",
  icon: "🪴",
  description: "",
  schedule: false,
  properties: [{ key: "room", required: false, featured: true }],
  views: [],
  default_view: "table",
};

const roomProperty = {
  key: "room",
  name: "Room",
  format: "select",
  options: [{ key: "study", name: "Study", color: "#000000" }],
};

const plantRows = {
  view: "table",
  total: 1,
  offset: 0,
  limit: 500,
  has_more: false,
  objects: [
    {
      id: "o1",
      type: "plant",
      title: "Monstera",
      rev: 2,
      updated_at: "2026-11-05T12:00:00Z",
      values: { room: { value: "study", label: "Study" } },
      missing_relations: [],
    },
  ],
};

function stubLibrary(payload: Library = library) {
  return stubFetch((input) => {
    const url = requestUrl(input);
    if (url.endsWith("/api/spaces/s1/types")) {
      return jsonResponse(types);
    }
    if (url.endsWith("/api/spaces/s1/files")) {
      return jsonResponse(payload);
    }
    if (url.endsWith("/api/spaces/s1/types/plant")) {
      return jsonResponse(plantType);
    }
    if (url.endsWith("/api/spaces/s1/properties")) {
      return jsonResponse([roomProperty]);
    }
    if (url.includes("/api/spaces/s1/objects?")) {
      return jsonResponse(plantRows);
    }
    if (url.endsWith("/api/spaces/s1")) {
      return jsonResponse(space);
    }
    throw new Error(`unstubbed ${url}`);
  });
}

function renderLibrary() {
  return renderWithProviders(
    <Routes>
      <Route path="/s/:spaceId/library" element={<LibraryPage />} />
    </Routes>,
    { route: "/s/s1/library" },
  );
}

/** The card names in the order the grid renders them. */
function visibleNames(): string[] {
  return [...document.querySelectorAll<HTMLElement>("[aria-label='Library files'] > li")].map(
    (card) => card.querySelector<HTMLElement>("span[title]")?.getAttribute("title") ?? "",
  );
}

describe("LibraryPage", () => {
  it("lists every path with its record chips and the space total", async () => {
    stubLibrary();
    renderLibrary();

    await screen.findByText("leaf.png");
    expect(visibleNames()).toEqual([
      "leaf.png",
      "garden-notes.pdf",
      "orphan.png",
      "zinnia.png",
    ]);
    expect(screen.getByText(/4 files · 14\.2 KiB/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Monstera/ })).toHaveAttribute(
      "href",
      "/s/s1/o/o1",
    );
    // A trashed use names itself but is not a way into the record.
    expect(screen.getByText("In trash")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Old zinnia/ })).toBeNull();
    expect(screen.getByText("Unused")).toBeInTheDocument();
  });

  it("filters by kind, type and name, and clears back to everything", async () => {
    stubLibrary();
    renderLibrary();

    await screen.findByText("leaf.png");

    fireEvent.click(screen.getByRole("button", { name: "Photos" }));
    expect(visibleNames()).toEqual(["leaf.png", "orphan.png", "zinnia.png"]);

    fireEvent.click(screen.getByRole("button", { name: "Files" }));
    expect(visibleNames()).toEqual(["garden-notes.pdf"]);

    fireEvent.click(screen.getByRole("button", { name: "All" }));
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Chore" }));
    expect(visibleNames()).toEqual(["garden-notes.pdf"]);

    fireEvent.click(screen.getByRole("checkbox", { name: "Chore" }));
    fireEvent.change(screen.getByLabelText("Search files by name"), {
      target: { value: "LEAF" },
    });
    expect(visibleNames()).toEqual(["leaf.png"]);

    fireEvent.change(screen.getByLabelText("Search files by name"), {
      target: { value: "zzz" },
    });
    expect(screen.getByText("No files match these filters.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(visibleNames()).toHaveLength(4);
  });

  it("orders by name and size from the sort select", async () => {
    stubLibrary();
    renderLibrary();

    await screen.findByText("leaf.png");

    fireEvent.change(screen.getByLabelText("Sort files"), { target: { value: "name" } });
    expect(visibleNames()).toEqual([
      "garden-notes.pdf",
      "leaf.png",
      "orphan.png",
      "zinnia.png",
    ]);

    fireEvent.change(screen.getByLabelText("Sort files"), { target: { value: "size" } });
    expect(visibleNames()).toEqual([
      "garden-notes.pdf",
      "zinnia.png",
      "leaf.png",
      "orphan.png",
    ]);

    fireEvent.change(screen.getByLabelText("Sort files"), { target: { value: "recent" } });
    expect(visibleNames()).toEqual([
      "leaf.png",
      "garden-notes.pdf",
      "orphan.png",
      "zinnia.png",
    ]);
  });

  it("opens the filtered photos in the overlay at the clicked one", async () => {
    stubLibrary();
    renderLibrary();

    await screen.findByText("leaf.png");
    fireEvent.click(screen.getByRole("button", { name: "Photos" }));
    fireEvent.click(screen.getByRole("button", { name: "Open image leaf.png" }));

    expect(await screen.findByText("1 / 3")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    await waitFor(() => expect(screen.getByText("2 / 3")).toBeInTheDocument());
  });

  it("narrows one type by a property value", async () => {
    const requests: URL[] = [];
    const handler = stubLibrary();
    // Record every object read so the condition the page sends is visible.
    const base = handler.getMockImplementation();
    handler.mockImplementation((input, init) => {
      const url = new URL(requestUrl(input), "http://localhost");
      if (url.pathname.endsWith("/objects")) {
        requests.push(url);
      }
      return base!(input, init);
    });

    renderLibrary();
    await screen.findByText("leaf.png");

    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Plant" }));

    const propertySelect = await screen.findByLabelText("Filter by property");
    // The type's own properties arrive with its read, not with the summary.
    await screen.findByRole("option", { name: "Room" });
    expect(screen.queryByLabelText("Property value")).toBeNull();

    fireEvent.change(propertySelect, { target: { value: "room" } });
    fireEvent.change(screen.getByLabelText("Property value"), {
      target: { value: "study" },
    });

    await waitFor(() => expect(visibleNames()).toEqual(["leaf.png"]));
    const objects = requests.at(-1);
    expect(objects?.searchParams.get("type")).toBe("plant");
    expect(JSON.parse(objects?.searchParams.get("filter") ?? "null")).toEqual({
      op: "and",
      conditions: [{ property: "room", condition: "equal", value: "study" }],
    });

    // A second type makes the property filter meaningless, so it disappears
    // and the list widens again. The popover stays open while it is edited.
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Plant" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Chore" }));
    expect(screen.queryByLabelText("Filter by property")).toBeNull();
    // Zinnia keeps its trashed plant record, so it is a plant use as well.
    await waitFor(() =>
      expect(visibleNames()).toEqual(["leaf.png", "garden-notes.pdf", "zinnia.png"]),
    );
  });

  it("reads every page of a matched-record set", async () => {
    const offsets: (string | null)[] = [];
    stubFetch((input) => {
      const url = new URL(requestUrl(input), "http://localhost");
      if (url.pathname === "/api/spaces/s1/files") return jsonResponse(library);
      if (url.pathname === "/api/spaces/s1/types") return jsonResponse(types);
      if (url.pathname === "/api/spaces/s1/types/plant") return jsonResponse(plantType);
      if (url.pathname === "/api/spaces/s1/properties") return jsonResponse([roomProperty]);
      if (url.pathname === "/api/spaces/s1") return jsonResponse(space);
      if (url.pathname === "/api/spaces/s1/objects") {
        const offset = url.searchParams.get("offset");
        offsets.push(offset);
        return jsonResponse(
          offsets.length === 1
            ? { ...plantRows, limit: 1, has_more: true }
            : {
                view: "table",
                total: 2,
                offset: 1,
                limit: 1,
                has_more: false,
                objects: [
                  {
                    id: "o3",
                    type: "plant",
                    title: "Old zinnia",
                    rev: 3,
                    updated_at: "2026-11-07T12:00:00Z",
                    values: {},
                    missing_relations: [],
                  },
                ],
              },
        );
      }
      throw new Error(`unstubbed ${url.pathname}`);
    });

    renderLibrary();
    await screen.findByText("leaf.png");
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Plant" }));
    await screen.findByRole("option", { name: "Room" });
    fireEvent.change(screen.getByLabelText("Filter by property"), {
      target: { value: "room" },
    });
    fireEvent.change(screen.getByLabelText("Property value"), {
      target: { value: "study" },
    });

    await waitFor(() =>
      expect(visibleNames()).toEqual(["leaf.png", "zinnia.png"]),
    );
    expect(offsets).toEqual(["0", "1"]);
  });

  it("offers the two empty states", async () => {
    stubLibrary({ items: [], total_bytes: 0, unused_bytes: 0 });
    const { unmount } = renderLibrary();

    expect(await screen.findByText("No files yet. Add one from a record.")).toBeInTheDocument();
    unmount();

    stubLibrary();
    renderLibrary();
    await screen.findByText("leaf.png");
    fireEvent.change(screen.getByLabelText("Search files by name"), {
      target: { value: "zzz" },
    });
    expect(screen.getByText("No files match these filters.")).toBeInTheDocument();
  });
});
