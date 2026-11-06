import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ObjectSummary, PropertyDef, TypeDef, ViewDef } from "@/api/types";
import { GalleryView } from "@/components/views/gallery-view";
import { renderWithProviders } from "@/test/harness";

const plantType: TypeDef = {
  key: "plant",
  name: "Plant",
  name_plural: "Plants",
  description: "",
  schedule: false,
  properties: [],
  views: [],
  default_view: "all",
};

const gallery: ViewDef = {
  key: "gallery",
  name: "Gallery",
  kind: "gallery",
  sorts: [],
  filter: { op: "and", conditions: [] },
  columns: ["title"],
};

const row: ObjectSummary = {
  id: "o1",
  type: "plant",
  title: "Monstera",
  cover: "files/hash/cover.png",
  cover_position: "20% 70%",
  rev: 1,
  updated_at: "2026-11-01T12:00:00Z",
  values: {},
  missing_relations: [],
};

function galleryOf(
  view: ViewDef,
  properties: PropertyDef[],
  values: ObjectSummary["values"] = {},
) {
  return (
    <GalleryView
      spaceId="s1"
      type={plantType}
      view={view}
      rows={[{ ...row, values }]}
      properties={properties}
      canEdit={false}
      completing={false}
      pendingRows={new Set()}
      verb="Water"
      onComplete={() => undefined}
      onDuplicate={() => undefined}
      onTrash={() => undefined}
    />
  );
}

describe("GalleryView image covers", () => {
  it("falls back to the record cover and its focal point", () => {
    const { container } = renderWithProviders(galleryOf(gallery, []));
    const image = container.querySelector("img");
    expect(image).not.toBeNull();
    expect(image?.getAttribute("src")).toBe("/api/spaces/s1/files/hash/cover.png?w=512");
    expect(image?.style.objectPosition).toBe("20% 70%");
  });

  it("prefers an image property named by the view", () => {
    const photo: PropertyDef = { key: "photo", name: "Photo", format: "image" };
    const { container } = renderWithProviders(
      galleryOf(
        { ...gallery, cover: "photo" },
        [photo],
        { photo: { value: "files/p/photo.png", label: "photo.png" } },
      ),
    );
    const image = container.querySelector("img");
    expect(image?.getAttribute("src")).toBe("/api/spaces/s1/files/p/photo.png?w=512");
    expect(image?.style.objectPosition).toBe("");
  });

  it("keeps a non-image cover property typographic", () => {
    const room: PropertyDef = { key: "room", name: "Room", format: "select", options: [] };
    const { container } = renderWithProviders(
      galleryOf({ ...gallery, cover: "room" }, [room], {
        room: { value: "study", label: "Study" },
      }),
    );
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("Study")).toBeInTheDocument();
  });

  it("opens the image and returns focus to the tile on Escape", async () => {
    renderWithProviders(galleryOf(gallery, []));
    const opener = screen.getByRole("button", { name: "Open image for “Monstera”" });
    fireEvent.click(opener);

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByAltText("Monstera")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(opener).toHaveFocus());
  });
});
