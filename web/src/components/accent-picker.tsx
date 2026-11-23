import { useRef } from "react";

import { ACCENTS, type AccentId } from "@/lib/accent";
import { cn } from "@/lib/cn";

interface AccentPickerProps {
  value: AccentId;
  onChange: (id: AccentId) => void;
  /** Id of the heading that names this group. */
  labelledBy: string;
  /** Non-owners see the shared preset without being able to change it. */
  disabled?: boolean;
}

/**
 * A six-option radio group for the space's shared highlight accent.
 *
 * Each option is a small room: the ground, a pane of glass and the accent
 * chip, drawn entirely from the tokens that `data-accent` resolves inside the
 * tile. The colour name is always visible: the preview is an aid, never the
 * only signal. Arrow keys move and select, and the selected option keeps the
 * roving tab stop. A change writes immediately — there is no Save button here.
 */
export function AccentPicker({ value, onChange, labelledBy, disabled = false }: AccentPickerProps) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);

  function move(from: number, delta: number) {
    if (disabled) {
      return;
    }
    const next = (from + delta + ACCENTS.length) % ACCENTS.length;
    const accent = ACCENTS[next];
    if (!accent) {
      return;
    }
    onChange(accent.id);
    buttons.current[next]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      aria-disabled={disabled}
      className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3"
    >
      {ACCENTS.map((accent, index) => {
        const checked = accent.id === value;
        return (
          <button
            key={accent.id}
            ref={(node) => {
              buttons.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            disabled={disabled}
            tabIndex={disabled ? -1 : checked ? 0 : -1}
            onClick={() => onChange(accent.id)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                event.preventDefault();
                move(index, 1);
              } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                event.preventDefault();
                move(index, -1);
              } else if (event.key === "Home") {
                event.preventDefault();
                move(index, -index);
              } else if (event.key === "End") {
                event.preventDefault();
                move(index, ACCENTS.length - 1 - index);
              }
            }}
            className={cn(
              "flex min-h-11 items-center gap-3 rounded-field px-2 py-2 text-left transition-colors pointer-coarse:min-h-12",
              checked ? "text-accent" : "text-muted hover:text-ink",
              disabled && "cursor-default opacity-70",
            )}
          >
            <span
              aria-hidden
              data-accent={accent.id}
              className={cn(
                "flex size-12 shrink-0 flex-col justify-end gap-1 rounded-[9px] bg-ground p-1.5",
                checked && "ring-2 ring-accent ring-offset-2 ring-offset-ground",
              )}
            >
              <span className="h-1.5 w-full rounded-full bg-accent" />
              <span className="h-3 w-full rounded-[4px] bg-glass" />
            </span>
            <span className="text-[13px]">{accent.label}</span>
          </button>
        );
      })}
    </div>
  );
}
