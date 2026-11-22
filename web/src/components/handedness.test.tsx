import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HandednessProvider, ThumbRow } from "@/components/handedness";

afterEach(cleanup);

/** Answer the one media question the thumb reader asks. */
function stubMedia(wide: boolean) {
  return vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        matches: wide && query === "(min-width: 64rem)",
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

/** The row's own element, so the assertions read the rendered DOM order. */
function renderRow(handedness: "left" | "right"): HTMLElement {
  render(
    <HandednessProvider value={{ handedness, setHandedness: () => undefined }}>
      <ThumbRow>
        <span>secondary</span>
        <button type="button">primary</button>
      </ThumbRow>
    </HandednessProvider>,
  );
  return screen.getByText("secondary").parentElement as HTMLElement;
}

describe("ThumbRow", () => {
  it("reverses the DOM children and leads with the primary on a left-handed phone", () => {
    stubMedia(false);
    const row = renderRow("left");
    expect(row).toHaveAttribute("data-thumb-row", "left");
    expect(row.className).toContain("justify-start");
    expect(row.textContent).toBe("primarysecondary");
  });

  it("keeps the canonical order with the primary at the trailing edge in right-handed mode", () => {
    stubMedia(false);
    const row = renderRow("right");
    expect(row).toHaveAttribute("data-thumb-row", "right");
    expect(row.className).toContain("justify-end");
    expect(row.textContent).toBe("secondaryprimary");
  });

  it("stays canonical from the desktop shell up, whatever the preference", () => {
    stubMedia(true);
    const row = renderRow("left");
    expect(row).toHaveAttribute("data-thumb-row", "right");
    expect(row.textContent).toBe("secondaryprimary");
  });
});
