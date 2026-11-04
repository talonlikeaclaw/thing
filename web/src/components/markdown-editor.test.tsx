import { fireEvent, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

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

const plantTypes = [
  {
    key: "plant",
    name: "Plant",
    name_plural: "Plants",
    description: "",
    schedule: false,
    property_count: 0,
    object_count: 2,
  },
];

const emptySearch = { query: "", total: 0, results: [] };

/** The three reads the editor makes, plus an optional create refusal. */
function stubEditor({
  search = plantSearch,
  failure,
}: {
  search?: unknown;
  failure?: { status: number; message: string };
} = {}) {
  return stubFetch((input, init) => {
    const url = requestUrl(input);
    if (url.endsWith("/api/spaces/s1/types")) {
      return jsonResponse(plantTypes);
    }
    if (url.includes("/api/spaces/s1/search")) {
      return jsonResponse(search);
    }
    if (url.endsWith("/api/spaces/s1/objects") && init?.method === "POST") {
      if (failure) {
        return jsonResponse(
          { error: { code: "conflict", message: failure.message } },
          failure.status,
        );
      }
      return jsonResponse({ id: "created" });
    }
    throw new Error(`unstubbed ${url}`);
  });
}

function EditorHost({
  initial = "",
  dirty,
  onSave,
}: {
  initial?: string;
  dirty?: boolean;
  onSave?: () => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <MarkdownEditor
        value={value}
        onChange={setValue}
        disabled={false}
        spaceId="s1"
        resetToken={0}
        dirty={dirty}
        onSave={onSave}
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
    stubEditor();
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
    stubEditor();
    renderWithProviders(<EditorHost />);

    type("two / three", 6);

    expect(screen.queryByText("Formatting commands")).not.toBeInTheDocument();
    expect(screen.queryByRole("listbox", { name: "Commands" })).not.toBeInTheDocument();
  });

  it("searches records from [[ and inserts the chosen link at the caret", async () => {
    stubFetch((input) => {
      const url = requestUrl(input);
      if (url.endsWith("/api/spaces/s1/types")) {
        return jsonResponse(plantTypes);
      }
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
    stubEditor();
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
    stubEditor();
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

  it("applies each heading level from the toolbar menu", () => {
    stubEditor();
    renderWithProviders(<EditorHost />);

    type("Garden notes");
    for (const level of [1, 2, 3]) {
      fireEvent.click(screen.getByRole("button", { name: "Heading" }));
      fireEvent.click(screen.getByText(`Heading ${level}`));
      expect(field().value).toBe(`${"#".repeat(level)} Garden notes`);
    }

    // Applying the level already on the line turns the heading back into prose.
    fireEvent.click(screen.getByRole("button", { name: "Heading" }));
    fireEvent.click(screen.getByText("Heading 3"));
    expect(field().value).toBe("Garden notes");
    expect(document.activeElement).toBe(field());
  });

  it("turns one pasted URL over a selection into a link", () => {
    stubEditor();
    renderWithProviders(<EditorHost />);

    type("selected");
    field().setSelectionRange(0, 8);
    fireEvent.paste(field(), {
      clipboardData: {
        getData: () => "https://example.com/wiki/Function_(math)",
      },
    });

    expect(field().value).toBe(
      "[selected](https://example.com/wiki/Function_(math))",
    );
    expect(field().selectionStart).toBe(1);
    expect(field().selectionEnd).toBe(9);
  });

  it("leaves a paste alone without a selection", () => {
    stubEditor();
    renderWithProviders(<EditorHost />);

    type("selected");
    field().setSelectionRange(4, 4);
    fireEvent.paste(field(), {
      clipboardData: { getData: () => "https://example.com" },
    });

    expect(field().value).toBe("selected");
  });

  it("enters Write at the end when preview prose is tapped", () => {
    stubEditor();
    renderWithProviders(<EditorHost initial={"First line\nSecond line"} />);

    expect(screen.getByRole("button", { name: "preview" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(screen.getByTestId("preview"));

    expect(screen.getByRole("button", { name: "write" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(field().selectionStart).toBe(field().value.length);
  });

  it("keeps preview navigation when a link is tapped", () => {
    stubEditor();
    function LinkHost() {
      const [value] = useState("prose");
      return (
        <MarkdownEditor
          value={value}
          onChange={() => undefined}
          disabled={false}
          spaceId="s1"
          resetToken={0}
          preview={() => (
            <div data-testid="preview">
              <a href="#record">Monstera</a>
            </div>
          )}
        />
      );
    }
    renderWithProviders(<LinkHost />);

    fireEvent.click(screen.getByRole("link", { name: "Monstera" }));

    expect(screen.getByRole("button", { name: "preview" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("offers Create for a qualified new title and inserts the link", async () => {
    const fetchMock = stubEditor({ search: emptySearch });
    renderWithProviders(<EditorHost />);

    type("[[plant/New fern");
    const row = await screen.findByRole("option", { name: /Create “New fern”/ });
    expect(row).toBeInTheDocument();

    fireEvent.keyDown(field(), { key: "Enter" });

    await waitFor(() => {
      expect(field().value).toBe("[[plant/New fern]]");
    });
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(post).toBeDefined();
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      type: "plant",
      title: "New fern",
    });
  });

  it("shows a create failure in the menu and leaves the text alone", async () => {
    stubEditor({
      search: emptySearch,
      failure: { status: 409, message: "A record titled New fern already exists." },
    });
    renderWithProviders(<EditorHost />);

    type("[[plant/New fern");
    await screen.findByRole("option", { name: /Create “New fern”/ });
    fireEvent.keyDown(field(), { key: "Enter" });

    expect(await screen.findByRole("alert")).toHaveTextContent("A record titled New fern already exists.");
    expect(field().value).toBe("[[plant/New fern");
    expect(screen.getByRole("listbox", { name: "Records" })).toBeInTheDocument();
  });


  it("keeps Create off a title that already resolves", async () => {
    stubEditor({
      search: {
        query: "New fern",
        total: 1,
        results: [
          {
            id: "o9",
            type: "plant",
            type_name: "Plant",
            title: "New fern",
            updated_at: "2026-11-01T12:00:00Z",
            score: 9,
          },
        ],
      },
    });
    renderWithProviders(<EditorHost />);

    type("[[plant/New fern");
    await screen.findByRole("option", { name: /New fernPlant/ });
    expect(screen.queryByRole("option", { name: /Create/ })).not.toBeInTheDocument();
  });

  it("never offers Create without a live type or a title", async () => {
    stubEditor({ search: emptySearch });
    renderWithProviders(<EditorHost />);

    type("[[New fern");
    await waitFor(() => {
      expect(screen.getByText("No records match.")).toBeInTheDocument();
    });
    expect(screen.queryByRole("option", { name: /Create/ })).not.toBeInTheDocument();

    type("[[nope/New fern");
    await waitFor(() => {
      expect(screen.getByText("No records match.")).toBeInTheDocument();
    });
    expect(screen.queryByRole("option", { name: /Create/ })).not.toBeInTheDocument();
  });
});

describe("MarkdownEditor on a coarse pointer", () => {
  it("marks the page as writing in Write and clears the mark in Preview", async () => {
    const media = vi.spyOn(window, "matchMedia").mockImplementation(
      (query: string) =>
        ({
          matches: query === "(pointer: coarse)",
          media: query,
          onchange: null,
          addListener: () => undefined,
          removeListener: () => undefined,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
          dispatchEvent: () => false,
        }) as MediaQueryList,
    );
    stubEditor();
    renderWithProviders(<EditorHost initial={"Watered this week."} />);

    fireEvent.click(screen.getByRole("button", { name: /write/i }));
    await waitFor(() => expect(document.documentElement.dataset.writing).toBe("on"));

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(document.documentElement.dataset.writing).toBeUndefined());

    media.mockRestore();
  });

  it("saves from the writing surface's own Save", async () => {
    const media = vi.spyOn(window, "matchMedia").mockImplementation(
      (query: string) =>
        ({
          matches: query === "(pointer: coarse)",
          media: query,
          onchange: null,
          addListener: () => undefined,
          removeListener: () => undefined,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
          dispatchEvent: () => false,
        }) as MediaQueryList,
    );
    const onSave = vi.fn();
    stubEditor();
    renderWithProviders(
      <EditorHost initial={"Watered this week."} dirty onSave={onSave} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /write/i }));
    const save = await screen.findByRole("button", { name: "Save" });
    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();

    media.mockRestore();
  });
});
