import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { RefObject } from "react";
import { useLocation } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { queryKeys } from "@/api/queries";
import { CommandPalette } from "@/components/command-palette";
import {
  jsonResponse,
  renderWithProviders,
  requestUrl,
  stubFetch,
  testQueryClient,
} from "@/test/harness";

const result = (id: string, title: string, snippet?: string) => ({
  id,
  type: "plant",
  type_name: "Plant",
  title,
  updated_at: "2026-11-01T12:00:00Z",
  score: 9,
  ...(snippet === undefined ? {} : { snippet }),
});

const unfurling = {
  query: "unfurling",
  total: 1,
  results: [result("o1", "Monstera in the study", "The unfurling leaf.")],
};

const leafSearch = {
  query: "leaf",
  total: 2,
  results: [
    result("o1", "Monstera in the study", "The unfurling leaf."),
    result("o2", "Fiddle-leaf fig"),
  ],
};

function stubPalette(search: unknown) {
  return stubFetch((input) => {
    const url = requestUrl(input);
    if (url.endsWith("/api/auth/me")) {
      return jsonResponse({ id: "u1", email: "a@b.c", name: "Talen" });
    }
    if (url.endsWith("/api/spaces")) {
      return jsonResponse([]);
    }
    if (url.endsWith("/api/spaces/s1/types")) {
      return jsonResponse([]);
    }
    if (url.endsWith("/api/spaces/s1/trash")) {
      return jsonResponse([]);
    }
    if (url.endsWith("/api/spaces/s1/properties")) {
      return jsonResponse([
        { key: "room", name: "Room", format: "select" },
        { key: "bedroom", name: "Bedroom", format: "text" },
        { key: "room_type", name: "Category", format: "text" },
      ]);
    }
    if (url.includes("/api/spaces/s1/search")) {
      return jsonResponse(search);
    }
    throw new Error(`unstubbed ${url}`);
  });
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

function PaletteHost({
  onOpenChange,
  inputRef,
  returnFocusRef,
}: {
  onOpenChange: (open: boolean) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  returnFocusRef: RefObject<HTMLElement | null>;
}) {
  return (
    <>
      <CommandPalette
        open
        onOpenChange={onOpenChange}
        inputRef={inputRef}
        returnFocusRef={returnFocusRef}
        spaceId="s1"
      />
      <LocationProbe />
    </>
  );
}

function openPalette(onOpenChange: (open: boolean) => void = () => undefined) {
  const inputRef = { current: null } as RefObject<HTMLInputElement | null>;
  const returnFocusRef = { current: null } as RefObject<HTMLElement | null>;
  const queryClient = testQueryClient();
  // The signed-in user is already in the cache when the shell opens the palette
  // in the app; seeding it here keeps the open effect from clearing the query.
  queryClient.setQueryData(queryKeys.me, {
    id: "u1",
    email: "a@b.c",
    name: "Talen",
  });
  renderWithProviders(
    <PaletteHost
      onOpenChange={onOpenChange}
      inputRef={inputRef}
      returnFocusRef={returnFocusRef}
    />,
    { queryClient },
  );
  return screen.getByRole("combobox", { name: "Search and commands" });
}

describe("CommandPalette", () => {
  it("shows a body-only result with its snippet and opens the record on Enter", async () => {
    stubPalette(unfurling);
    const input = openPalette();

    fireEvent.change(input, { target: { value: "unfurling" } });

    expect(await screen.findByText("Monstera in the study")).toBeInTheDocument();
    const mark = await waitFor(() => {
      const found = document.querySelector("mark");
      expect(found).not.toBeNull();
      return found;
    });
    expect(mark?.textContent).toBe("unfurling");
    expect(mark?.parentElement?.textContent).toBe("The unfurling leaf.");

    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent("/s/s1/o/o1?q=unfurling");
    });
  });

  it("wraps the highlight with the arrow keys", async () => {
    stubPalette(leafSearch);
    const input = openPalette();

    fireEvent.change(input, { target: { value: "leaf" } });
    await waitFor(() => {
      expect(screen.getAllByRole("option")).toHaveLength(2);
    });

    fireEvent.keyDown(input, { key: "ArrowUp" });

    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveAttribute("aria-selected", "false");
    expect(options[1]).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(input, { key: "ArrowDown" });

    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");
  });

  it("closes on Escape", () => {
    stubPalette(unfurling);
    const onOpenChange = vi.fn();
    const input = openPalette(onOpenChange);

    fireEvent.keyDown(input, { key: "Escape" });

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("finds a property and opens it on the schema page", async () => {
    stubPalette(unfurling);
    const input = openPalette();

    fireEvent.change(input, { target: { value: "roo" } });

    const group = await screen.findByRole("group", { name: "Properties" });
    const options = within(group).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      expect.stringContaining("Room"),
      expect.stringContaining("Bedroom"),
      expect.stringContaining("Category"),
    ]);
    expect(options[0]).toHaveTextContent(/Select/);

    fireEvent.click(options[0]!);

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/s/s1/schema?tab=properties&property=room",
      );
    });
  });

  it("prints the result count", async () => {
    stubPalette(unfurling);
    const input = openPalette();

    fireEvent.change(input, { target: { value: "unfurling" } });
    await screen.findByText("Monstera in the study");

    expect(screen.getByText("1 result")).toBeInTheDocument();
  });

  it("prints a plural count for more than one result", async () => {
    stubPalette(leafSearch);
    const input = openPalette();

    fireEvent.change(input, { target: { value: "leaf" } });
    await screen.findByText("Monstera in the study");

    expect(screen.getByText("2 results")).toBeInTheDocument();
  });
});
