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
  type: string;
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
  return { raw, type, title };
}

/** One link occurrence with the body offsets the rewriter needs. */
export interface WikiOccurrence {
  start: number;
  end: number;
  raw: string;
  type: string;
  title: string;
}

/**
 * Every link occurrence in a body, in document order, duplicate occurrences
 * included. Fences and inline code are skipped exactly as the server's parser
 * skips them, so a code sample is never rewritten as an edge.
 */
export function wikiOccurrences(body: string): WikiOccurrence[] {
  const occurrences: WikiOccurrence[] = [];
  let fence: { marker: string; length: number } | null = null;
  let offset = 0;

  while (offset <= body.length) {
    const newline = body.indexOf("\n", offset);
    const end = newline === -1 ? body.length : newline + 1;
    const line = body.slice(offset, end);
    const trimmed = line.trimStart();

    if (fence) {
      if (isClosingFence(trimmed, fence.marker, fence.length)) {
        fence = null;
      }
    } else {
      const opened = openingFence(trimmed);
      if (opened) {
        fence = opened;
      } else {
        scanLine(line, offset, occurrences);
      }
    }

    if (newline === -1) {
      break;
    }
    offset = end;
  }

  return occurrences;
}

/** The start of the next run of exactly `run` backticks, if one closes the span. */
function closingBackticks(line: string, from: number, limit: number, run: number): number | null {
  let at = from;
  while (at < limit) {
    if (line[at] !== "`") {
      at += 1;
      continue;
    }
    const found = backtickRun(line, at, limit);
    if (found === run) {
      return at;
    }
    at += found;
  }
  return null;
}

function backtickRun(line: string, at: number, limit: number): number {
  let end = at;
  while (end < limit && line[end] === "`") {
    end += 1;
  }
  return end - at;
}

function closingBrackets(line: string, from: number, limit: number): number | null {
  let at = from;
  while (at + 1 < limit) {
    if (line[at] === "]" && line[at + 1] === "]") {
      return at;
    }
    at += 1;
  }
  return null;
}

function scanLine(line: string, offset: number, occurrences: WikiOccurrence[]) {
  const newline = line.indexOf("\n");
  const limit = newline === -1 ? line.length : newline;
  let at = 0;

  while (at < limit) {
    if (line[at] === "\\" && at + 2 < limit && line[at + 1] === "[" && line[at + 2] === "[") {
      at += 3;
      continue;
    }
    if (line[at] === "`") {
      const run = backtickRun(line, at, limit);
      const close = closingBackticks(line, at + run, limit, run);
      at = close === null ? at + run : close + run;
      continue;
    }
    if (line[at] === "[" && at + 1 < limit && line[at + 1] === "[") {
      const close = closingBrackets(line, at + 2, limit);
      if (close !== null) {
        const parsed = parseInner(line.slice(at + 2, close));
        if (parsed) {
          occurrences.push({
            start: offset + at,
            end: offset + close + 2,
            raw: parsed.raw,
            type: parsed.type,
            title: parsed.title,
          });
        }
        at = close + 2;
        continue;
      }
    }
    at += 1;
  }
}

/** A fence opener: at least three backticks or tildes after optional indentation. */
function openingFence(trimmed: string): { marker: string; length: number } | null {
  const marker = trimmed[0];
  if (marker !== "`" && marker !== "~") {
    return null;
  }
  let length = 0;
  while (trimmed[length] === marker) {
    length += 1;
  }
  return length >= 3 ? { marker, length } : null;
}

function isClosingFence(trimmed: string, marker: string, length: number): boolean {
  let run = 0;
  while (trimmed[run] === marker) {
    run += 1;
  }
  return run >= length && trimmed.slice(run).trim() === "";
}

/** Resolves a link's raw inner text to the live target's id, when it has one. */
export type ResolveLink = (raw: string) => string | undefined;

export interface RewriteMentionsResult {
  body: string;
  /** How many occurrences were rewritten. */
  count: number;
}

/**
 * Rewrites the `[[type/Old Title]]` occurrences that resolved to `targetId`.
 *
 * Replaces from the end so earlier offsets stay valid, and keeps every other
 * byte of the body. The type key is written as the existing grammar spells it
 * and the title uses the new title exactly, so the repaired link resolves under
 * the renamed record without inventing a second spelling.
 */
export function rewriteMentions(
  body: string,
  targetId: string,
  type: string,
  oldTitle: string,
  newTitle: string,
  resolve: ResolveLink,
): RewriteMentionsResult {
  const folded = oldTitle.trim().toLowerCase();
  const title = newTitle.trim();
  let rewritten = body;
  let count = 0;

  for (const occurrence of wikiOccurrences(body).reverse()) {
    if (
      occurrence.type !== type ||
      occurrence.title.toLowerCase() !== folded ||
      resolve(occurrence.raw) !== targetId
    ) {
      continue;
    }
    rewritten =
      rewritten.slice(0, occurrence.start) +
      `[[${occurrence.type}/${title}]]` +
      rewritten.slice(occurrence.end);
    count += 1;
  }

  return { body: rewritten, count };
}

/** A `[[type/title` fragment that names a live type and a new record title. */
export interface CreateSuggestion {
  typeKey: string;
  title: string;
}

/**
 * Parses a completion fragment into a record the writer could create.
 *
 * The type key must be live; a bare title, an unknown type, an empty title or
 * a fragment without a slash returns `null`, because guessing a schema is a
 * silent decision. Whether the title already resolves is the caller's check.
 */
export function createSuggestion(
  partial: string,
  typeKeys: ReadonlySet<string>,
): CreateSuggestion | null {
  const raw = partial.trim();
  const slash = raw.indexOf("/");
  if (slash <= 0) {
    return null;
  }
  const typeKey = raw.slice(0, slash).trim();
  const title = raw.slice(slash + 1).trim();
  if (!TYPE_KEY.test(typeKey) || title === "" || !typeKeys.has(typeKey)) {
    return null;
  }
  return { typeKey, title };
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
