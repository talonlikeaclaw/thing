import type { ReactNode } from "react";

import { AGENDA_SEGMENT, AGENDA_TOOLBAR } from "@/components/agenda/toolbar";
import { cn } from "@/lib/cn";

/**
 * The one segmented switch the dated pages share: the Schedule's range, the
 * Calendar's shape, and anything else that is a small exclusive set. The frame
 * supplies the height so a switch never sits taller than the pill beside it,
 * and `stretch` gives every segment an equal share of a phone row.
 */
export function AgendaSwitch<T extends string | number>({
  label,
  value,
  options,
  onChange,
  stretch = false,
}: {
  /** The group's accessible name: `Horizon`, `View`. */
  label: string;
  value: T;
  options: readonly {
    value: T;
    label: ReactNode;
    /** The button's own name, when the visible word is not enough. */
    name?: string;
  }[];
  onChange: (value: T) => void;
  /** A phone gives the switch the whole row, its segments sharing it. */
  stretch?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(AGENDA_TOOLBAR, stretch && "w-full basis-full")}
    >
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          aria-pressed={value === option.value}
          aria-label={option.name}
          className={cn(AGENDA_SEGMENT, stretch && "flex-1")}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
