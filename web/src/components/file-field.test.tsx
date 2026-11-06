import { fireEvent, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { FileField } from "@/components/file-field";
import { renderWithProviders, stubFetch } from "@/test/harness";

describe("FileField", () => {
  it("refuses a non-image locally without uploading it", async () => {
    const fetchMock = stubFetch(() => {
      throw new Error("a refused type must not reach the server");
    });
    renderWithProviders(
      <FileField spaceId="s1" format="image" value={null} onChange={vi.fn()} />,
    );

    fireEvent.change(screen.getByLabelText("Upload image"), {
      target: {
        files: [new File(["notes"], "notes.pdf", { type: "application/pdf" })],
      },
    });

    expect(
      await screen.findByText("Choose a PNG, JPEG, WebP or GIF image."),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("removes the stored path and returns to the empty picker", () => {
    function Controlled() {
      const [value, setValue] = useState<string | null>("files/abc/notes.pdf");
      return (
        <FileField
          spaceId="s1"
          format="file"
          value={value}
          onChange={setValue}
        />
      );
    }

    renderWithProviders(<Controlled />);
    expect(screen.getByText("notes.pdf")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove file" }));

    expect(
      screen.getByRole("button", { name: "Choose file or drop it here" }),
    ).toBeInTheDocument();
  });

  it("opens the stored image and returns focus on Escape", async () => {
    renderWithProviders(
      <FileField
        spaceId="s1"
        format="image"
        value="files/abc/photo.png"
        onChange={vi.fn()}
      />,
    );
    const opener = screen.getByRole("button", { name: "Open image photo.png" });
    fireEvent.click(opener);

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(opener).toHaveFocus());
  });
});
