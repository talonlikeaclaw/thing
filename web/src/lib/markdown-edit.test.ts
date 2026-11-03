import { describe, expect, it } from "vitest";

import {
  applySlashCommand,
  continueList,
  indentSelection,
  insertFencedBlock,
  insertLink,
  insertWikiLink,
  isInFence,
  matchSlash,
  pasteLink,
  SLASH_COMMANDS,
  slashTrigger,
  toggleLinePrefix,
  toggleNumberedList,
  wikiTrigger,
  wrapSelection,
} from "@/lib/markdown-edit";

function command(id: string) {
  const found = SLASH_COMMANDS.find((entry) => entry.id === id);
  if (!found) {
    throw new Error(`no command ${id}`);
  }
  return found;
}

describe("wrapSelection", () => {
  it("inserts a selected placeholder when the selection is collapsed", () => {
    expect(wrapSelection("", 0, 0, "**", "bold")).toEqual({
      value: "**bold**",
      start: 2,
      end: 6,
    });
  });

  it("wraps a ranged selection and keeps it selected", () => {
    expect(wrapSelection("water the plants", 0, 5, "**", "bold")).toEqual({
      value: "**water** the plants",
      start: 2,
      end: 7,
    });
  });

  it("unwraps text that already carries the same marker", () => {
    expect(wrapSelection("**water** the plants", 0, 9, "**", "bold")).toEqual({
      value: "water the plants",
      start: 0,
      end: 5,
    });
  });
});

describe("toggleLinePrefix", () => {
  it("prefixes every selected line after its indentation", () => {
    expect(toggleLinePrefix("one\n  two", 0, 8, "- ")).toEqual({
      value: "- one\n  - two",
      start: 0,
      end: 12,
    });
  });

  it("removes the prefix when every non-empty line already carries it", () => {
    expect(toggleLinePrefix("- one\n- two", 0, 11, "- ")).toEqual({
      value: "one\ntwo",
      start: 0,
      end: 7,
    });
  });

  it("skips blank lines and keeps their indentation", () => {
    expect(toggleLinePrefix("one\n\n  two", 0, 10, "> ")).toEqual({
      value: "> one\n\n  > two",
      start: 0,
      end: 14,
    });
  });

  it("replaces another heading level instead of stacking markers", () => {
    expect(toggleLinePrefix("## Title", 0, 0, "# ")).toEqual({
      value: "# Title",
      start: 2,
      end: 2,
    });
  });

  it("replaces a heading of another level and removes the same level", () => {
    expect(toggleLinePrefix("### Title", 2, 2, "## ")).toEqual({
      value: "## Title",
      start: 3,
      end: 3,
    });
    expect(toggleLinePrefix("## Title", 0, 0, "## ")).toEqual({
      value: "Title",
      start: 0,
      end: 0,
    });
  });
});

describe("toggleNumberedList", () => {
  it("numbers the selected lines in order", () => {
    expect(toggleNumberedList("water\nmow", 0, 9)).toEqual({
      value: "1. water\n2. mow",
      start: 0,
      end: 15,
    });
  });

  it("removes the markers when every line is already numbered", () => {
    expect(toggleNumberedList("1. water\n2. mow", 0, 15)).toEqual({
      value: "water\nmow",
      start: 0,
      end: 9,
    });
  });

  it("numbers only the lines that have text", () => {
    expect(toggleNumberedList("water\n\nmow", 0, 10)).toEqual({
      value: "1. water\n\n2. mow",
      start: 0,
      end: 16,
    });
  });
});

describe("continueList", () => {
  it("starts the next bullet at the same indentation", () => {
    expect(continueList("- water", 7, 7)).toEqual({
      value: "- water\n- ",
      start: 10,
      end: 10,
    });
  });

  it("increments an ordered item", () => {
    expect(continueList("  2. water", 10, 10)).toEqual({
      value: "  2. water\n  3. ",
      start: 16,
      end: 16,
    });
  });

  it("keeps a quote going", () => {
    expect(continueList("> water", 7, 7)).toEqual({
      value: "> water\n> ",
      start: 10,
      end: 10,
    });
  });

  it("removes the marker on an empty item", () => {
    expect(continueList("- ", 2, 2)).toEqual({ value: "", start: 0, end: 0 });
  });

  it("does nothing outside a list or away from the end of the line", () => {
    expect(continueList("plain text", 10, 10)).toBeNull();
    expect(continueList("- water", 3, 3)).toBeNull();
    expect(continueList("- water", 3, 5)).toBeNull();
  });
});

describe("indentSelection", () => {
  it("indents every selected line by two spaces", () => {
    expect(indentSelection("- one\n- two", 0, 11, 1)).toEqual({
      value: "  - one\n  - two",
      start: 0,
      end: 15,
    });
  });

  it("outdents by at most two spaces", () => {
    expect(indentSelection("   - one\n - two", 0, 15, -1)).toEqual({
      value: " - one\n- two",
      start: 0,
      end: 12,
    });
  });

  it("inserts and removes spaces at a collapsed caret", () => {
    expect(indentSelection("ab", 2, 2, 1)).toEqual({ value: "ab  ", start: 4, end: 4 });
    expect(indentSelection("ab  ", 4, 4, -1)).toEqual({ value: "ab", start: 2, end: 2 });
  });
});

describe("pasteLink", () => {
  it("wraps a selection in the pasted URL and keeps the link text selected", () => {
    expect(pasteLink("see selected here", 4, 12, "https://example.com/plants")).toEqual({
      value: "see [selected](https://example.com/plants) here",
      start: 5,
      end: 13,
    });
  });

  it("keeps a URL with balanced parentheses intact", () => {
    const url = "https://example.com/wiki/Function_(math)";
    expect(pasteLink("see here", 4, 8, url)).toEqual({
      value: `see [here](${url})`,
      start: 5,
      end: 9,
    });
  });

  it("angle-brackets a URL whose parentheses do not balance", () => {
    expect(pasteLink("x", 0, 1, "https://example.com/a_(b")).toEqual({
      value: "[x](<https://example.com/a_(b>)",
      start: 1,
      end: 2,
    });
  });

  it("leaves ordinary pastes and collapsed selections alone", () => {
    expect(pasteLink("", 0, 0, "https://example.com")).toBeNull();
    expect(pasteLink("see ", 4, 4, "https://example.com")).toBeNull();
    expect(pasteLink("see here", 4, 8, "plain text")).toBeNull();
    expect(pasteLink("see here", 4, 8, "two\nlines")).toBeNull();
    expect(pasteLink("see here", 4, 8, "ftp://example.com")).toBeNull();
  });
});

describe("insertLink", () => {
  it("selects the text placeholder when nothing is selected", () => {
    expect(insertLink("see ", 4, 4)).toEqual({
      value: "see [text](url)",
      start: 5,
      end: 9,
    });
  });

  it("wraps a selection and selects the url", () => {
    expect(insertLink("water now", 0, 5)).toEqual({
      value: "[water](url) now",
      start: 8,
      end: 11,
    });
  });
});

describe("insertFencedBlock", () => {
  it("puts the caret on its own line inside an empty block", () => {
    expect(insertFencedBlock("", 0, 0)).toEqual({
      value: "```\n\n```",
      start: 4,
      end: 4,
    });
  });

  it("adds the newlines a mid-line block needs", () => {
    expect(insertFencedBlock("before after", 7, 7)).toEqual({
      value: "before \n```\n\n```\nafter",
      start: 12,
      end: 12,
    });
  });

  it("wraps a selection without touching its text", () => {
    expect(insertFencedBlock("water the plants", 0, 5)).toEqual({
      value: "```\nwater\n```\n the plants",
      start: 4,
      end: 9,
    });
  });
});

describe("insertWikiLink", () => {
  it("opens the brackets when there is no target yet", () => {
    expect(insertWikiLink("see ", 4, 4, "")).toEqual({
      value: "see [[",
      start: 6,
      end: 6,
    });
  });

  it("inserts the raw target and leaves the caret after it", () => {
    expect(insertWikiLink("see ", 4, 8, "plant/Monstera")).toEqual({
      value: "see [[plant/Monstera]]",
      start: 22,
      end: 22,
    });
  });
});

describe("slashTrigger", () => {
  it("fires at the start of the body and after short indentation", () => {
    expect(slashTrigger("/qu", 3)).toEqual({ start: 0, query: "qu" });
    expect(slashTrigger("  /quo", 6)).toEqual({ start: 2, query: "quo" });
  });

  it("stays silent after prose, a list marker or deep indentation", () => {
    expect(slashTrigger("2/3", 3)).toBeNull();
    expect(slashTrigger("- /quote", 9)).toBeNull();
    expect(slashTrigger("    /quote", 10)).toBeNull();
    expect(slashTrigger("\\/quote", 7)).toBeNull();
  });

  it("stops at the grammar's length limit", () => {
    expect(slashTrigger(`/${"a".repeat(20)}`, 21)).not.toBeNull();
    expect(slashTrigger(`/${"a".repeat(21)}`, 22)).toBeNull();
  });

  it("is silent inside a fenced code block and fires again after it", () => {
    const fenced = "```\n/qu\n```\n";
    expect(slashTrigger(fenced, 7)).toBeNull();
    expect(slashTrigger(`${fenced}/qu`, fenced.length + 3)).toEqual({
      start: fenced.length,
      query: "qu",
    });
  });

  it("recognises the trigger on a line of its own", () => {
    expect(slashTrigger("text\n/qu", 8)).toEqual({ start: 5, query: "qu" });
  });
});

describe("isInFence", () => {
  it("counts fence tokens above the offset", () => {
    expect(isInFence("```\ncode\n```\nafter", 5)).toBe(true);
    expect(isInFence("```\ncode\n```\nafter", 19)).toBe(false);
    expect(isInFence("text", 4)).toBe(false);
    expect(isInFence("~~~\nx\n~~~", 6)).toBe(true);
  });
});

describe("matchSlash", () => {
  it("lists every command for an empty query", () => {
    expect(matchSlash("")).toHaveLength(SLASH_COMMANDS.length);
  });

  it("puts prefix matches before substring matches", () => {
    expect(matchSlash("q").map((entry) => entry.id)).toEqual(["quote"]);
    expect(matchSlash("num").map((entry) => entry.id)).toEqual(["number"]);
    expect(matchSlash("b").map((entry) => entry.id)).toEqual(["bullet", "block", "bold", "number"]);
  });

  it("matches nothing for an unknown query", () => {
    expect(matchSlash("zzz")).toEqual([]);
  });
});

describe("applySlashCommand", () => {
  it("turns the trigger line into a quote, heading or list", () => {
    expect(applySlashCommand("/quote", 6, { start: 0, query: "quote" }, command("quote"))).toEqual({
      value: "> ",
      start: 2,
      end: 2,
    });
    expect(applySlashCommand("/h2", 3, { start: 0, query: "h2" }, command("h2"))).toEqual({
      value: "## ",
      start: 3,
      end: 3,
    });
    expect(applySlashCommand("/number", 7, { start: 0, query: "number" }, command("number"))).toEqual({
      value: "1. ",
      start: 3,
      end: 3,
    });
  });

  it("inserts a selected placeholder for an inline command", () => {
    expect(applySlashCommand("/b", 2, { start: 0, query: "b" }, command("bold"))).toEqual({
      value: "**bold**",
      start: 2,
      end: 6,
    });
  });

  it("opens a wiki link for the wiki command", () => {
    expect(applySlashCommand("/wiki", 5, { start: 0, query: "wiki" }, command("wiki"))).toEqual({
      value: "[[",
      start: 2,
      end: 2,
    });
  });

  it("keeps the rest of the line after the trigger", () => {
    expect(
      applySlashCommand("/h1 Title", 3, { start: 0, query: "h1" }, command("h1")),
    ).toEqual({ value: "# Title", start: 2, end: 2 });
  });
});

describe("wikiTrigger", () => {
  it("opens on a partial target and reports where the bracket starts", () => {
    expect(wikiTrigger("See [[mon", 9)).toEqual({ start: 4, query: "mon" });
  });

  it("closes when the brackets cannot be a target anymore", () => {
    expect(wikiTrigger("See [[mon]", 10)).toBeNull();
    expect(wikiTrigger("See [[plant/Monstera]] and", 24)).toBeNull();
  });

  it("ignores an escaped bracket and works on the caret's own line", () => {
    expect(wikiTrigger("not \\[[mon", 10)).toBeNull();
    expect(wikiTrigger("a\n[[mon", 7)).toEqual({ start: 2, query: "mon" });
  });
});
