import { describe, expect, it } from "vitest";

import type { LibraryItem, LibraryRecord } from "@/api/types";
import {
  EMPTY_LIBRARY_FILTER,
  filterLibrary,
  isFiltered,
  liveUpdatedAt,
  sortLibrary,
} from "@/lib/library";

function record(overrides: Partial<LibraryRecord> = {}): LibraryRecord {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    rev: 1,
    title: "Monstera",
    icon: "🪴",
    type_key: "plant",
    type_name: "Plant",
    field: "photos",
    field_name: "Photos",
    trashed: false,
    updated_at: "2026-11-01T12:00:00Z",
    ...overrides,
  };
}

function item(overrides: Partial<LibraryItem> = {}): LibraryItem {
  return {
    path: "files/aa/leaf.png",
    name: "leaf.png",
    size: 100,
    kind: "image",
    unused: false,
    records: [record()],
    ...overrides,
  };
}

const leaf = item({ path: "files/aa/leaf.png", name: "leaf.png", size: 100 });
const notes = item({
  path: "files/bb/garden-notes.pdf",
  name: "garden-notes.pdf",
  size: 900,
  kind: "file",
  records: [record({ id: "00000000-0000-0000-0000-000000000002", type_key: "chore", title: "Repot" })],
});
const orphan = item({
  path: "files/cc/orphan.png",
  name: "orphan.png",
  size: 50,
  unused: true,
  records: [],
});

describe("filterLibrary", () => {
  it("keeps everything when nothing is set", () => {
    expect(filterLibrary([leaf, notes, orphan], EMPTY_LIBRARY_FILTER)).toEqual([
      leaf,
      notes,
      orphan,
    ]);
    expect(isFiltered(EMPTY_LIBRARY_FILTER)).toBe(false);
  });

  it("filters by kind", () => {
    expect(filterLibrary([leaf, notes, orphan], { ...EMPTY_LIBRARY_FILTER, kind: "file" })).toEqual([
      notes,
    ]);
    expect(
      filterLibrary([leaf, notes, orphan], { ...EMPTY_LIBRARY_FILTER, kind: "image" }),
    ).toEqual([leaf, orphan]);
    expect(isFiltered({ ...EMPTY_LIBRARY_FILTER, kind: "image" })).toBe(true);
  });

  it("filters by the types that name the file", () => {
    expect(
      filterLibrary([leaf, notes, orphan], { ...EMPTY_LIBRARY_FILTER, types: ["chore"] }),
    ).toEqual([notes]);
    expect(
      filterLibrary([leaf, notes, orphan], { ...EMPTY_LIBRARY_FILTER, types: ["plant", "chore"] }),
    ).toEqual([leaf, notes]);
  });

  it("filters by a case-insensitive name fragment", () => {
    expect(
      filterLibrary([leaf, notes, orphan], { ...EMPTY_LIBRARY_FILTER, query: " LEAF " }),
    ).toEqual([leaf]);
    expect(
      filterLibrary([leaf, notes, orphan], { ...EMPTY_LIBRARY_FILTER, query: "zzz" }),
    ).toEqual([]);
  });
});

describe("sortLibrary", () => {
  it("sorts by name, case-insensitively", () => {
    expect(sortLibrary([leaf, notes, orphan], "name").map((row) => row.name)).toEqual([
      "garden-notes.pdf",
      "leaf.png",
      "orphan.png",
    ]);
  });

  it("sorts by size, largest first", () => {
    expect(sortLibrary([leaf, notes, orphan], "size").map((row) => row.name)).toEqual([
      "garden-notes.pdf",
      "leaf.png",
      "orphan.png",
    ]);
  });

  it("sorts by the newest live save and leaves unused files last", () => {
    const fresh = item({
      path: "files/dd/fresh.png",
      name: "fresh.png",
      records: [record({ updated_at: "2026-11-05T12:00:00Z" })],
    });
    const trashedOnly = item({
      path: "files/ee/gone.png",
      name: "gone.png",
      records: [record({ updated_at: "2026-11-09T12:00:00Z", trashed: true })],
    });

    expect(sortLibrary([orphan, leaf, trashedOnly, fresh], "recent").map((row) => row.name)).toEqual(
      ["fresh.png", "leaf.png", "gone.png", "orphan.png"],
    );
  });

  it("ignores the trashed saves when reading the last moment", () => {
    expect(
      liveUpdatedAt(
        item({
          records: [
            record({ updated_at: "2026-11-01T12:00:00Z" }),
            record({ id: "00000000-0000-0000-0000-000000000003", trashed: true, updated_at: "2026-11-09T12:00:00Z" }),
          ],
        }),
      ),
    ).toBe(Date.parse("2026-11-01T12:00:00Z"));
  });

  it("does not mutate the list it was given", () => {
    const items = [notes, leaf];
    sortLibrary(items, "name");
    expect(items).toEqual([notes, leaf]);
  });
});
