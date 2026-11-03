//! Pure text transforms behind the body toolbar, its shortcuts and the `/` menu.
//!
//! Every helper reads the current value and selection and returns the next value
//! and selection; none touches the DOM, so the editor and its tests share one
//! implementation and a command has no formatting logic of its own.

/** The next value and selection; `start` and `end` are clamped by the caller. */
export interface Edit {
  value: string;
  start: number;
  end: number;
}

/** One replacement inside a value, addressed from the start of the text. */
interface TextEdit {
  at: number;
  remove: number;
  insert: string;
}

const HEADING_PREFIX = /^#{1,6} $/;
const HEADING_LINE = /^#{1,6} /;
const FENCE_LINE = /^[ \t]*(?:`{3,}|~{3,})/;
const NUMBER_LINE = /^([ \t]*)(\d+)\.([ \t]+)/;
const BULLET_LINE = /^([ \t]*)([-*+])([ \t]+)/;
const QUOTE_LINE = /^([ \t]*)>([ \t]?)/;
const WIKI_TRIGGER = /\[\[([^[\]]*)$/;
const SLASH_TRIGGER = /^([ \t]*)\/([a-z0-9-]*)$/;
const SLASH_QUERY_MAX = 20;
const SLASH_INDENT_MAX = 3;
const LIST_INDENT = "  ";

/** The offset of the line containing `offset`. */
function lineStart(value: string, offset: number): number {
  if (offset <= 0) {
    return 0;
  }
  return value.lastIndexOf("\n", offset - 1) + 1;
}

/** The offset of the newline ending the line containing `offset`, or the end. */
function lineEnd(value: string, offset: number): number {
  const newline = value.indexOf("\n", Math.max(0, offset));
  return newline === -1 ? value.length : newline;
}

function leadingWhitespace(text: string): string {
  return /^[ \t]*/.exec(text)?.[0] ?? "";
}

/**
 * The lines a selection touches. A selection that ends exactly at a line start
 * does not include the line it opens onto.
 */
function lineSpans(value: string, start: number, end: number): { from: number; to: number }[] {
  const last = end > start && value[end - 1] === "\n" ? end - 1 : end;
  const limit = Math.min(lineEnd(value, last), value.length);
  const spans: { from: number; to: number }[] = [];
  let cursor = lineStart(value, start);
  for (;;) {
    const to = lineEnd(value, cursor);
    spans.push({ from: cursor, to });
    if (to >= limit) {
      break;
    }
    cursor = to + 1;
  }
  return spans;
}

/**
 * Where an old offset lands after the edits.
 *
 * An offset past an edit moves with its length change; one inside a replaced
 * run (a caret on a heading marker, which the new marker replaces) ends up
 * after the inserted text; one before the first edit stays where it is.
 */
function mapOffset(edits: TextEdit[], offset: number): number {
  let shift = 0;
  for (const edit of edits) {
    if (offset <= edit.at) {
      break;
    }
    if (offset < edit.at + edit.remove) {
      return edit.at + shift + edit.insert.length;
    }
    shift += edit.insert.length - edit.remove;
  }
  return offset + shift;
}

/** The caret on a line-prefix command sits after the marker it just wrote. */
function caretAfterLineEdit(edits: TextEdit[], offset: number): number | null {
  let found: TextEdit | null = null;
  for (const edit of edits) {
    if (edit.at <= offset) {
      found = edit;
    }
  }
  return found ? found.at + found.insert.length : null;
}

/** Applies non-overlapping edits in order and shifts the selection with them. */
function applyTextEdits(
  value: string,
  start: number,
  end: number,
  edits: TextEdit[],
): Edit {
  if (edits.length === 0) {
    return { value, start, end };
  }
  let next = "";
  let cursor = 0;
  for (const edit of edits) {
    next += value.slice(cursor, edit.at) + edit.insert;
    cursor = edit.at + edit.remove;
  }
  next += value.slice(cursor);
  const clamp = (offset: number) => Math.min(Math.max(offset, 0), next.length);
  return { value: next, start: clamp(mapOffset(edits, start)), end: clamp(mapOffset(edits, end)) };
}

/**
 * Wraps the selection in `marker`, unwraps it when it is already wrapped, and
 * inserts `placeholder` (selected) when the selection is collapsed.
 */
export function wrapSelection(
  value: string,
  start: number,
  end: number,
  marker: string,
  placeholder: string,
): Edit {
  const selected = value.slice(start, end);
  if (
    selected.length >= marker.length * 2 &&
    selected.startsWith(marker) &&
    selected.endsWith(marker)
  ) {
    const inner = selected.slice(marker.length, selected.length - marker.length);
    return {
      value: value.slice(0, start) + inner + value.slice(end),
      start,
      end: start + inner.length,
    };
  }
  if (selected === "") {
    return {
      value: `${value.slice(0, start)}${marker}${placeholder}${marker}${value.slice(end)}`,
      start: start + marker.length,
      end: start + marker.length + placeholder.length,
    };
  }
  return {
    value: `${value.slice(0, start)}${marker}${selected}${marker}${value.slice(end)}`,
    start: start + marker.length,
    end: end + marker.length,
  };
}

/**
 * Toggles a line prefix (heading, bullet, quote) on every selected line.
 *
 * The prefix goes after the line's indentation; when every non-empty line
 * already carries it, it is removed instead. A heading replaces another heading
 * level rather than stacking, so `## Name` toggled to level one becomes
 * `# Name`, never `# ## Name`.
 */
export function toggleLinePrefix(
  value: string,
  start: number,
  end: number,
  prefix: string,
): Edit {
  const heading = HEADING_PREFIX.test(prefix);
  const spans = lineSpans(value, start, end).map((span) => ({
    ...span,
    text: value.slice(span.from, span.to),
  }));
  const meaningful = spans.filter((span) => span.text.trim() !== "");
  const present =
    meaningful.length > 0 &&
    meaningful.every((span) => {
      const content = span.text.slice(leadingWhitespace(span.text).length);
      return content.startsWith(prefix);
    });

  const edits: TextEdit[] = [];
  for (const span of spans) {
    const indent = leadingWhitespace(span.text).length;
    const at = span.from + indent;
    if (span.text.trim() === "") {
      if (start === end) {
        edits.push({ at, remove: 0, insert: prefix });
      }
      continue;
    }
    const existing = heading ? HEADING_LINE.exec(span.text.slice(indent)) : null;
    if (present) {
      edits.push({ at, remove: existing ? existing[0].length : prefix.length, insert: "" });
      continue;
    }
    edits.push({ at, remove: existing ? existing[0].length : 0, insert: prefix });
  }
  const result = applyTextEdits(value, start, end, edits);
  if (start === end) {
    const caret = caretAfterLineEdit(edits, start);
    if (caret !== null) {
      result.start = caret;
      result.end = caret;
    }
  }
  return result;
}

/**
 * Toggles an ordered list over the selected lines, numbering them in order.
 *
 * Lines that already carry a number lose the marker together; the numbers are
 * never renumbered in place, because a partial renumber would fight the user's
 * own numbering.
 */
export function toggleNumberedList(value: string, start: number, end: number): Edit {
  const spans = lineSpans(value, start, end);
  const meaningful = spans.filter((span) => value.slice(span.from, span.to).trim() !== "");
  const present =
    meaningful.length > 0 &&
    meaningful.every((span) => NUMBER_LINE.test(value.slice(span.from, span.to)));

  const edits: TextEdit[] = [];
  let number = 1;
  for (const span of spans) {
    const text = value.slice(span.from, span.to);
    const indent = leadingWhitespace(text).length;
    const at = span.from + indent;
    if (text.trim() === "") {
      if (start === end) {
        edits.push({ at, remove: 0, insert: `${number}. ` });
        number += 1;
      }
      continue;
    }
    const existing = NUMBER_LINE.exec(text.slice(indent));
    if (present) {
      edits.push({ at, remove: existing ? existing[0].length : 0, insert: "" });
      continue;
    }
    edits.push({ at, remove: 0, insert: `${number}. ` });
    number += 1;
  }
  const result = applyTextEdits(value, start, end, edits);
  if (start === end) {
    const caret = caretAfterLineEdit(edits, start);
    if (caret !== null) {
      result.start = caret;
      result.end = caret;
    }
  }
  return result;
}

/**
 * Starts the next list or quote item when Enter is pressed at the end of one.
 *
 * Enter on an item with no text removes its marker and leaves the line empty,
 * which is how a list is exited without deleting characters; any other caret
 * position returns `null` so the browser inserts an ordinary newline.
 */
export function continueList(value: string, start: number, end: number): Edit | null {
  if (start !== end || start !== lineEnd(value, start)) {
    return null;
  }
  const from = lineStart(value, start);
  const line = value.slice(from, start);

  const bullet = BULLET_LINE.exec(line);
  const ordered = NUMBER_LINE.exec(line);
  const quote = QUOTE_LINE.exec(line);
  if (!bullet && !ordered && !quote) {
    return null;
  }

  const indent = leadingWhitespace(line);
  let marker: string;
  let content: string;
  if (bullet) {
    marker = `${bullet[2]} `;
    content = line.slice(bullet[0].length);
  } else if (ordered) {
    const current = Number.parseInt(ordered[2] ?? "", 10);
    marker = `${Number.isFinite(current) ? current + 1 : 1}. `;
    content = line.slice(ordered[0].length);
  } else {
    marker = "> ";
    content = line.slice(quote?.[0].length ?? 0);
  }

  if (content.trim() === "") {
    return {
      value: value.slice(0, from) + indent + value.slice(start),
      start: from + indent.length,
      end: from + indent.length,
    };
  }
  const inserted = `\n${indent}${marker}`;
  return {
    value: value.slice(0, start) + inserted + value.slice(start),
    start: start + inserted.length,
    end: start + inserted.length,
  };
}

/**
 * Indents or outdents the selected lines by two spaces.
 *
 * With a collapsed selection Tab inserts two spaces at the caret and Shift-Tab
 * removes up to two spaces just before it.
 */
export function indentSelection(
  value: string,
  start: number,
  end: number,
  direction: 1 | -1,
): Edit {
  if (start === end) {
    if (direction === 1) {
      return {
        value: value.slice(0, start) + LIST_INDENT + value.slice(start),
        start: start + LIST_INDENT.length,
        end: start + LIST_INDENT.length,
      };
    }
    const before = value.slice(Math.max(0, start - LIST_INDENT.length), start);
    const spaces = /[ ]*$/.exec(before)?.[0].length ?? 0;
    const remove = Math.min(spaces, LIST_INDENT.length);
    return {
      value: value.slice(0, start - remove) + value.slice(start),
      start: start - remove,
      end: start - remove,
    };
  }

  const edits: TextEdit[] = [];
  for (const span of lineSpans(value, start, end)) {
    if (direction === 1) {
      edits.push({ at: span.from, remove: 0, insert: LIST_INDENT });
      continue;
    }
    const spaces = /^[ ]*/.exec(value.slice(span.from, span.to))?.[0].length ?? 0;
    edits.push({ at: span.from, remove: Math.min(spaces, LIST_INDENT.length), insert: "" });
  }
  return applyTextEdits(value, start, end, edits);
}

/**
 * Wraps a non-empty selection in a markdown link when the pasted text is one
 * http(s) URL. Returns `null` for a collapsed selection or any other clipboard,
 * so every ordinary paste stays the browser's.
 */
export function pasteLink(value: string, start: number, end: number, clipboard: string): Edit | null {
  const url = clipboard.trim();
  if (start === end || !/^https?:\/\/\S+$/i.test(url)) {
    return null;
  }
  const label = value.slice(start, end).replace(/([[\]])/g, "\\$1");
  const inserted = `[${label}](${markdownDestination(url)})`;
  return {
    value: value.slice(0, start) + inserted + value.slice(end),
    start: start + 1,
    end: start + 1 + label.length,
  };
}

/**
 * A link destination that keeps a URL with unbalanced parentheses intact;
 * CommonMark allows a bare destination only while its parentheses balance.
 */
function markdownDestination(url: string): string {
  let depth = 0;
  for (const character of url) {
    if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
      if (depth < 0) {
        return `<${url}>`;
      }
    }
  }
  return depth === 0 ? url : `<${url}>`;
}

/**
 * Inserts a markdown link around the selection.
 *
 * A ranged selection becomes `[selected](url)` with the URL selected; a
 * collapsed one inserts `[text](url)` with the text selected.
 */
export function insertLink(value: string, start: number, end: number): Edit {
  const selected = value.slice(start, end);
  if (selected === "") {
    const inserted = "[text](url)";
    return {
      value: value.slice(0, start) + inserted + value.slice(end),
      start: start + 1,
      end: start + 5,
    };
  }
  const inserted = `[${selected}](url)`;
  const urlStart = start + selected.length + 3;
  return {
    value: value.slice(0, start) + inserted + value.slice(end),
    start: urlStart,
    end: urlStart + 3,
  };
}

/**
 * Inserts a fenced code block around the selection, or an empty block with the
 * caret on its own line.
 *
 * Newlines are added around the fence when the insertion point is not already
 * at a line boundary, so a block dropped mid-line still parses.
 */
export function insertFencedBlock(value: string, start: number, end: number): Edit {
  const selected = value.slice(start, end);
  const lead = start === 0 || value[start - 1] === "\n" ? "" : "\n";
  const trail = end === value.length || value[end] === "\n" ? "" : "\n";
  const body = selected === "" ? "\n\n" : `\n${selected}\n`;
  const inserted = `${lead}\`\`\`${body}\`\`\`${trail}`;
  const innerStart = start + lead.length + 4;
  return {
    value: value.slice(0, start) + inserted + value.slice(end),
    start: innerStart,
    end: innerStart + selected.length,
  };
}

/**
 * Inserts `[[raw]]` (or a lone `[[` when `raw` is empty) at the selection and
 * leaves the caret after the closing brackets so typing can continue.
 */
export function insertWikiLink(
  value: string,
  start: number,
  end: number,
  raw: string,
): Edit {
  const inserted = raw === "" ? "[[" : `[[${raw}]]`;
  const caret = start + inserted.length;
  return {
    value: value.slice(0, start) + inserted + value.slice(end),
    start: caret,
    end: caret,
  };
}

/**
 * Recognises a `/` command trigger ending at the caret.
 *
 * The slash must open its line (whitespace only before it, at most three
 * characters of indentation), be the start of a `[a-z0-9-]` run of at most 20
 * characters, and sit outside a fenced code block. Anything else is prose and
 * stays text.
 */
export function slashTrigger(
  value: string,
  offset: number,
): { start: number; query: string } | null {
  const caret = Math.min(Math.max(offset, 0), value.length);
  const from = lineStart(value, caret);
  if (isInFence(value, caret)) {
    return null;
  }
  const match = SLASH_TRIGGER.exec(value.slice(from, caret));
  const indent = match?.[1] ?? "";
  const query = match?.[2] ?? "";
  if (!match || indent.length > SLASH_INDENT_MAX || query.length > SLASH_QUERY_MAX) {
    return null;
  }
  return { start: from + indent.length, query };
}

/**
 * Whether `offset` sits inside an unclosed fenced code block.
 *
 * A fence token is a line whose trimmed text starts with three or more
 * backticks or tildes; an odd number of them above the caret means the caret is
 * inside the block.
 */
export function isInFence(value: string, offset: number): boolean {
  const limit = Math.min(Math.max(offset, 0), value.length);
  let fences = 0;
  let from = 0;
  while (from < limit) {
    const to = lineEnd(value, from);
    if (FENCE_LINE.test(value.slice(from, to))) {
      fences += 1;
    }
    if (to >= limit) {
      break;
    }
    from = to + 1;
  }
  return fences % 2 === 1;
}

/** The splice a `/` command applies: the trigger run is replaced by its effect. */
export type SlashEffect =
  | { kind: "heading"; level: 1 | 2 | 3 }
  | { kind: "prefix"; prefix: string }
  | { kind: "number" }
  | { kind: "inline"; marker: string; placeholder: string }
  | { kind: "block" }
  | { kind: "link" }
  | { kind: "wiki" };

/** One row of the `/` menu. */
export interface SlashCommand {
  id: string;
  /** Lowercase spellings that match this row; the menu never inserts them. */
  names: readonly string[];
  label: string;
  /** The markdown marker the row teaches, shown in muted mono. */
  marker: string;
  effect: SlashEffect;
}

/**
 * Every `/` command, in menu order.
 *
 * Inline commands insert a selected placeholder instead of wrapping: typing the
 * `/` already replaced any selection, so there is no text left to wrap.
 */
export const SLASH_COMMANDS: readonly SlashCommand[] = [
  {
    id: "h1",
    names: ["h1", "h"],
    label: "Heading 1",
    marker: "#",
    effect: { kind: "heading", level: 1 },
  },
  {
    id: "h2",
    names: ["h2"],
    label: "Heading 2",
    marker: "##",
    effect: { kind: "heading", level: 2 },
  },
  {
    id: "h3",
    names: ["h3"],
    label: "Heading 3",
    marker: "###",
    effect: { kind: "heading", level: 3 },
  },
  {
    id: "bullet",
    names: ["bullet", "ul"],
    label: "Bulleted list",
    marker: "-",
    effect: { kind: "prefix", prefix: "- " },
  },
  {
    id: "number",
    names: ["number", "ol"],
    label: "Numbered list",
    marker: "1.",
    effect: { kind: "number" },
  },
  {
    id: "quote",
    names: ["quote", "q"],
    label: "Quote",
    marker: ">",
    effect: { kind: "prefix", prefix: "> " },
  },
  {
    id: "code",
    names: ["code"],
    label: "Inline code",
    marker: "`",
    effect: { kind: "inline", marker: "`", placeholder: "code" },
  },
  {
    id: "block",
    names: ["block", "pre"],
    label: "Code block",
    marker: "```",
    effect: { kind: "block" },
  },
  {
    id: "bold",
    names: ["bold", "b"],
    label: "Bold",
    marker: "**",
    effect: { kind: "inline", marker: "**", placeholder: "bold" },
  },
  {
    id: "italic",
    names: ["italic", "i"],
    label: "Italic",
    marker: "*",
    effect: { kind: "inline", marker: "*", placeholder: "italic" },
  },
  {
    id: "link",
    names: ["link"],
    label: "Link",
    marker: "[text](url)",
    effect: { kind: "link" },
  },
  {
    id: "wiki",
    names: ["wiki", "record"],
    label: "Link to a record",
    marker: "[[…]]",
    effect: { kind: "wiki" },
  },
];

/**
 * The commands a typed query matches, prefix matches first, then substring
 * matches, each in table order.
 */
export function matchSlash(query: string): SlashCommand[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") {
    return [...SLASH_COMMANDS];
  }
  const ranked: { command: SlashCommand; rank: number }[] = [];
  for (const command of SLASH_COMMANDS) {
    const prefix = command.names.some((name) => name.startsWith(needle));
    if (prefix) {
      ranked.push({ command, rank: 0 });
      continue;
    }
    if (command.names.some((name) => name.includes(needle))) {
      ranked.push({ command, rank: 1 });
    }
  }
  return ranked.sort((left, right) => left.rank - right.rank).map((entry) => entry.command);
}

/**
 * Removes the `/query` run and applies the command's effect at the trigger.
 *
 * Every effect delegates to the same helper the toolbar calls, so a command is
 * a spelling of an existing edit rather than a second implementation.
 */
export function applySlashCommand(
  value: string,
  end: number,
  trigger: { start: number; query: string },
  command: SlashCommand,
): Edit {
  const effect = command.effect;
  const tail = value.slice(end);
  const lineScoped = effect.kind === "heading" || effect.kind === "prefix" || effect.kind === "number";
  const rest = lineScoped && tail.startsWith(" ") ? tail.slice(1) : tail;
  const removed = value.slice(0, trigger.start) + rest;
  const caret = trigger.start;
  switch (effect.kind) {
    case "heading":
      return toggleLinePrefix(removed, caret, caret, `${"#".repeat(effect.level)} `);
    case "prefix":
      return toggleLinePrefix(removed, caret, caret, effect.prefix);
    case "number":
      return toggleNumberedList(removed, caret, caret);
    case "inline":
      return wrapSelection(removed, caret, caret, effect.marker, effect.placeholder);
    case "block":
      return insertFencedBlock(removed, caret, caret);
    case "link":
      return insertLink(removed, caret, caret);
    case "wiki":
      return insertWikiLink(removed, caret, caret, "");
  }
}

/**
 * The wiki-link trigger ending at `offset`, if the caret is finishing a
 * `[[partial` on its line and the brackets are not escaped.
 */
export function wikiTrigger(value: string, offset: number): { start: number; query: string } | null {
  const caret = Math.min(Math.max(offset, 0), value.length);
  const from = lineStart(value, caret);
  const match = WIKI_TRIGGER.exec(value.slice(from, caret));
  if (!match) {
    return null;
  }
  const start = from + match.index;
  if (start > 0 && value[start - 1] === "\\") {
    return null;
  }
  return { start, query: match[1] ?? "" };
}
