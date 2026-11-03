import { describe, expect, it } from "vitest";

import type { ObjectLink } from "@/api/types";
import {
  createSuggestion,
  rewriteMentions,
  splitWikiText,
  wikiLinks,
  type WikiNode,
} from "@/lib/wiki-links";

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

describe("createSuggestion", () => {
  const types = new Set(["plant", "chore"]);

  it("splits a live type from the new title", () => {
    expect(createSuggestion("plant/New fern", types)).toEqual({
      typeKey: "plant",
      title: "New fern",
    });
    expect(createSuggestion("  chore/ Water pots  ", types)).toEqual({
      typeKey: "chore",
      title: "Water pots",
    });
  });

  it("keeps a slash that belongs to the title", () => {
    expect(createSuggestion("plant/Fern / moss", types)).toEqual({
      typeKey: "plant",
      title: "Fern / moss",
    });
  });

  it("refuses a bare title, an unknown type or an empty title", () => {
    expect(createSuggestion("New fern", types)).toBeNull();
    expect(createSuggestion("nope/New fern", types)).toBeNull();
    expect(createSuggestion("plant/", types)).toBeNull();
    expect(createSuggestion("Plant/New fern", types)).toBeNull();
  });
});

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

describe("rewriteMentions", () => {
  const target = "object-1";
  const resolved = new Map([
    ["plant/Monstera", target],
    ["plant/monstera", target],
    ["chore/Water", "object-2"],
  ]);
  const resolve = (raw: string) => resolved.get(raw);

  it("rewrites duplicate mentions from the end, keeping surrounding text", () => {
    const body = "First [[plant/Monstera]], then [[plant/Monstera]] and [[chore/Water]].";
    expect(rewriteMentions(body, target, "plant", "Monstera", "Monstera deliciosa", resolve)).toEqual({
      body: "First [[plant/Monstera deliciosa]], then [[plant/Monstera deliciosa]] and [[chore/Water]].",
      count: 2,
    });
  });

  it("matches a title typed in another case and writes the canonical title", () => {
    expect(
      rewriteMentions(
        "See [[plant/monstera]].",
        target,
        "plant",
        "Monstera",
        "Monstera deliciosa",
        resolve,
      ),
    ).toEqual({ body: "See [[plant/Monstera deliciosa]].", count: 1 });
  });

  it("leaves a link alone when it no longer resolves to the target", () => {
    expect(
      rewriteMentions("See [[plant/Monstera]].", target, "plant", "Monstera", "New", () => undefined),
    ).toEqual({ body: "See [[plant/Monstera]].", count: 0 });
    expect(
      rewriteMentions("See [[plant/Monstera]].", target, "plant", "Monstera", "New", () => "other"),
    ).toEqual({ body: "See [[plant/Monstera]].", count: 0 });
  });

  it("skips fenced code and inline code", () => {
    const body = [
      "[[plant/Monstera]] in prose.",
      "`[[plant/Monstera]]` stays a code span.",
      "```md",
      "[[plant/Monstera]]",
      "```",
      "~~~",
      "[[plant/Monstera]]",
      "~~~",
    ].join("\n");
    expect(rewriteMentions(body, target, "plant", "Monstera", "Renamed", resolve)).toEqual({
      body: [
        "[[plant/Renamed]] in prose.",
        "`[[plant/Monstera]]` stays a code span.",
        "```md",
        "[[plant/Monstera]]",
        "```",
        "~~~",
        "[[plant/Monstera]]",
        "~~~",
      ].join("\n"),
      count: 1,
    });
  });

  it("rewrites every source independently", () => {
    const first = rewriteMentions(
      "[[plant/Monstera]]",
      target,
      "plant",
      "Monstera",
      "Renamed",
      resolve,
    );
    const second = rewriteMentions(
      "A word, [[plant/Monstera]], another word.",
      target,
      "plant",
      "Monstera",
      "Renamed",
      resolve,
    );
    expect(first).toEqual({ body: "[[plant/Renamed]]", count: 1 });
    expect(second).toEqual({ body: "A word, [[plant/Renamed]], another word.", count: 1 });
  });
});
