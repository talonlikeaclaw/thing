import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AccentPicker } from "@/components/accent-picker";

afterEach(cleanup);

function renderPicker(overrides: Partial<Parameters<typeof AccentPicker>[0]> = {}) {
  const onChange = vi.fn();
  render(
    <AccentPicker
      value="lichen"
      onChange={onChange}
      labelledBy="appearance"
      {...overrides}
    />,
  );
  return { onChange, radios: screen.getAllByRole("radio") };
}

describe("AccentPicker", () => {
  it("draws every option from its own accent tokens", () => {
    const { radios } = renderPicker();

    expect(radios).toHaveLength(6);
    expect(radios.map((radio) => radio.textContent)).toEqual([
      "Lichen",
      "Yellow",
      "Orange",
      "Cyan",
      "Green",
      "Pink",
    ]);
    for (const radio of radios) {
      const preview = radio.querySelector("[data-accent]");
      expect(preview?.getAttribute("data-accent")).toBe(
        radio.textContent?.toLowerCase(),
      );
    }
  });

  it("keeps the selected option as the only tab stop", () => {
    const { radios } = renderPicker({ value: "cyan" });

    expect(radios.map((radio) => radio.tabIndex)).toEqual([-1, -1, -1, 0, -1, -1]);
    expect(radios[3]?.getAttribute("aria-checked")).toBe("true");
  });

  it("moves and selects with the arrow keys", () => {
    const { onChange, radios } = renderPicker();

    fireEvent.keyDown(radios[0] as HTMLElement, { key: "ArrowRight" });

    expect(onChange).toHaveBeenCalledWith("yellow");
    expect(document.activeElement).toBe(radios[1]);
  });

  it("neither fires nor tabs when the shared preset is read-only", () => {
    const { onChange, radios } = renderPicker({ disabled: true });

    for (const radio of radios) {
      expect(radio).toBeDisabled();
      expect(radio.tabIndex).toBe(-1);
    }
    fireEvent.click(radios[2] as HTMLElement);
    expect(onChange).not.toHaveBeenCalled();
  });
});
