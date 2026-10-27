import { Dialog } from "@base-ui/react/dialog";
import { Popover } from "@base-ui/react/popover";
import { Smile, SmilePlus, X } from "lucide-react";
import { useRef, useState } from "react";

import { useHandedness } from "@/components/handedness";
import { SheetPopup, SheetViewport } from "@/components/ui/sheet";
import { cn } from "@/lib/cn";
import { EMOJI_GROUPS, searchEmoji, type EmojiEntry } from "@/lib/emoji";
import { useCoarsePointer, useCompactWidth } from "@/lib/media";

interface IconPickerProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  id?: string;
  hint?: string;
  /**
   * `compact` is the record header's inline trigger (a square once an emoji is
   * set, a dashed "Add icon" chip before that); `glyph` is the same square
   * before an emoji exists, for a row where the text would cost the field its
   * width; `field` is a form field.
   */
  variant?: "field" | "compact" | "glyph";
}

/**
 * A field-shaped button that opens a searchable emoji grid.
 *
 * Above 640 px on a fine pointer this is the anchored popover it has always
 * been. A phone, or any coarse pointer, gets a bottom sheet on the same
 * visual-viewport geometry as every other overlay: a popover next to a 32 px
 * glyph has nowhere to go, and with the keyboard up it is mostly behind it.
 *
 * The sheet focuses its own panel, not the search field, so opening it from a
 * half-typed title drops the keyboard and lets the grid use the screen. The
 * catalogue is local and small; the custom field accepts any other emoji. The
 * value is the raw string the server already stores as `icon`.
 */
export function IconPicker({
  label,
  value,
  onChange,
  disabled,
  id,
  hint,
  variant = "field",
}: IconPickerProps) {
  const [open, setOpen] = useState(false);
  const compact = useCompactWidth();
  const coarse = useCoarsePointer();
  const sheet = compact || coarse;
  const { handedness } = useHandedness();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const fieldId = id ?? label.toLowerCase().replaceAll(" ", "-");
  const hintId = hint ? `${fieldId}-hint` : undefined;

  function choose(next: string) {
    onChange(next);
    setOpen(false);
  }

  function handleOpenChange(next: boolean) {
    if (next) {
      // The sheet's own restore declines elements inside another sheet (the
      // capture trigger is inside one), so the trigger is captured here.
      returnFocusRef.current = triggerRef.current;
    }
    setOpen(next);
  }

  const compactTrigger = variant === "compact";
  const glyph = variant === "glyph";
  const square = compactTrigger || glyph;

  const triggerProps = {
    id: fieldId,
    ref: triggerRef,
    type: "button" as const,
    disabled,
    "aria-label": square ? `${value ? "Change" : "Add"} ${label.toLowerCase()}` : undefined,
    "aria-labelledby": square ? undefined : `${fieldId}-label`,
    "aria-describedby": hintId,
    title: square ? (value ? "Change icon" : "Add icon") : undefined,
    className: cn(
      square
        ? value
          ? "flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px] text-[20px] leading-none transition-colors hover:bg-raised aria-expanded:bg-raised disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:h-11 pointer-coarse:w-11"
          : glyph
            ? "flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px] border border-dashed border-line-interactive text-muted transition-colors hover:border-line-strong hover:text-ink aria-expanded:border-line-strong disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:h-11 pointer-coarse:w-11"
            : "flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-[4px] border border-dashed border-line-interactive px-1.5 text-[12px] text-muted transition-colors hover:border-line-strong hover:text-ink aria-expanded:border-line-strong disabled:cursor-not-allowed disabled:opacity-50 max-sm:w-full sm:justify-start pointer-coarse:h-11 pointer-coarse:px-2"
        : "flex h-10 w-full items-center gap-2 rounded-field border border-line-interactive bg-ground px-2 text-left transition-colors hover:border-line-strong focus:border-accent disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:h-11",
    ),
  };

  const triggerContent = (
    <>
      {value ? (
        <span aria-hidden className="text-[20px] leading-none">
          {value}
        </span>
      ) : compactTrigger ? (
        <>
          <SmilePlus aria-hidden size={16} className="shrink-0" />
          <span className="whitespace-nowrap">Add icon</span>
        </>
      ) : (
        <Smile aria-hidden size={18} className="shrink-0 text-muted" />
      )}
      {square ? null : (
        <span className="truncate text-[13px] text-muted">
          {value ? "Change icon" : "Choose icon"}
        </span>
      )}
    </>
  );

  const panel = (
    <EmojiPanel
      value={value}
      onChoose={choose}
      autoFocus={!sheet}
      layout={sheet ? "sheet" : "popover"}
      handedness={handedness}
    />
  );

  return (
    <div className={compactTrigger ? "max-sm:w-full sm:w-auto" : glyph ? "" : "grid gap-1.5"}>
      {square ? null : (
        <span id={`${fieldId}-label`} className="label">
          {label}
        </span>
      )}
      {sheet ? (
        <Dialog.Root open={open} onOpenChange={handleOpenChange}>
          <Dialog.Trigger {...triggerProps}>{triggerContent}</Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Backdrop className="fixed inset-0 z-40 bg-ground/85" />
            <SheetViewport>
              <SheetPopup
                ref={popupRef}
                className="sm:w-[24rem]"
                initialFocus={() => popupRef.current ?? true}
                finalFocus={() => returnFocusRef.current ?? false}
              >
                {panel}
              </SheetPopup>
            </SheetViewport>
          </Dialog.Portal>
        </Dialog.Root>
      ) : (
        <Popover.Root open={open} onOpenChange={handleOpenChange}>
          <Popover.Trigger {...triggerProps}>{triggerContent}</Popover.Trigger>
          <Popover.Portal>
            <Popover.Positioner sideOffset={4} className="z-50">
              <Popover.Popup
                aria-label="Emoji picker"
                className="w-[20rem] max-w-[calc(100vw-2rem)] rounded-field border border-line bg-surface p-2 shadow-none"
              >
                {panel}
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
      )}
      {hint && !square ? (
        <p id={hintId} className="text-[13px] text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

interface EmojiPanelProps {
  value: string;
  onChoose: (char: string) => void;
  /** The popover raises the keyboard on open; the sheet must not. */
  autoFocus: boolean;
  layout: "popover" | "sheet";
  handedness: "left" | "right";
}

/**
 * The picker's content, with no positioning of its own. `layout` changes only
 * sizing: the sheet fills its popup's flex column and lets the grid give up
 * height, the popover keeps its fixed 64-result cap.
 */
function EmojiPanel({
  value,
  onChoose,
  autoFocus,
  layout,
  handedness,
}: EmojiPanelProps) {
  const [query, setQuery] = useState("");
  const [custom, setCustom] = useState("");
  const results = searchEmoji(query, 64);
  const searching = query.trim() !== "";
  const sheet = layout === "sheet";

  const search = (
    <input
      autoFocus={autoFocus}
      value={query}
      onChange={(event) => setQuery(event.target.value)}
      onKeyDown={(event) => {
        // Enter in a search box must not submit the surrounding form.
        if (event.key === "Enter") {
          event.preventDefault();
        }
      }}
      placeholder="Search emoji"
      aria-label="Search emoji"
      className={cn(
        "w-full rounded-[4px] border border-line-interactive bg-ground px-2 text-[14px] text-ink focus:border-accent pointer-coarse:text-[16px]",
        sheet ? "h-11 min-w-0 flex-1" : "h-9",
      )}
    />
  );

  const close = (
    <Dialog.Close
      key="close"
      aria-label="Close icon picker"
      className={cn(
        "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[4px] text-faint transition-colors hover:bg-raised hover:text-ink",
        handedness === "left" ? "-ml-2" : "-mr-2",
      )}
    >
      <X aria-hidden size={16} />
    </Dialog.Close>
  );

  const groups = searching ? (
    results.length === 0 ? (
      <p className="px-1 py-6 text-center text-[13px] text-muted">
        No emoji match “{query.trim()}”. Use the field below.
      </p>
    ) : (
      <Grid entries={results} current={value} onChoose={onChoose} layout={layout} />
    )
  ) : (
    EMOJI_GROUPS.map((group) => (
      <section key={group.name} aria-label={group.name}>
        <p className="label sticky top-0 bg-surface px-1 py-1">{group.name}</p>
        <Grid entries={group.entries} current={value} onChoose={onChoose} layout={layout} />
      </section>
    ))
  );

  const footer = (
    <>
      <div className="flex items-center gap-2">
        <input
          value={custom}
          onChange={(event) => setCustom(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              if (custom.trim()) {
                onChoose(custom.trim());
              }
            }
          }}
          placeholder="Any other emoji"
          aria-label="Any other emoji"
          maxLength={8}
          className="h-9 min-w-0 flex-1 rounded-[4px] border border-line-interactive bg-ground px-2 text-[14px] text-ink focus:border-accent pointer-coarse:h-11 pointer-coarse:text-[16px]"
        />
        <button
          type="button"
          disabled={!custom.trim()}
          onClick={() => onChoose(custom.trim())}
          className="h-9 rounded-[4px] border border-line px-3 text-[13px] transition-colors hover:border-line-strong disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:h-11"
        >
          Use
        </button>
      </div>
      <button
        type="button"
        onClick={() => onChoose("")}
        className="flex min-h-8 items-center gap-1.5 px-1 text-[13px] text-muted transition-colors hover:text-accent disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:min-h-11"
        disabled={!value}
      >
        <X aria-hidden size={14} />
        No icon
      </button>
    </>
  );

  if (!sheet) {
    return (
      <>
        {search}
        <div className="mt-2 max-h-64 overflow-auto">{groups}</div>
        <div className="mt-2 grid gap-2 border-t border-line pt-2">{footer}</div>
      </>
    );
  }

  return (
    <div className="flex min-h-0 flex-col">
      <Dialog.Title className="sr-only">Choose an icon</Dialog.Title>
      <div className="flex shrink-0 items-center gap-2 px-4 pt-3">
        {handedness === "left" ? (
          <>
            {close}
            {search}
          </>
        ) : (
          <>
            {search}
            {close}
          </>
        )}
      </div>
      <div className="mt-2 min-h-0 flex-1 overflow-y-auto overscroll-contain px-4">{groups}</div>
      <div className="sheet-footer mt-2 grid shrink-0 gap-2 border-t border-line px-4 pt-2">
        {footer}
      </div>
    </div>
  );
}

function Grid({
  entries,
  current,
  onChoose,
  layout,
}: {
  entries: readonly EmojiEntry[];
  current: string;
  onChoose: (char: string) => void;
  layout: "popover" | "sheet";
}) {
  const sheet = layout === "sheet";
  return (
    <div
      className={cn(
        "grid gap-0.5",
        sheet
          ? "grid-cols-[repeat(auto-fill,minmax(2.75rem,1fr))]"
          : "grid-cols-8 pointer-coarse:grid-cols-7",
      )}
    >
      {entries.map((entry) => (
        <button
          key={`${entry.name}-${entry.char}`}
          type="button"
          title={entry.name}
          aria-label={entry.name}
          aria-pressed={entry.char === current}
          onClick={() => onChoose(entry.char)}
          className={cn(
            "flex items-center justify-center rounded-[4px] text-[20px] leading-none transition-colors hover:bg-raised aria-pressed:bg-raised",
            sheet ? "h-11 w-full min-w-11" : "h-9 w-full min-w-8 pointer-coarse:h-11 pointer-coarse:min-w-11",
          )}
        >
          {entry.char}
        </button>
      ))}
    </div>
  );
}
