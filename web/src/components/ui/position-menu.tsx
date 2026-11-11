import { Menu } from "@base-ui/react/menu";
import { Check, ChevronDown } from "lucide-react";

import { useThumbHandedness } from "@/components/handedness";

const MENU_ITEM =
  "flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-[12px] text-ink hover:bg-[var(--color-accent-wash-hover)] focus:bg-[var(--color-accent-wash-hover)] focus:outline-none pointer-coarse:min-h-11";

const TRIGGER =
  "inline-flex h-9 shrink-0 items-center gap-1 rounded-full border border-line-strong/70 bg-surface px-1.5 font-mono text-[11px] text-ink transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:h-11 pointer-coarse:px-3";

interface PositionMenuProps {
  /** The row this control moves, named in its accessible label. */
  name: string;
  /** The current 1-based slot. */
  index: number;
  /** How many slots exist; the list offers `1..count`. */
  count: number;
  disabled: boolean;
  onMove: (position: number) => void;
}

/**
 * A row's slot as a list of every position it can take. The trigger keeps the
 * current number visible; choosing another slot moves the row in one write and
 * closes, so the target never moves between taps. Columns and type members
 * reorder through this one control.
 */
export function PositionMenu({
  name,
  index,
  count,
  disabled,
  onMove,
}: PositionMenuProps) {
  const handedness = useThumbHandedness();
  const positions = Array.from({ length: Math.max(count, 1) }, (_, at) => at + 1);
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={`Move ${name}: position ${index} of ${count}`}
        title={`Move ${name} to another position`}
        disabled={disabled}
        className={TRIGGER}
      >
        <span className="tnum">{index}</span>
        <ChevronDown aria-hidden size={11} className="text-faint" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          sideOffset={4}
          align={handedness === "left" ? "start" : "end"}
          className="z-50"
        >
          <Menu.Popup
            aria-label={`Move ${name}`}
            className="glass-strong max-h-[min(20rem,60vh)] min-w-[12rem] overflow-y-auto rounded-card p-1.5 text-ink outline-none"
          >
            {positions.map((position) => (
              <Menu.Item
                key={position}
                className={MENU_ITEM}
                onClick={() => onMove(position)}
              >
                <span aria-hidden className="w-3.5 shrink-0">
                  {position === index ? (
                    <Check aria-hidden size={13} className="text-accent" />
                  ) : null}
                </span>
                Move to position {position}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
