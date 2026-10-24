import { useEffect, useRef, useState } from "react";

import { ACCENTS, type AccentId } from "@/lib/accent";
import { cn } from "@/lib/cn";

interface AccentPickerProps {
  value: AccentId;
  onChange: (id: AccentId) => void;
  /** Id of the heading that names this group. */
  labelledBy: string;
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
 * A six-option radio group for the browser-local highlight accent.
 *
 * The colour name is always visible: the swatch is an aid, never the only
 * signal. Arrow keys move and select, and the selected option keeps the roving
 * tab stop. Immediate apply — there is no Save button here.
 */
export function AccentPicker({ value, onChange, labelledBy }: AccentPickerProps) {
  const light = useLightScheme();
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);

  function move(from: number, delta: number) {
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
            tabIndex={checked ? 0 : -1}
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
            )}
          >
            <span
              aria-hidden
              className="size-11 shrink-0 rounded-[4px] border border-line"
              style={{ backgroundColor: scheme.accent, borderColor: scheme.accent }}
            />
            <span className="grid gap-0.5">
              <span className="text-[14px]">{accent.label}</span>
              <span className="label">{checked ? "selected" : " "}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
