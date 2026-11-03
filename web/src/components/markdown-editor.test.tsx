import { fireEvent, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { MarkdownEditor } from "@/components/markdown-editor";
import { jsonResponse, renderWithProviders, requestUrl, stubFetch } from "@/test/harness";

const plantSearch = {
  query: "pla",
  total: 2,
  results: [
    {
      id: "o1",
      type: "plant",
      type_name: "Plant",
      title: "Monstera in the study",
      updated_at: "2026-11-01T12:00:00Z",
      score: 9,
    },
    {
      id: "o2",
      type: "plant",
      type_name: "Plant",
      title: "Fiddle-leaf fig",
      updated_at: "2026-11-01T11:00:00Z",
      score: 7,
    },
  ],
};

function EditorHost({ initial = "" }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <MarkdownEditor
        value={value}
        onChange={setValue}
        disabled={false}
        spaceId="s1"
        resetToken={0}
        preview={(text) => <div data-testid="preview">{text}</div>}
      />
      <output data-testid="body">{value}</output>
    </>
  );
}

function field(): HTMLTextAreaElement {
  return screen.getByLabelText<HTMLTextAreaElement>("Markdown body");
}

/** Type into the real controlled textarea, with the caret where a writer's would be. */
function type(value: string, caret = value.length) {
  fireEvent.change(field(), {
    target: { value, selectionStart: caret, selectionEnd: caret },
  });
}

describe("MarkdownEditor", () => {
  it("opens the slash menu only at a line start and applies the chosen command", () => {
    stubFetch(() => jsonResponse({ query: "", total: 0, results: [] }));
    renderWithProviders(<EditorHost />);

    type("/");
    expect(screen.getByText("Formatting commands")).toBeInTheDocument();
    expect(screen.getByRole("listbox", { name: "Commands" })).toBeInTheDocument();

    type("/quo");
    expect(screen.getByRole("option", { name: /Quote/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Bulleted list/ })).not.toBeInTheDocument();

    fireEvent.keyDown(field(), { key: "Enter" });

    expect(field().value).toBe("> ");
    expect(screen.queryByText("Formatting commands")).not.toBeInTheDocument();
    expect(screen.getByTestId("body").textContent).toBe("> ");
  });

  it("leaves a slash in the middle of a line as prose", () => {
    stubFetch(() => jsonResponse({ query: "", total: 0, results: [] }));
    renderWithProviders(<EditorHost />);

    type("two / three", 6);

    expect(screen.queryByText("Formatting commands")).not.toBeInTheDocument();
    expect(screen.queryByRole("listbox", { name: "Commands" })).not.toBeInTheDocument();
  });

  it("searches records from [[ and inserts the chosen link at the caret", async () => {
    stubFetch((input) => {
      const url = requestUrl(input);
      expect(url).toContain("/api/spaces/s1/search");
      expect(url).toContain("q=pla");
      return jsonResponse(plantSearch);
    });
    renderWithProviders(<EditorHost />);

    type("[[");
    expect(screen.getByText("Type to find a record.")).toBeInTheDocument();

    type("[[pla");
    const monstera = await screen.findByRole("option", { name: /Monstera in the study/ });
    expect(monstera).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Fiddle-leaf fig/ })).toBeInTheDocument();

    fireEvent.keyDown(field(), { key: "ArrowDown" });
    fireEvent.keyDown(field(), { key: "Enter" });

    await waitFor(() => {
      expect(field().value).toBe("[[plant/Fiddle-leaf fig]]");
    });
    expect(field().selectionStart).toBe(field().value.length);
    expect(field().selectionEnd).toBe(field().value.length);
    expect(screen.queryByRole("listbox", { name: "Records" })).not.toBeInTheDocument();
  });

  it("continues a list on Enter, exits an empty item, and indents with Tab", () => {
    stubFetch(() => jsonResponse({ query: "", total: 0, results: [] }));
    renderWithProviders(<EditorHost />);

    type("- item");
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(field().value).toBe("- item\n- ");

    fireEvent.keyDown(field(), { key: "Enter" });
    expect(field().value).toBe("- item\n");

    type("item");
    fireEvent.keyDown(field(), { key: "Tab" });
    expect(field().value).toBe("item  ");

    fireEvent.keyDown(field(), { key: "Tab", shiftKey: true });
    expect(field().value).toBe("item");
  });

  it("wraps the selection from the toolbar without taking focus from the field", () => {
    stubFetch(() => jsonResponse({ query: "", total: 0, results: [] }));
    renderWithProviders(<EditorHost />);

    type("milk");
    field().setSelectionRange(0, 4);

    const bold = screen.getByRole("button", { name: "Bold" });
    // A prevented mousedown is what keeps the textarea's selection alive.
    expect(fireEvent.mouseDown(bold)).toBe(false);
    fireEvent.click(bold);

    expect(field().value).toBe("**milk**");
    expect(field().selectionStart).toBe(2);
    expect(field().selectionEnd).toBe(6);
  });

  it("toggles the heading prefix from the toolbar", () => {
    stubFetch(() => jsonResponse({ query: "", total: 0, results: [] }));
    renderWithProviders(<EditorHost />);

    type("Garden notes");
    fireEvent.click(screen.getByRole("button", { name: "Heading" }));

    expect(field().value).toBe("## Garden notes");
  });
});
