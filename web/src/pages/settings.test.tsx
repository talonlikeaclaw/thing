import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Library } from "@/api/types";
import { StorageSection } from "@/pages/settings";
import { jsonResponse, renderWithProviders, requestUrl, stubFetch } from "@/test/harness";

const library: Library = {
  items: [
    {
      path: "files/aa/leaf.png",
      name: "leaf.png",
      size: 512,
      kind: "image",
      unused: true,
      records: [],
    },
  ],
  total_bytes: 3840,
  unused_bytes: 512,
};

function stubStorage({
  payload = library,
  collected = { removed: 1, freed_bytes: 512 },
  gc,
}: {
  payload?: Library;
  collected?: { removed: number; freed_bytes: number };
  gc?: () => void;
} = {}) {
  return stubFetch((input, init) => {
    const url = requestUrl(input);
    if (url.endsWith("/api/spaces/s1/files/gc") && init?.method === "POST") {
      gc?.();
      return jsonResponse(collected);
    }
    if (url.endsWith("/api/spaces/s1/files")) {
      return jsonResponse(payload);
    }
    throw new Error(`unstubbed ${url}`);
  });
}

describe("StorageSection", () => {
  it("shows the used and unused totals and reports a collection", async () => {
    const collect = vi.fn();
    stubStorage({ gc: collect });
    renderWithProviders(<StorageSection spaceId="s1" owner />);

    expect(await screen.findByText(/3\.8 KiB used/)).toBeInTheDocument();
    expect(screen.getByText(/512 B belongs to files no record names/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Collect unused" }));
    await waitFor(() =>
      expect(screen.getByText("Removed 1 file, freed 512 B")).toBeInTheDocument(),
    );
    expect(collect).toHaveBeenCalledTimes(1);
  });

  it("words a one-file collection in the singular", async () => {
    stubStorage({ collected: { removed: 1, freed_bytes: 1024 } });
    renderWithProviders(<StorageSection spaceId="s1" owner />);

    fireEvent.click(await screen.findByRole("button", { name: "Collect unused" }));
    await waitFor(() =>
      expect(screen.getByText("Removed 1 file, freed 1.0 KiB")).toBeInTheDocument(),
    );
  });

  it("offers no collection to a reader who is not an owner", async () => {
    stubStorage();
    renderWithProviders(<StorageSection spaceId="s1" owner={false} />);

    expect(
      await screen.findByText("Only an owner can collect unused files."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Collect unused" })).toBeNull();
  });

  it("says nothing is waiting when every file is used", async () => {
    stubStorage({ payload: { ...library, unused_bytes: 0 } });
    renderWithProviders(<StorageSection spaceId="s1" owner />);

    expect(await screen.findByText(/Nothing is waiting to be collected/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Collect unused" })).toBeDisabled();
  });
});
