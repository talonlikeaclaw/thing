import { Popover } from "@base-ui/react/popover";
import { Smile, X } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/cn";
import { EMOJI_GROUPS, searchEmoji, type EmojiEntry } from "@/lib/emoji";

interface IconPickerProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  id?: string;
  hint?: string;
}

/**
 * A field-shaped button that opens a searchable emoji grid.
 *
 * The catalogue is local and small; the custom field accepts any other emoji.
 * The value is the raw string the server already stores as `icon`.
 */
export function IconPicker({ label, value, onChange, disabled, id, hint }: IconPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [custom, setCustom] = useState("");
  const fieldId = id ?? label.toLowerCase().replaceAll(" ", "-");
  const hintId = hint ? `${fieldId}-hint` : undefined;
  const results = searchEmoji(query, 64);
  const searching = query.trim() !== "";

  function choose(next: string) {
    onChange(next);
    setOpen(false);
  }

  return (
    <div className="grid gap-1.5">
      <span id={`${fieldId}-label`} className="label">
        {label}
      </span>
      <Popover.Root
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setQuery("");
            setCustom("");
          }
        }}
      >
        <Popover.Trigger
          id={fieldId}
          type="button"
          disabled={disabled}
          aria-labelledby={`${fieldId}-label`}
          aria-describedby={hintId}
          className={cn(
            "flex h-10 w-full items-center gap-2 rounded-field border border-line bg-ground px-2 text-left transition-colors hover:border-line-strong focus:border-accent disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:h-11",
          )}
        >
          {value ? (
            <span aria-hidden className="text-[20px] leading-none">
              {value}
            </span>
          ) : (
            <Smile aria-hidden size={18} className="text-muted" />
          )}
          <span className="truncate text-[13px] text-muted">
            {value ? "Change icon" : "Choose icon"}
          </span>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner sideOffset={4} className="z-50">
            <Popover.Popup
              aria-label="Emoji picker"
              className="w-[20rem] max-w-[calc(100vw-2rem)] rounded-field border border-line bg-surface p-2 shadow-none"
            >
              <input
                autoFocus
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
                className="h-9 w-full rounded-[4px] border border-line bg-ground px-2 text-[14px] text-ink focus:border-accent"
              />
              <div className="mt-2 max-h-64 overflow-auto">
                {searching ? (
                  results.length === 0 ? (
                    <p className="px-1 py-6 text-center text-[13px] text-muted">
                      No emoji match “{query.trim()}”. Use the field below.
                    </p>
                  ) : (
                    <Grid entries={results} current={value} onChoose={choose} />
                  )
                ) : (
                  EMOJI_GROUPS.map((group) => (
                    <section key={group.name} aria-label={group.name}>
                      <p className="label sticky top-0 bg-surface px-1 py-1">{group.name}</p>
                      <Grid entries={group.entries} current={value} onChoose={choose} />
                    </section>
                  ))
                )}
              </div>
              <div className="mt-2 grid gap-2 border-t border-line pt-2">
                <div className="flex items-center gap-2">
                  <input
                    value={custom}
                    onChange={(event) => setCustom(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        if (custom.trim()) {
                          choose(custom.trim());
                        }
                      }
                    }}
                    placeholder="Any other emoji"
                    aria-label="Any other emoji"
                    maxLength={8}
                    className="h-9 min-w-0 flex-1 rounded-[4px] border border-line bg-ground px-2 text-[14px] text-ink focus:border-accent"
                  />
                  <button
                    type="button"
                    disabled={!custom.trim()}
                    onClick={() => choose(custom.trim())}
                    className="h-9 rounded-[4px] border border-line px-3 text-[13px] transition-colors hover:border-line-strong disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Use
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => choose("")}
                  className="flex min-h-8 items-center gap-1.5 px-1 text-[13px] text-muted transition-colors hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!value}
                >
                  <X aria-hidden size={14} />
                  No icon
                </button>
              </div>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
      {hint ? (
        <p id={hintId} className="text-[13px] text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function Grid({
  entries,
  current,
  onChoose,
}: {
  entries: readonly EmojiEntry[];
  current: string;
  onChoose: (char: string) => void;
}) {
  return (
    <div className="grid grid-cols-8 gap-0.5">
      {entries.map((entry) => (
        <button
          key={`${entry.name}-${entry.char}`}
          type="button"
          title={entry.name}
          aria-label={entry.name}
          aria-pressed={entry.char === current}
          onClick={() => onChoose(entry.char)}
          className="flex h-9 w-full items-center justify-center rounded-[4px] text-[20px] leading-none transition-colors hover:bg-raised aria-pressed:bg-raised"
        >
          {entry.char}
        </button>
      ))}
    </div>
  );
}
