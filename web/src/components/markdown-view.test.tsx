import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MarkdownView } from "@/components/markdown-view";
import { renderWithProviders } from "@/test/harness";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MarkdownView highlight", () => {
  it("marks every occurrence of the query, case-insensitively", () => {
    const { container } = renderWithProviders(
      <MarkdownView text={"The unfurling leaf.\n\nMore UNFURLING later."} highlight="unfurling" />,
    );

    const marks = [...container.querySelectorAll("mark")];
    expect(marks).toHaveLength(2);
    expect(marks.map((mark) => mark.textContent)).toEqual(["unfurling", "UNFURLING"]);
  });

  it("leaves inline and fenced code alone", () => {
    const text = [
      "The unfurling leaf.",
      "",
      "Inline `unfurling` stays code.",
      "",
      "```",
      "unfurling",
      "```",
    ].join("\n");
    const { container } = renderWithProviders(<MarkdownView text={text} highlight="unfurling" />);

    const marks = [...container.querySelectorAll("mark")];
    expect(marks).toHaveLength(1);
    expect(marks[0]?.textContent).toBe("unfurling");
    expect(container.querySelector("code")?.textContent).toBe("unfurling");
  });

  it("marks nothing without a query", () => {
    const { container } = renderWithProviders(<MarkdownView text="The unfurling leaf." />);
    expect(container.querySelectorAll("mark")).toHaveLength(0);
  });

  it("centres the first mark once and does not fight a later scroll", () => {
    const scroll = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
    const { rerender } = renderWithProviders(
      <MarkdownView text="The unfurling leaf." highlight="unfurling" />,
    );

    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll).toHaveBeenCalledWith({ block: "center", behavior: "smooth" });

    rerender(<MarkdownView text="The unfurling leaf." highlight="unfurling" />);
    expect(scroll).toHaveBeenCalledTimes(1);

    rerender(<MarkdownView text="The unfurling leaf." highlight="leaf" />);
    expect(scroll).toHaveBeenCalledTimes(2);
  });

  it("scrolls instantly when motion is reduced", () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: true,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    } as MediaQueryList);
    const scroll = vi.spyOn(HTMLElement.prototype, "scrollIntoView");

    renderWithProviders(<MarkdownView text="The unfurling leaf." highlight="unfurling" />);

    expect(scroll).toHaveBeenCalledWith({ block: "center", behavior: "auto" });
  });

  it("keeps the body readable when the query has no occurrence", () => {
    const scroll = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
    renderWithProviders(<MarkdownView text="The unfurling leaf." highlight="orchid" />);

    expect(screen.getByText("The unfurling leaf.")).toBeInTheDocument();
    expect(scroll).not.toHaveBeenCalled();
  });
});
