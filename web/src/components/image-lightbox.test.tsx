import { fireEvent, screen, waitFor } from "@testing-library/react";
import { useRef, useState } from "react";
import { describe, expect, it } from "vitest";

import {
  ImageLightbox,
  type LightboxImage,
} from "@/components/image-lightbox";
import { renderWithProviders } from "@/test/harness";

const IMAGES: LightboxImage[] = [
  { path: "files/a/one.png", title: "Monstera" },
  { path: "files/b/two.jpg" },
  { path: "files/c/three.webp", title: "Fiddle leaf" },
  { path: "files/d/four.gif", title: "Pothos" },
];

function Controlled({
  images = IMAGES,
  onClose = () => {},
}: {
  images?: LightboxImage[];
  onClose?: () => void;
}) {
  const [index, setIndex] = useState(0);
  return (
    <ImageLightbox
      spaceId="s1"
      images={images}
      index={index}
      onIndexChange={setIndex}
      onClose={onClose}
    />
  );
}

describe("ImageLightbox", () => {
  it("steps through the set with the buttons and wraps around", () => {
    renderWithProviders(<Controlled />);

    expect(screen.getByText("1 / 4")).toBeInTheDocument();
    expect(screen.getByText("Monstera")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next image" }));
    expect(screen.getByText("2 / 4")).toBeInTheDocument();
    // No title: the caption is the file name.
    expect(screen.getByText("two.jpg")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next image" }));
    expect(screen.getByText("3 / 4")).toBeInTheDocument();
    expect(screen.getByText("Fiddle leaf")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Previous image" }));
    expect(screen.getByText("2 / 4")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Previous image" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous image" }));
    expect(screen.getByText("4 / 4")).toBeInTheDocument();
    expect(screen.getByText("Pothos")).toBeInTheDocument();
  });

  it("steps through the set with the arrow keys", () => {
    renderWithProviders(<Controlled />);

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByText("2 / 4")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByText("4 / 4")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByText("1 / 4")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(screen.getByText("4 / 4")).toBeInTheDocument();
  });

  it("renders no controls for a single image", () => {
    renderWithProviders(<Controlled images={IMAGES.slice(0, 1)} />);

    expect(screen.getByText("Monstera")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Next image" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Previous image" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("1 / 1")).not.toBeInTheDocument();
  });

  it("closes on Escape and returns focus to the opener", async () => {
    function Opener() {
      const [open, setOpen] = useState(false);
      const opener = useRef<HTMLButtonElement | null>(null);
      return (
        <>
          <button
            ref={opener}
            type="button"
            onClick={() => setOpen(true)}
          >
            Open image
          </button>
          {open ? (
            <Controlled onClose={() => setOpen(false)} />
          ) : null}
        </>
      );
    }

    renderWithProviders(<Opener />);
    const button = screen.getByRole("button", { name: "Open image" });
    button.focus();
    fireEvent.click(button);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(button).toHaveFocus());
  });
});
