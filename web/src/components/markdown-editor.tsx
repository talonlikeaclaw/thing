import { Popover } from "@base-ui/react/popover";
import {
  Bold,
  Brackets,
  Code,
  Heading2,
  Italic,
  Link2,
  List,
  ListOrdered,
  Quote,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { createPortal } from "react-dom";

import { useCreateObject, useSearch, useTypes } from "@/api/queries";
import { ThumbRow, useHandedness } from "@/components/handedness";
import { Button } from "@/components/ui/controls";
import { caretContent, caretRect, scrollTopForCaret } from "@/lib/caret";
import { cn } from "@/lib/cn";
import { useDebouncedValue } from "@/lib/debounce";
import { readError } from "@/lib/display";
import {
  applySlashCommand,
  continueList,
  indentSelection,
  insertLink,
  insertWikiLink,
  matchSlash,
  pasteLink,
  slashTrigger,
  toggleLinePrefix,
  toggleNumberedList,
  wikiTrigger,
  wrapSelection,
  type Edit,
  type SlashCommand,
} from "@/lib/markdown-edit";
import { subscribeVisualViewport } from "@/lib/viewport";
import { useCoarsePointer, useCompactWidth } from "@/lib/media";
import { createSuggestion } from "@/lib/wiki-links";

type BodyMode = "write" | "preview";

/** One open caret menu; `start` is the offset of the `/` or the first `[`. */
type CaretMenu = {
  mode: "slash" | "wiki";
  start: number;
  query: string;
  caret: number;
};

interface MarkdownEditorProps {
  value: string;
  onChange: (body: string) => void;
  disabled: boolean;
  spaceId: string;
  /** Bumped when the panel replaces the draft; resets the mode to its opened one. */
  resetToken: number;
  /** The read-mode renderer, so writing and reading use one markdown view. */
  preview: (text: string) => ReactNode;
  /** The record write, available in the phone writing surface. */
  onSave?: () => void;
  dirty?: boolean;
  saving?: boolean;
  /** A save refusal, shown inside the phone writing surface. */
  error?: string | null;
}

/** Wiki rows keep the type key they insert; the title is the display label. */
interface WikiRow {
  id: string;
  type: string;
  title: string;
  type_name: string;
}

/** The trailing row that creates the typed title in its named type. */
interface CreateRow {
  create: true;
  typeKey: string;
  title: string;
  type_name: string;
}

type MenuRow = SlashCommand | WikiRow | CreateRow;

const TOOL =
  "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-50 max-sm:h-11 max-sm:w-11 pointer-coarse:h-11 pointer-coarse:w-11";
const HEADING_LEVELS = [1, 2, 3] as const;

const WIKI_LIMIT = 20;
const MENU_WIDTH = 288;
const MENU_ROWS_FINE = 8;
const MENU_ROWS_COARSE = 5;
const MENU_PEEK_COARSE = 22;
const MENU_CHROME = 44;
const MENU_MAX_SHARE = 0.6;

/** A menu row's height, matching the coarse-pointer floor in the stylesheet. */
function menuRowHeight(): number {
  return isCoarse() ? 44 : 32;
}

function isCoarse(): boolean {
  return typeof window !== "undefined" && (window.matchMedia?.("(pointer: coarse)").matches ?? false);
}

function initialMode(value: string): BodyMode {
  return value.trim() === "" ? "write" : "preview";
}

/**
 * The record body's writing surface: a formatting toolbar, keyboard shortcuts,
 * list continuation, a Write/Preview switch (one full-width pane at a time),
 * and one caret menu shared by `/` commands and `[[` wiki-link completion.
 *
 * The text is markdown throughout: every action edits the textarea's value and
 * selection, and the preview renders the same text the server stores.
 */
export function MarkdownEditor({
  value,
  onChange,
  disabled,
  spaceId,
  resetToken,
  preview,
  onSave,
  dirty = false,
  saving = false,
  error = null,
}: MarkdownEditorProps) {
  const [mode, setMode] = useState<BodyMode>(() => initialMode(value));
  const [menu, setMenu] = useState<CaretMenu | null>(null);
  const [active, setActive] = useState(0);
  const [placement, setPlacement] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);
  const [applyToken, setApplyToken] = useState(0);
  const [createError, setCreateError] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement | null>(null);
  const shell = useRef<HTMLDivElement | null>(null);
  const pendingSelection = useRef<{ start: number; end: number } | null>(null);
  const menuRef = useRef<CaretMenu | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const rowCount = useRef(0);
  /** A tap on Write, not a server reset, is what raises the field and keyboard. */
  const requestFocus = useRef(false);
  /** A tap on the preview asks for Write with the caret at the end. */
  const caretToEnd = useRef(false);
  /** The first write on this draft appends; later ones keep the caret where it was. */
  const enteredWrite = useRef(false);
  const listId = useId();
  menuRef.current = menu;

  const coarse = useCoarsePointer();
  const compact = useCompactWidth();
  const { handedness } = useHandedness();
  const immersed = coarse && mode === "write";
  const pageScroll = useRef(0);
  const wasImmersed = useRef(false);
  /** A programmatic edit may wait for Safari's keyboard animation to settle. */
  const revealUntil = useRef(0);
  const create = useCreateObject(spaceId);
  const types = useTypes(spaceId);
  const typeByKey = new Map((types.data ?? []).map((type) => [type.key, type]));
  const wikiQuery = menu?.mode === "wiki" ? menu.query : "";
  const suggestion =
    menu?.mode === "wiki" ? createSuggestion(menu.query, new Set(typeByKey.keys())) : null;
  const settled = useDebouncedValue(suggestion?.title ?? wikiQuery, 150);
  const search = useSearch(spaceId, settled, WIKI_LIMIT);
  // A link is always qualified by its type, so results from other types are
  // noise once the writer has typed one.
  const wikiRows: WikiRow[] =
    menu?.mode === "wiki" && settled.trim() !== ""
      ? (search.data?.results ?? []).filter((row) =>
          suggestion ? row.type === suggestion.typeKey : true,
        )
      : [];
  const exactMatch =
    suggestion !== null &&
    wikiRows.some(
      (row) =>
        row.type === suggestion.typeKey &&
        row.title.trim().toLowerCase() === suggestion.title.toLowerCase(),
    );
  const createRow: CreateRow | null =
    suggestion !== null && settled === suggestion.title && !exactMatch
      ? {
          create: true,
          typeKey: suggestion.typeKey,
          title: suggestion.title,
          type_name: typeByKey.get(suggestion.typeKey)?.name ?? suggestion.typeKey,
        }
      : null;
  const slashRows = menu?.mode === "slash" ? matchSlash(menu.query) : [];
  const rows: readonly MenuRow[] =
    menu?.mode === "wiki" ? [...wikiRows, ...(createRow ? [createRow] : [])] : slashRows;
  const highlighted = rows.length === 0 ? -1 : Math.min(active, rows.length - 1);
  rowCount.current = rows.length;

  /* The record panel replaces the draft from the server; the editor follows. */
  useEffect(() => {
    setMode(initialMode(value));
    setMenu(null);
    requestFocus.current = false;
    enteredWrite.current = false;
    // Only a server replacement resets the surface; typing must not, so the
    // value is deliberately read here without joining the dependency list.
  }, [resetToken]);

  /* A phone in Write is a writing surface, not a page with a form: the bottom
     navigation and the save bar must not stack over the editor. The flag lets
     the shell hide the bar and dock the save row at the keyboard edge. */
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (!coarse || mode !== "write") {
      delete root.dataset.writing;
      return;
    }
    root.dataset.writing = "on";
    return () => {
      delete root.dataset.writing;
    };
  }, [coarse, mode]);

  /* Tapping Write raises the field. The first entry appends to the draft, so a
     phone writer starts where the note ends rather than at offset zero. */
  useLayoutEffect(() => {
    const textarea = field.current;
    if (mode === "preview") {
      textarea?.blur();
      return;
    }
    if (!requestFocus.current) {
      return;
    }
    requestFocus.current = false;
    if (!textarea || disabled) {
      return;
    }
    const firstWrite = !enteredWrite.current;
    enteredWrite.current = true;
    if (firstWrite || caretToEnd.current) {
      caretToEnd.current = false;
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    }
    textarea.focus({ preventScroll: true });
    revealCaretSoon(textarea);
  }, [mode, disabled]);

  /** Keep a programmatic caret inside the textarea's own scrollport. */
  const revealCaret = useCallback((textarea: HTMLTextAreaElement, offset: number) => {
    const caret = caretContent(textarea, offset);
    if (!caret) {
      return;
    }
    // The end of the document has no lower context to reveal; scroll to the
    // true bottom so a trailing line can never sit under the keyboard edge.
    if (offset >= textarea.value.length - 1) {
      textarea.scrollTop = textarea.scrollHeight;
      return;
    }
    const margin = caret.height * 3;
    textarea.scrollTop = scrollTopForCaret(
      caret,
      textarea.scrollTop,
      textarea.clientHeight,
      margin,
    );
  }, []);

  /**
   * Safari can settle a textarea's geometry after the selection commit, so
   * reveal again after that frame, after the keyboard starts, and for any
   * visual-viewport resize while the keyboard finishes opening.
   */
  function revealCaretSoon(textarea: HTMLTextAreaElement) {
    revealUntil.current = performance.now() + 500;
    revealCaret(textarea, textarea.selectionEnd);
    window.requestAnimationFrame(() => {
      if (textarea.isConnected) {
        revealCaret(textarea, textarea.selectionEnd);
      }
    });
    window.setTimeout(() => {
      if (textarea.isConnected) {
        revealCaret(textarea, textarea.selectionEnd);
      }
    }, 180);
  }

  useEffect(() => {
    const view = window.visualViewport;
    if (!view) {
      return;
    }
    const settle = () => {
      if (performance.now() > revealUntil.current) {
        return;
      }
      const textarea = field.current;
      if (textarea) {
        revealCaret(textarea, textarea.selectionEnd);
      }
    };
    view.addEventListener("resize", settle);
    return () => {
      view.removeEventListener("resize", settle);
    };
  }, [revealCaret]);

  function changeMode(next: BodyMode) {
    if (next === mode) {
      return;
    }
    setMenu(null);
    setCreateError(null);
    if (next === "write") {
      requestFocus.current = true;
      if (coarse) {
        pageScroll.current = window.scrollY;
      }
    }
    setMode(next);
  }

  /* The writing surface is fixed, so the page behind it can reflow without
     being seen. Restore the page's own scroll when Preview brings it back. */
  useLayoutEffect(() => {
    if (immersed) {
      wasImmersed.current = true;
      return;
    }
    if (!wasImmersed.current) {
      return;
    }
    wasImmersed.current = false;
    window.scrollTo(0, pageScroll.current);
  }, [immersed]);

  /* Apply the selection a toolbar action or command produced, after the value. */
  useLayoutEffect(() => {
    const target = pendingSelection.current;
    const textarea = field.current;
    if (!target || !textarea) {
      return;
    }
    pendingSelection.current = null;
    textarea.focus();
    textarea.setSelectionRange(target.start, target.end);
    revealCaretSoon(textarea);
  }, [value, applyToken]);

  function apply(edit: Edit) {
    onChange(edit.value);
    pendingSelection.current = { start: edit.start, end: edit.end };
    setApplyToken((current) => current + 1);
  }

  function selectionRange(): { start: number; end: number } {
    const textarea = field.current;
    if (!textarea) {
      return { start: value.length, end: value.length };
    }
    return { start: textarea.selectionStart, end: textarea.selectionEnd };
  }

  /** Places the open menu under its caret, flipped above when space runs out. */
  const place = useCallback(() => {
    const textarea = field.current;
    const container = shell.current;
    const open = menuRef.current;
    if (!textarea || !container || !open) {
      setPlacement(null);
      return;
    }
    const caret = caretRect(textarea, open.caret);
    if (!caret) {
      return;
    }
    const fieldBox = textarea.getBoundingClientRect();
    const containerBox = container.getBoundingClientRect();
    const view = window.visualViewport;
    const viewBottom = view ? view.offsetTop + view.height : window.innerHeight;
    // The phone bar is fixed at z-40 and would sit over the menu's last row;
    // end the usable area at its top. It is hidden from lg up, so a zero-height
    // box means there is nothing to clear.
    const phoneBar = document.querySelector<HTMLElement>("[data-phone-bar]");
    const phoneBarBox = phoneBar?.getBoundingClientRect();
    const visibleBottom =
      phoneBarBox && phoneBarBox.height > 0
        ? Math.min(viewBottom, phoneBarBox.top)
        : viewBottom;
    const visibleHeight = view ? view.height : window.innerHeight;
    const coarse = isCoarse();
    // Measured in page coordinates: what the menu can use is the distance from
    // the caret to the window's edges, not to the field's own box.
    const caretTop = fieldBox.top + caret.top;
    const spaceBelow = visibleBottom - (caretTop + caret.height) - 8;
    const spaceAbove = caretTop - 8;
    const rows = coarse ? MENU_ROWS_COARSE : MENU_ROWS_FINE;
    // Even an empty menu needs room for its header and its hint line; the
    // results arrive after the menu opens, so the size follows them.
    const visibleRows = Math.max(1, Math.min(rowCount.current, rows));
    // A finger has no scrollbar; let the next row peek so the list reads as
    // continuing rather than ending at the popup's edge.
    const peek =
      coarse && rowCount.current > visibleRows ? MENU_PEEK_COARSE : 0;
    const need =
      MENU_CHROME +
      visibleRows * menuRowHeight() +
      (rowCount.current === 0 ? 28 : 0) +
      peek;
    // Open upward only when the side below the caret cannot hold the menu and
    // the side above holds more; the menu then clamps to whichever room exists.
    const flip = spaceBelow < need && spaceAbove > spaceBelow;
    const room = Math.max(
      44,
      Math.min(need, flip ? spaceAbove : spaceBelow, Math.round(visibleHeight * MENU_MAX_SHARE)),
    );
    const top =
      caretTop - containerBox.top + (flip ? -room : caret.height + 4);
    // A finger gets the field's width: a narrow card floating at the caret is
    // hard to hit and wastes the little space a phone has.
    const width = coarse
      ? Math.max(0, Math.min(containerBox.width - 8, window.innerWidth - 16))
      : Math.min(MENU_WIDTH, containerBox.width);
    const left = coarse
      ? Math.max(0, Math.min(fieldBox.left - containerBox.left, containerBox.width - width))
      : Math.max(
          0,
          Math.min(
            fieldBox.left - containerBox.left + caret.left,
            containerBox.width - width,
          ),
        );
    // The menu may start above its container; it only has to stay on screen.
    const next = { top: Math.max(-containerBox.top, top), left, width, maxHeight: room };
    setPlacement((current) =>
      current &&
      current.top === next.top &&
      current.left === next.left &&
      current.width === next.width &&
      current.maxHeight === next.maxHeight
        ? current
        : next,
    );
  }, []);

  useLayoutEffect(() => {
    place();
  }, [place, menu, value, mode, rows.length]);

  /* Arrow keys move the highlight past the list's edge; bring it back. */
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || highlighted < 0) {
      return;
    }
    const option = list.children[highlighted];
    if (!(option instanceof HTMLElement)) {
      return;
    }
    const row = option.getBoundingClientRect();
    const box = list.getBoundingClientRect();
    if (row.top < box.top) {
      list.scrollTop -= box.top - row.top;
    } else if (row.bottom > box.bottom) {
      list.scrollTop += row.bottom - box.bottom;
    }
  }, [highlighted, menu, rows.length]);

  /* A press outside the editor and its menu closes the menu. */
  useEffect(() => {
    if (!menu) {
      return;
    }
    const close = (event: PointerEvent) => {
      const container = shell.current;
      if (container && event.target instanceof Node && container.contains(event.target)) {
        return;
      }
      setMenu(null);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menu]);

  useEffect(() => {
    if (!menu) {
      return;
    }
    const update = () => place();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    const unsubscribe = subscribeVisualViewport(update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      unsubscribe();
    };
  }, [menu, place]);

  function detect(next: string, caret: number): CaretMenu | null {
    const slash = slashTrigger(next, caret);
    if (slash) {
      return { mode: "slash", start: slash.start, query: slash.query, caret };
    }
    const wiki = wikiTrigger(next, caret);
    if (wiki) {
      return { mode: "wiki", start: wiki.start, query: wiki.query, caret };
    }
    return null;
  }

  /* A caret that moves away from an open menu's trigger closes the menu. */
  function onSelect() {
    if (!menuRef.current) {
      return;
    }
    const textarea = field.current;
    setMenu(textarea ? detect(value, textarea.selectionStart) : null);
  }

  function onInput(event: React.ChangeEvent<HTMLTextAreaElement>) {
    const next = event.target.value;
    const caret = event.target.selectionEnd ?? next.length;
    onChange(next);
    setCreateError(null);
    setMenu(detect(next, event.target.selectionStart ?? next.length));
    setActive(0);
    // A new line can move the caret below the visible textarea before Safari
    // decides to scroll it; follow the caret after this commit as well.
    window.requestAnimationFrame(() => {
      const textarea = field.current;
      if (textarea) {
        revealCaret(textarea, caret);
      }
    });
  }

  /** One URL pasted over a selection becomes a markdown link; anything else is a normal paste. */
  function onPaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    if (disabled) {
      return;
    }
    const textarea = event.currentTarget;
    const edit = pasteLink(
      value,
      textarea.selectionStart,
      textarea.selectionEnd,
      event.clipboardData.getData("text/plain"),
    );
    if (!edit) {
      return;
    }
    event.preventDefault();
    apply(edit);
  }

  /** A tap on prose opens the writer; an interactive child keeps its own job. */
  function editFromPreview(event: React.MouseEvent<HTMLDivElement>) {
    if (disabled || mode !== "preview") {
      return;
    }
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    if (target.closest("a, button, input, textarea, select, summary, [role='button']")) {
      return;
    }
    // A click that ends a text selection is a copy gesture, not an edit.
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) {
      return;
    }
    caretToEnd.current = true;
    changeMode("write");
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (disabled) {
      return;
    }
    const textarea = event.currentTarget;
    const { selectionStart: start, selectionEnd: end } = textarea;
    const open = menuRef.current;

    if (open) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActive((current) => (rows.length === 0 ? 0 : (current + 1) % rows.length));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActive((current) =>
          rows.length === 0 ? 0 : (current - 1 + rows.length) % rows.length,
        );
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        accept(highlighted);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setMenu(null);
        return;
      }
    }

    // With no menu open, Escape leaves the field instead of reaching the record
    // page's Escape-to-go-back handler and discarding the draft.
    if (event.key === "Escape") {
      event.preventDefault();
      if (immersed) {
        changeMode("preview");
      } else {
        textarea.blur();
      }
      return;
    }

    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (mod && !event.altKey) {
      if (key === "b") {
        event.preventDefault();
        apply(wrapSelection(value, start, end, "**", "bold"));
        return;
      }
      if (key === "i") {
        event.preventDefault();
        apply(wrapSelection(value, start, end, "*", "italic"));
        return;
      }
      if (key === "k") {
        event.preventDefault();
        apply(insertLink(value, start, end));
        return;
      }
      if (key === "x" && event.shiftKey) {
        event.preventDefault();
        apply(wrapSelection(value, start, end, "`", "code"));
        return;
      }
    }

    if (event.key === "Enter" && !event.shiftKey) {
      const next = continueList(value, start, end);
      if (next) {
        event.preventDefault();
        apply(next);
      }
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      apply(indentSelection(value, start, end, event.shiftKey ? -1 : 1));
    }
  }

  function accept(index: number) {
    const open = menuRef.current;
    if (!open) {
      return;
    }
    const row = index >= 0 ? rows[index] : undefined;
    if (open.mode === "slash") {
      setMenu(null);
      if (!row || !("effect" in row)) {
        return;
      }
      const { end } = selectionRange();
      const edit = applySlashCommand(value, end, open, row);
      apply(edit);
      if (row.effect.kind === "wiki") {
        setActive(0);
        setMenu({ mode: "wiki", start: edit.start - 2, query: "", caret: edit.start });
      }
      return;
    }
    if (row && "create" in row) {
      if (create.isPending) {
        return;
      }
      setCreateError(null);
      const { end } = selectionRange();
      create.mutate(
        { type: row.typeKey, title: row.title },
        {
          onSuccess: () => {
            setMenu(null);
            apply(insertWikiLink(value, open.start, end, `${row.typeKey}/${row.title}`));
          },
          onError: (error) => {
            setCreateError(readError(error));
          },
        },
      );
      return;
    }
    setMenu(null);
    if (!row || "effect" in row || "create" in row) {
      return;
    }
    const { end } = selectionRange();
    apply(insertWikiLink(value, open.start, end, `${row.type}/${row.title}`));
  }

  function startWikiLink() {
    const { start, end } = selectionRange();
    const edit = insertWikiLink(value, start, end, "");
    apply(edit);
    setActive(0);
    setMenu({ mode: "wiki", start: edit.start - 2, query: "", caret: edit.start });
  }

  const tools = [
    { label: "Bold", icon: Bold, run: () => wrapSelection(value, ...range(), "**", "bold") },
    { label: "Italic", icon: Italic, run: () => wrapSelection(value, ...range(), "*", "italic") },
    { label: "Inline code", icon: Code, run: () => wrapSelection(value, ...range(), "`", "code") },
    { label: "Bulleted list", icon: List, run: () => toggleLinePrefix(value, ...range(), "- ") },
    { label: "Numbered list", icon: ListOrdered, run: () => toggleNumberedList(value, ...range()) },
    { label: "Quote", icon: Quote, run: () => toggleLinePrefix(value, ...range(), "> ") },
    { label: "Link", icon: Link2, run: () => insertLink(value, ...range()) },
  ];

  function range(): [number, number] {
    const { start, end } = selectionRange();
    return [start, end];
  }

  function runTool(run: () => Edit) {
    apply(run());
  }

  const editor = (
    <div
      ref={shell}
      className={cn(
        "scroll-mt-2 [overflow-anchor:none]",
        immersed ? "record-writing-surface" : "relative",
      )}
    >
      {immersed ? (
        <ThumbRow className="glass mb-2 items-center gap-1.5 rounded-full py-1 pr-[max(0.5rem,env(safe-area-inset-right))] pl-3">
          <span className="label mr-auto">Writing</span>
          <button
            type="button"
            className="min-h-9 rounded-full px-3 text-[13px] text-ink transition-colors hover:bg-raised pointer-coarse:min-h-11"
            onClick={() => changeMode("preview")}
          >
            Done
          </button>
          {onSave ? (
            <Button
              type="button"
              className="min-h-9 px-3 text-[12px] pointer-coarse:min-h-11"
              disabled={disabled || saving || !dirty}
              onClick={onSave}
            >
              {saving ? "Saving…" : "Save"}
            </Button>
          ) : null}
        </ThumbRow>
      ) : null}
      {/*
        One glass shell holds the tools, the Write/Preview switch and the
        writing well. The switch is its own parent on the dominant edge, so the
        nine formatting tools keep their own symmetric rows; the prose inside
        the well stays on opaque stock.
      */}
      <div
        className={cn(
          "glass rounded-[22px] p-2",
          immersed && "flex min-h-0 flex-1 flex-col",
        )}
      >
        <div
          className={cn(
            "flex flex-wrap items-center gap-0 sm:gap-1",
            compact
              ? mode === "write"
                ? "justify-around"
                : handedness === "left"
                  ? "justify-start"
                  : "justify-end"
              : mode === "write"
                ? "justify-between"
                : handedness === "left"
                  ? "justify-start"
                  : "justify-end",
          )}
        >
          {mode === "write" ? (
            <div
              role="toolbar"
              aria-label="Body editor"
              className="flex min-w-0 flex-col items-center gap-0.5 sm:flex-1 sm:flex-row sm:items-center sm:gap-1"
            >
              <div className="flex items-center justify-center gap-0 sm:contents">
                <HeadingMenu
                  disabled={disabled}
                  onPick={(level) =>
                    apply(toggleLinePrefix(value, ...range(), `${"#".repeat(level)} `))
                  }
                />
                {tools.slice(0, 4).map((tool) => (
                  <button
                    key={tool.label}
                    type="button"
                    aria-label={tool.label}
                    title={tool.label}
                    disabled={disabled}
                    className={TOOL}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => runTool(tool.run)}
                  >
                    <tool.icon aria-hidden className="h-4 w-4" />
                  </button>
                ))}
              </div>
              <div className="flex items-center justify-center gap-0 sm:contents">
                {tools.slice(4).map((tool) => (
                  <button
                    key={tool.label}
                    type="button"
                    aria-label={tool.label}
                    title={tool.label}
                    disabled={disabled}
                    className={TOOL}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => runTool(tool.run)}
                  >
                    <tool.icon aria-hidden className="h-4 w-4" />
                  </button>
                ))}
                <button
                  type="button"
                  aria-label="Link to a record"
                  title="Link to a record"
                  disabled={disabled}
                  className={TOOL}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={startWikiLink}
                >
                  <Brackets aria-hidden className="h-4 w-4" />
                </button>
              </div>
            </div>
          ) : null}
          <div className="flex shrink-0 items-center justify-center">
            <BodyModeSwitch
              mode={mode}
              onChange={changeMode}
              tight={compact}
            />
          </div>
        </div>

        {immersed && error ? (
          <p
            role="alert"
            className="mt-2 rounded-field border border-danger px-3 py-2 text-[13px] text-danger"
          >
            {error}
          </p>
        ) : null}

        <div
          className={cn(
            "mt-2",
            immersed && "flex min-h-0 flex-1 flex-col",
          )}
        >
          <div
            className={cn(
              "relative",
              mode === "preview" && "hidden",
              immersed && "flex min-h-0 flex-1",
            )}
          >
            <textarea
              ref={field}
              aria-label="Markdown body"
              aria-autocomplete="list"
              aria-expanded={menu !== null}
              aria-controls={menu && rows.length > 0 ? listId : undefined}
              aria-activedescendant={
                menu && highlighted >= 0 ? `${listId}-${highlighted}` : undefined
              }
              disabled={disabled}
              className={cn(
                "record-body-input min-h-[14rem] w-full resize-y rounded-[14px] border border-line-interactive/70 bg-ground px-3 py-2 text-[15px] leading-[1.6] text-ink transition-colors hover:border-line-strong focus:border-accent pointer-coarse:resize-none pointer-coarse:text-[16px] sm:min-h-[22rem]",
                immersed && "min-h-0 flex-1 resize-none",
              )}
              placeholder="Write in markdown. Saves with the rest of the record."
              spellCheck
              value={value}
              onChange={onInput}
              onPaste={onPaste}
              onFocus={() => {
                enteredWrite.current = true;
              }}
              onKeyDown={onKeyDown}
              onScroll={place}
              onSelect={onSelect}
            />
          </div>

          <div
            className={cn(
              "mt-2 min-h-[14rem] rounded-[14px] border border-line-interactive/70 bg-ground px-3 sm:min-h-[22rem]",
              mode === "write" && "hidden",
            )}
            onClick={editFromPreview}
          >
            {preview(value)}
          </div>
        </div>
      </div>

      {menu ? (
        <div
          className="glass-strong absolute z-30 flex flex-col overflow-hidden rounded-[22px] p-2"
          style={{
            top: placement?.top ?? 0,
            left: placement?.left ?? 0,
            width: placement?.width ?? MENU_WIDTH,
            maxHeight: placement?.maxHeight,
          }}
        >
          <p className="label px-2 py-1 text-faint">
            {menu.mode === "wiki" ? "Link to a record" : "Formatting commands"}
          </p>
          {createError ? (
            <p role="alert" className="border-b rule px-2 pb-1.5 text-[12px] text-danger">
              {createError}
            </p>
          ) : null}
          {rows.length === 0 ? (
            <p className="px-2 py-1.5 text-[13px] text-muted">
              {menu.mode === "wiki" && settled.trim() === ""
                ? "Type to find a record."
                : menu.mode === "wiki" && search.isPending
                  ? "Searching…"
                  : menu.mode === "wiki"
                    ? "No records match."
                    : "No commands match."}
            </p>
          ) : (
            <ul
              ref={listRef}
              id={listId}
              role="listbox"
              aria-label={menu.mode === "wiki" ? "Records" : "Commands"}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
            >
              {rows.map((row, index) => (
                <li
                  key={index}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === highlighted}
                  className={cn(
                    "flex min-h-8 cursor-pointer items-center justify-between gap-3 rounded-[8px] px-2 text-[13px] transition-colors pointer-coarse:min-h-11",
                    index === highlighted
                      ? "bg-accent-wash text-accent-on-wash"
                      : "text-muted hover:bg-raised hover:text-ink",
                  )}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => accept(index)}
                >
                  {"effect" in row ? (
                    <>
                      <span className="truncate">{row.label}</span>
                      <span className="shrink-0 font-mono text-[11px] text-faint">
                        {row.marker}
                      </span>
                    </>
                  ) : "create" in row ? (
                    <>
                      <span className="truncate">
                        {create.isPending ? "Creating…" : `Create “${row.title}”`}
                      </span>
                      <span className="shrink-0 font-mono text-[11px] text-faint">
                        {row.type_name}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="truncate">{row.title}</span>
                      <span className="shrink-0 font-mono text-[11px] text-faint">
                        {row.type_name}
                      </span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

    </div>
  );

  // A fixed surface inside the page would be trapped by an animated ancestor;
  // the phone writing sheet belongs to the body, beside the navigation.
  return immersed ? createPortal(editor, document.body) : editor;
}

/** The toolbar's heading trigger: one level per row, applied to the selection. */
function HeadingMenu({
  disabled,
  onPick,
}: {
  disabled: boolean;
  onPick: (level: 1 | 2 | 3) => void;
}) {
  const [open, setOpen] = useState(false);
  const { handedness } = useHandedness();
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        aria-label="Heading"
        title="Heading"
        disabled={disabled}
        className={TOOL}
        onMouseDown={(event) => event.preventDefault()}
      >
        <Heading2 aria-hidden className="h-4 w-4" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          sideOffset={4}
          align={handedness === "left" ? "start" : "end"}
          className="z-50"
        >
          <Popover.Popup className="w-[10.5rem] glass-strong rounded-card p-1.5">
            {HEADING_LEVELS.map((level) => (
              <Popover.Close
                key={level}
                className="flex min-h-9 w-full items-center justify-between gap-3 rounded-[8px] px-2 text-left text-[13px] text-ink transition-colors hover:bg-raised pointer-coarse:min-h-11"
                onClick={() => onPick(level)}
              >
                <span>Heading {level}</span>
                <span className="font-mono text-[11px] text-faint">
                  {"#".repeat(level)}
                </span>
              </Popover.Close>
            ))}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function BodyModeSwitch({
  mode,
  onChange,
  tight = false,
  className,
}: {
  mode: BodyMode;
  onChange: (mode: BodyMode) => void;
  /** A phone row shares its width with the tools; keep the segments narrow. */
  tight?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded-full border border-line p-0.5",
        className,
      )}
      role="group"
      aria-label="Body mode"
    >
      {(["write", "preview"] as const).map((choice) => (
        <button
          key={choice}
          type="button"
          aria-pressed={mode === choice}
          className={cn(
            "label rounded-[10px] py-1 transition-colors hover:text-ink aria-pressed:bg-accent-wash aria-pressed:text-accent-on-wash max-sm:min-h-11 pointer-coarse:min-h-11",
            tight ? "px-1" : "px-2.5",
            mode === choice ? "" : "text-faint",
          )}
          onClick={() => onChange(choice)}
        >
          {choice}
        </button>
      ))}
    </div>
  );
}
