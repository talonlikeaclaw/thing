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

import { useSearch } from "@/api/queries";
import { caretRect } from "@/lib/caret";
import { cn } from "@/lib/cn";
import { useDebouncedValue } from "@/lib/debounce";
import {
  applySlashCommand,
  continueList,
  indentSelection,
  insertLink,
  insertWikiLink,
  matchSlash,
  slashTrigger,
  toggleLinePrefix,
  toggleNumberedList,
  wikiTrigger,
  wrapSelection,
  type Edit,
  type SlashCommand,
} from "@/lib/markdown-edit";
import { metricsFor, subscribeVisualViewport } from "@/lib/viewport";

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
}

/** Wiki rows keep the type key they insert; the title is the display label. */
interface WikiRow {
  id: string;
  type: string;
  title: string;
  type_name: string;
}

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
 * list continuation, a live preview beside the text on wide screens, and one
 * caret menu shared by `/` commands and `[[` wiki-link completion.
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
  const field = useRef<HTMLTextAreaElement | null>(null);
  const shell = useRef<HTMLDivElement | null>(null);
  const pendingSelection = useRef<{ start: number; end: number } | null>(null);
  const menuRef = useRef<CaretMenu | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const rowCount = useRef(0);
  /** A tap on Write, not a server reset, is what raises the field and keyboard. */
  const requestFocus = useRef(false);
  /** The first write on this draft appends; later ones keep the caret where it was. */
  const enteredWrite = useRef(false);
  const listId = useId();
  menuRef.current = menu;

  const wikiQuery = menu?.mode === "wiki" ? menu.query : "";
  const settled = useDebouncedValue(wikiQuery, 150);
  const search = useSearch(spaceId, settled, WIKI_LIMIT);
  // An empty partial has nothing to search; the previous query's rows may still
  // sit in the query cache, so they are never shown as if they matched it.
  const wikiRows: WikiRow[] =
    menu?.mode === "wiki" && settled.trim() !== "" ? (search.data?.results ?? []) : [];
  const slashRows = menu?.mode === "slash" ? matchSlash(menu.query) : [];
  const rows: readonly (SlashCommand | WikiRow)[] =
    menu?.mode === "wiki" ? wikiRows : slashRows;
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
    textarea.focus();
    if (firstWrite) {
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    }
  }, [mode, disabled]);

  function changeMode(next: BodyMode) {
    if (next === mode) {
      return;
    }
    setMenu(null);
    if (next === "write") {
      requestFocus.current = true;
    }
    setMode(next);
  }

  /** Put the field above the save bar and the keyboard without a blind jump. */
  function revealField() {
    const textarea = field.current;
    if (!textarea) {
      return;
    }
    window.requestAnimationFrame(() => {
      if (field.current && document.activeElement === field.current) {
        field.current.scrollIntoView({ block: "nearest" });
      }
    });
  }

  /* The keyboard changes the visual viewport after focus; keep the field above
     the save bar it moves up with. Address-bar and orientation resize events
     leave the keyboard height alone and must not fight a page scroll. */
  useEffect(() => {
    const view = window.visualViewport;
    if (mode !== "write" || !view) {
      return;
    }
    let lastKeyboard = metricsFor(view, window.innerHeight).keyboard;
    let frame = 0;
    const settle = () => {
      const keyboard = metricsFor(view, window.innerHeight).keyboard;
      if (keyboard === lastKeyboard) {
        return;
      }
      lastKeyboard = keyboard;
      if (frame !== 0) {
        window.cancelAnimationFrame(frame);
      }
      frame = window.requestAnimationFrame(() => {
        frame = window.requestAnimationFrame(() => {
          frame = 0;
          const textarea = field.current;
          if (textarea && document.activeElement === textarea) {
            textarea.scrollIntoView({ block: "nearest" });
          }
        });
      });
    };
    view.addEventListener("resize", settle);
    return () => {
      if (frame !== 0) {
        window.cancelAnimationFrame(frame);
      }
      view.removeEventListener("resize", settle);
    };
  }, [mode]);

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
    onChange(next);
    setMenu(detect(next, event.target.selectionStart ?? next.length));
    setActive(0);
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
      textarea.blur();
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
    setMenu(null);
    if (!row || !("type" in row)) {
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
    { label: "Heading", icon: Heading2, run: () => toggleLinePrefix(value, ...range(), "## ") },
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

  return (
    <div ref={shell} className="relative mt-2">
      <div
        role="toolbar"
        aria-label="Body editor"
        className="flex flex-wrap items-center gap-x-0.5 gap-y-1 sm:flex-nowrap sm:gap-2"
      >
        {mode === "write" ? (
          <>
            {tools.map((tool) => (
              <button
                key={tool.label}
                type="button"
                aria-label={tool.label}
                title={tool.label}
                disabled={disabled}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[3px] text-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-50 pointer-coarse:h-11 pointer-coarse:w-11"
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
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[3px] text-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-50 pointer-coarse:h-11 pointer-coarse:w-11"
              onMouseDown={(event) => event.preventDefault()}
              onClick={startWikiLink}
            >
              <Brackets aria-hidden className="h-4 w-4" />
            </button>
          </>
        ) : null}
        <BodyModeSwitch mode={mode} onChange={changeMode} className="ml-auto" />
      </div>

      <div
        className={cn(
          "mt-1.5",
          mode === "write" && "lg:grid lg:grid-cols-2 lg:items-start lg:gap-4",
        )}
      >
        <div className={cn("relative", mode === "preview" && "hidden")}>
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
            className="record-body-input min-h-[14rem] w-full resize-y rounded-field border border-line-interactive bg-ground px-3 py-2 text-[15px] leading-[1.6] text-ink transition-colors hover:border-line-strong focus:border-accent pointer-coarse:resize-none pointer-coarse:text-[16px] sm:min-h-[22rem]"
            placeholder="Write in markdown. Saves with the rest of the record."
            spellCheck
            value={value}
            onChange={onInput}
            onFocus={() => {
              enteredWrite.current = true;
              revealField();
            }}
            onKeyDown={onKeyDown}
            onScroll={place}
            onSelect={onSelect}
          />
        </div>

        <div
          className={cn(
            "min-h-[14rem] rounded-field border border-line px-3 sm:min-h-[22rem]",
            mode === "write" &&
              "hidden lg:block lg:max-h-[70vh] lg:overflow-y-auto",
          )}
        >
          {preview(value)}
        </div>
      </div>

      {menu ? (
        <div
          className="absolute z-30 flex flex-col overflow-hidden rounded-field border border-line bg-surface p-1 shadow-none"
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
                    "flex min-h-8 cursor-pointer items-center justify-between gap-3 rounded-[3px] px-2 text-[13px] pointer-coarse:min-h-11",
                    index === highlighted ? "bg-raised text-ink" : "text-muted",
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
}

function BodyModeSwitch({
  mode,
  onChange,
  className,
}: {
  mode: BodyMode;
  onChange: (mode: BodyMode) => void;
  className?: string;
}) {
  return (
    <div
      className={cn("flex shrink-0 items-center gap-1", className)}
      role="group"
      aria-label="Body mode"
    >
      {(["write", "preview"] as const).map((choice) => (
        <button
          key={choice}
          type="button"
          aria-pressed={mode === choice}
          className={cn(
            "label rounded-[3px] px-2 py-1 transition-colors hover:text-ink aria-pressed:bg-raised aria-pressed:text-ink pointer-coarse:min-h-11",
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
