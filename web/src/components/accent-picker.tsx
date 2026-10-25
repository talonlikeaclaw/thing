import { Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";

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

/** `prefers-color-scheme`, so a swatch shows the hue this screen will use. */
function useLightScheme(): boolean {
  const query = "(prefers-color-scheme: light)";
  const [light, setLight] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const media = window.matchMedia(query);
    const sync = () => setLight(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  return light;
}

/**
 * A six-option radio group for the space's shared highlight accent.
 *
 * The colour name is always visible: the swatch is an aid, never the only
 * signal. Arrow keys move and select, and the selected option keeps the roving
 * tab stop. A change writes immediately — there is no Save button here.
 */
export function AccentPicker({ value, onChange, labelledBy, disabled = false }: AccentPickerProps) {
  const light = useLightScheme();
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
        const scheme = light ? accent.light : accent.dark;
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
              "flex min-h-11 items-center gap-3 rounded-field border px-3 py-2 text-left transition-colors pointer-coarse:min-h-12",
              checked
                ? "border-accent bg-raised"
                : "border-line hover:border-line-strong",
              disabled && "cursor-default opacity-70 hover:border-line",
            )}
          >
            <span
              aria-hidden
              className="size-11 shrink-0 rounded-[4px] border border-line"
              style={{ backgroundColor: scheme.accent, borderColor: scheme.accent }}
            />
            <span className="flex min-w-0 items-center gap-1.5 text-[14px]">
              <span className="truncate">{accent.label}</span>
              {checked ? <Check aria-hidden size={13} className="shrink-0 text-accent" /> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
