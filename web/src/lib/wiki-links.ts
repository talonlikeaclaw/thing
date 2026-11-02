import type { ObjectLink } from "@/api/types";

/** One piece of a text node after wiki-link syntax is separated out. */
export type WikiSegment =
  | { kind: "text"; text: string }
  | { kind: "link"; label: string; href: string }
  | { kind: "broken"; label: string; title: string };

/** The server's grammar for a type key; a link that does not match is text. */
const TYPE_KEY = /^[a-z][a-z0-9_]{0,39}$/;
const MAX_INNER = 200;

/**
 * Splits one text node into plain text, resolved links, and links that the
 * server says no longer resolve.
 *
 * `links` is keyed by the trimmed inner text the server returned. A syntactically
 * valid link absent from the map is neutral (it may be typed but not saved) and
 * renders as its title. Invalid syntax stays exactly as typed.
 */
export function splitWikiText(
  text: string,
  links: ReadonlyMap<string, ObjectLink>,
  spaceId: string,
): WikiSegment[] {
  const segments: WikiSegment[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const open = text.indexOf("[[", cursor);
    if (open === -1) {
      pushText(segments, text.slice(cursor));
      break;
    }
    if (isEscaped(text, open)) {
      pushText(segments, text.slice(cursor, open + 2));
      cursor = open + 2;
      continue;
    }
    const close = text.indexOf("]]", open + 2);
    if (close === -1) {
      pushText(segments, text.slice(cursor));
      break;
    }
    const parsed = parseInner(text.slice(open + 2, close));
    if (!parsed) {
      pushText(segments, text.slice(cursor, open + 2));
      cursor = open + 2;
      continue;
    }

    pushText(segments, text.slice(cursor, open));
    const link = links.get(parsed.raw);
    if (link?.status === "ok" && link.id) {
      segments.push({ kind: "link", label: link.title, href: `/s/${spaceId}/o/${link.id}` });
    } else if (link?.status === "unknown") {
      segments.push({
        kind: "broken",
        label: link.title,
        title: `No record matches ${link.type}/${link.title}.`,
      });
    } else if (link?.status === "ambiguous") {
      segments.push({
        kind: "broken",
        label: link.title,
        title: `More than one record is titled ${link.title}.`,
      });
    } else {
      segments.push({ kind: "text", text: parsed.title });
    }
    cursor = close + 2;
  }

  return segments;
}

interface ParsedInner {
  raw: string;
  title: string;
}

function parseInner(inner: string): ParsedInner | null {
  if (Array.from(inner).length > MAX_INNER) {
    return null;
  }
  const raw = inner.trim();
  const slash = raw.indexOf("/");
  if (slash <= 0) {
    return null;
  }
  const type = raw.slice(0, slash).trim();
  const title = raw.slice(slash + 1).trim();
  if (!TYPE_KEY.test(type) || title === "") {
    return null;
  }
  return { raw, title };
}

function isEscaped(text: string, at: number): boolean {
  let backslashes = 0;
  for (let index = at - 1; index >= 0 && text[index] === "\\"; index -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function pushText(segments: WikiSegment[], text: string) {
  if (text === "") {
    return;
  }
  const last = segments[segments.length - 1];
  if (last?.kind === "text") {
    last.text += text;
  } else {
    segments.push({ kind: "text", text });
  }
}

/** The minimal mdast shape the plugin walks; no dependency on the mdast types. */
export interface WikiNode {
  type?: string;
  value?: string;
  url?: string;
  title?: string;
  children?: WikiNode[];
}

const SKIP = new Set(["code", "inlineCode", "link", "image"]);

/**
 * A remark plugin that replaces `[[…]]` text with link nodes.
 *
 * Resolved links carry the in-app href; unresolved ones carry `#broken` and a
 * title, which `MarkdownView` renders as a warning instead of a navigation.
 * Code spans, fenced code, existing links and images are left alone.
 */
export function wikiLinks(
  links: ReadonlyMap<string, ObjectLink>,
  spaceId: string,
): () => (tree: unknown) => void {
  return () => (tree) => {
    walk(tree as WikiNode, links, spaceId);
  };
}

function walk(node: WikiNode, links: ReadonlyMap<string, ObjectLink>, spaceId: string) {
  if (!node.children) {
    return;
  }
  const next: WikiNode[] = [];
  for (const child of node.children) {
    if (child.type === "text" && typeof child.value === "string") {
      const segments = splitWikiText(child.value, links, spaceId);
      const only = segments.length === 1 ? segments[0] : undefined;
      const unchanged = only?.kind === "text" && only.text === child.value;
      if (unchanged) {
        next.push(child);
        continue;
      }
      for (const segment of segments) {
        if (segment.kind === "text") {
          next.push({ type: "text", value: segment.text });
        } else if (segment.kind === "link") {
          next.push({
            type: "link",
            url: segment.href,
            children: [{ type: "text", value: segment.label }],
          });
        } else {
          next.push({
            type: "link",
            url: "#broken",
            title: segment.title,
            children: [{ type: "text", value: segment.label }],
          });
        }
      }
      continue;
    }
    if (!SKIP.has(child.type ?? "")) {
      walk(child, links, spaceId);
    }
    next.push(child);
  }
  node.children = next;
}
