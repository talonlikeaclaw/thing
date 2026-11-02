import { describe, expect, it } from "vitest";

import type { ObjectLink } from "@/api/types";
import { splitWikiText, wikiLinks, type WikiNode } from "@/lib/wiki-links";

const space = "space-1";
const monstera: ObjectLink = {
  raw: "plant/Monstera",
  type: "plant",
  title: "Monstera",
  status: "ok",
  id: "object-1",
};

function byRaw(...links: ObjectLink[]): ReadonlyMap<string, ObjectLink> {
  return new Map(links.map((link) => [link.raw, link]));
}

describe("splitWikiText", () => {
  it("turns a resolved link into an in-app href", () => {
    expect(splitWikiText("See [[plant/Monstera]] today.", byRaw(monstera), space)).toEqual([
      { kind: "text", text: "See " },
      { kind: "link", label: "Monstera", href: "/s/space-1/o/object-1" },
      { kind: "text", text: " today." },
    ]);
  });

  it("marks an unknown or ambiguous link as broken", () => {
    const links = byRaw(
      { raw: "plant/Ghost", type: "plant", title: "Ghost", status: "unknown" },
      { raw: "plant/Twin", type: "plant", title: "Twin", status: "ambiguous" },
    );
    expect(splitWikiText("[[plant/Ghost]] and [[plant/Twin]]", links, space)).toEqual([
      {
        kind: "broken",
        label: "Ghost",
        title: "No record matches plant/Ghost.",
      },
      { kind: "text", text: " and " },
      {
        kind: "broken",
        label: "Twin",
        title: "More than one record is titled Twin.",
      },
    ]);
  });

  it("renders a valid unsaved link as its title", () => {
    expect(splitWikiText("[[plant/New fern]]", byRaw(), space)).toEqual([
      { kind: "text", text: "New fern" },
    ]);
  });

  it("leaves invalid syntax, escapes and code-like text alone", () => {
    for (const text of [
      "[[Plant/Monstera]]",
      "[[plant]]",
      "[[plant/]]",
      "[[plant/Monstera",
      String.raw`\[[plant/Monstera]]`,
    ]) {
      expect(splitWikiText(text, byRaw(monstera), space)).toEqual([
        { kind: "text", text },
      ]);
    }
  });

  it("keeps text around several links in order", () => {
    const other: ObjectLink = {
      raw: "chore/Water",
      type: "chore",
      title: "Water",
      status: "ok",
      id: "object-2",
    };
    expect(
      splitWikiText("A [[plant/Monstera]] B [[chore/Water]] C", byRaw(monstera, other), space),
    ).toEqual([
      { kind: "text", text: "A " },
      { kind: "link", label: "Monstera", href: "/s/space-1/o/object-1" },
      { kind: "text", text: " B " },
      { kind: "link", label: "Water", href: "/s/space-1/o/object-2" },
      { kind: "text", text: " C" },
    ]);
  });
});

describe("wikiLinks", () => {
  it("replaces text nodes but never code", () => {
    const tree: WikiNode = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [
            { type: "text", value: "See [[plant/Monstera]]." },
            { type: "inlineCode", value: "[[plant/Monstera]]" },
          ],
        },
        {
          type: "code",
          value: "[[plant/Monstera]]",
          children: [{ type: "text", value: "[[plant/Monstera]]" }],
        },
      ],
    };

    wikiLinks(byRaw(monstera), space)()(tree);

    const paragraph = tree.children?.[0];
    expect(paragraph?.children?.map((child) => child.type)).toEqual([
      "text",
      "link",
      "text",
      "inlineCode",
    ]);
    expect(paragraph?.children?.[1]).toMatchObject({
      type: "link",
      url: "/s/space-1/o/object-1",
    });
    const code = tree.children?.[1];
    expect(code?.children?.[0]?.value).toBe("[[plant/Monstera]]");
  });

  it("uses a warning href for a broken link", () => {
    const tree: WikiNode = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [{ type: "text", value: "[[plant/Ghost]]" }],
        },
      ],
    };
    wikiLinks(
      byRaw({ raw: "plant/Ghost", type: "plant", title: "Ghost", status: "unknown" }),
      space,
    )()(tree);
    expect(tree.children?.[0]?.children?.[0]).toMatchObject({
      type: "link",
      url: "#broken",
      title: "No record matches plant/Ghost.",
    });
  });
});
