import { fireEvent, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { AttachmentField } from "@/components/attachment-field";
import {
  jsonResponse,
  renderWithProviders,
  requestUrl,
  stubFetch,
} from "@/test/harness";

/** A stored path for a picked file, so the list reads back in upload order. */
function storedPath(input: RequestInfo | URL): string {
  const name = new URL(requestUrl(input), "http://localhost").searchParams.get("name");
  return `files/stored/${name ?? "file.bin"}`;
}

function Controlled({
  initial,
  onChange = () => {},
  defer = false,
}: {
  initial: string[];
  onChange?: (list: string[] | null) => void;
  defer?: boolean;
}) {
  const [value, setValue] = useState<string[] | null>(initial);
  return (
    <AttachmentField
      spaceId="s1"
      value={value}
      defer={defer}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

describe("AttachmentField", () => {
  it("uploads two files in order and appends them to the stored list", async () => {
    const fetchMock = stubFetch((input) =>
      jsonResponse({ path: storedPath(input), hash: "stored", name: "stored" }),
    );
    const onChange = vi.fn();
    renderWithProviders(
      <Controlled initial={["files/a/one.png"]} onChange={onChange} />,
    );

    fireEvent.change(screen.getByLabelText("Upload attachments"), {
      target: {
        files: [
          new File(["png"], "second.png", { type: "image/png" }),
          new File(["pdf"], "notes.pdf", { type: "application/pdf" }),
        ],
      },
    });

    expect(
      await screen.findByRole("button", { name: "Remove second.png" }),
    ).toBeInTheDocument();
    expect(screen.getByText("notes.pdf")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith([
        "files/a/one.png",
        "files/stored/second.png",
        "files/stored/notes.pdf",
      ]),
    );
  });

  it("keeps the previous list when an upload fails and Retry re-sends it", async () => {
    let calls = 0;
    stubFetch((input) => {
      calls += 1;
      if (calls === 1) {
        return jsonResponse(
          { error: { code: "internal", message: "The store refused the bytes." } },
          500,
        );
      }
      return jsonResponse({ path: storedPath(input), hash: "stored", name: "stored" });
    });
    const onChange = vi.fn();
    renderWithProviders(
      <Controlled initial={["files/a/one.png"]} onChange={onChange} />,
    );

    fireEvent.change(screen.getByLabelText("Upload attachments"), {
      target: { files: [new File(["png"], "retry.png", { type: "image/png" })] },
    });

    expect(
      await screen.findByText(/The store refused the bytes\./),
    ).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(
      await screen.findByRole("button", { name: "Remove retry.png" }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith([
        "files/a/one.png",
        "files/stored/retry.png",
      ]),
    );
  });

  it("removing the last item clears the value with null", () => {
    const onChange = vi.fn();
    renderWithProviders(
      <Controlled initial={["files/a/one.png"]} onChange={onChange} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove one.png" }));

    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(
      screen.getByRole("button", { name: "Add files or drop them here" }),
    ).toBeInTheDocument();
  });

  it("stages removals until Done when deferred", () => {
    const onChange = vi.fn();
    renderWithProviders(
      <Controlled
        initial={["files/a/one.png", "files/b/two.png"]}
        onChange={onChange}
        defer
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove one.png" }));
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith(["files/b/two.png"]);
  });

  it("opens the lightbox at the clicked image", async () => {
    renderWithProviders(
      <Controlled initial={["files/a/one.png", "files/b/two.png"]} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open image two.png" }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
    expect(screen.getByText("two.png")).toBeInTheDocument();
  });
});
