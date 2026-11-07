import { Dialog } from "@base-ui/react/dialog";
import { Popover } from "@base-ui/react/popover";
import { Filter } from "lucide-react";
import { useState } from "react";

import type { TypeSummary } from "@/api/types";
import { AGENDA_SEGMENT, AGENDA_TOOLBAR } from "@/components/agenda/toolbar";
import { ThumbRow, useThumbHandedness } from "@/components/handedness";
import { ThingIcon } from "@/components/thing-icon";
import {
  SheetCloseButton,
  SheetHeader,
  SheetPopup,
  SheetTitle,
  SheetViewport,
} from "@/components/ui/sheet";
import { normalizeAgendaTypes } from "@/lib/agenda";
import { cn } from "@/lib/cn";
import { useCompactWidth } from "@/lib/media";

/** The filter is its own pill: the frame gives it the range switch's height. */
const TRIGGER = cn(AGENDA_SEGMENT, "gap-2");
const ROW =
  "min-h-10 w-full items-center gap-2.5 rounded-[10px] px-2 text-left text-[13px] text-ink transition-colors hover:bg-raised pointer-coarse:min-h-11";

/** The Filter trigger plus a checkbox list of the space's scheduled types. */
export function TypeFilter({
  types,
  selected,
  onChange,
}: {
  types: readonly TypeSummary[];
  /** The active keys; empty means every scheduled type. */
  selected: readonly string[];
  onChange: (types: string[]) => void;
}) {
  const compact = useCompactWidth();
  const handedness = useThumbHandedness();
  const [open, setOpen] = useState(false);
  const count = selected.length;
  const label = count > 0 ? `Filter, ${count} type${count === 1 ? "" : "s"}` : "Filter";
  const trigger = (
    <>
      <Filter aria-hidden size={13} />
      Filter
      {count > 0 ? (
        <span className="font-mono text-[11px] tnum text-ink">{count}</span>
      ) : null}
    </>
  );

  const body = (
    <TypeFilterList types={types} selected={selected} onChange={onChange} />
  );

  if (!compact) {
    return (
      <div className={cn(AGENDA_TOOLBAR, "shrink-0")}>
        <Popover.Root>
          <Popover.Trigger aria-label={label} className={cn(TRIGGER, count > 0 && "text-ink")}>
            {trigger}
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Positioner
              sideOffset={4}
              align={handedness === "left" ? "start" : "end"}
              className="z-50"
            >
              <Popover.Popup className="w-[15rem] glass-strong rounded-card p-1.5">
                {body}
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
      </div>
    );
  }

  const close = <SheetCloseButton label="Close filter" />;
  const title = (
    <SheetTitle className="min-w-0 flex-1 truncate">Filter the schedule</SheetTitle>
  );

  return (
    <>
      <div className={cn(AGENDA_TOOLBAR, "shrink-0")}>
        <button
          type="button"
          aria-label={label}
          aria-expanded={open}
          aria-haspopup="dialog"
          className={cn(TRIGGER, count > 0 && "text-ink")}
          onClick={() => setOpen(true)}
        >
          {trigger}
        </button>
      </div>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-40 scrim" />
          <SheetViewport>
            <SheetPopup className="sm:w-[34rem]">
              <SheetHeader
                className={cn(
                  "gap-[var(--space-3)]",
                  handedness === "left" ? "justify-start" : "justify-between",
                )}
              >
                {handedness === "left" ? (
                  <>
                    {close}
                    {title}
                  </>
                ) : (
                  <>
                    {title}
                    {close}
                  </>
                )}
              </SheetHeader>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-[var(--space-4)] py-[var(--space-3)] pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                {body}
              </div>
            </SheetPopup>
          </SheetViewport>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

function TypeFilterList({
  types,
  selected,
  onChange,
}: {
  types: readonly TypeSummary[];
  selected: readonly string[];
  onChange: (types: string[]) => void;
}) {
  return (
    <div>
      <ul>
        {types.map((type) => {
          const checked = selected.includes(type.key);
          return (
            <li key={type.key}>
              <label className="block">
                <ThumbRow className={ROW}>
                  <span className="flex min-w-0 flex-1 items-center gap-2.5">
                    <ThingIcon icon={type.icon} name={type.name} size="sm" />
                    <span className="min-w-0 truncate">{type.name}</span>
                  </span>
                  <input
                    type="checkbox"
                    className="h-4 w-4 shrink-0 accent-accent"
                    checked={checked}
                    onChange={() =>
                      onChange(
                        normalizeAgendaTypes(
                          checked
                            ? selected.filter((key) => key !== type.key)
                            : [...selected, type.key],
                        ),
                      )
                    }
                  />
                </ThumbRow>
              </label>
            </li>
          );
        })}
      </ul>
      <ThumbRow className="mt-1 items-center justify-between gap-2 border-t rule pt-1">
        <button
          type="button"
          className="label min-h-8 rounded-[8px] px-2 text-muted transition-colors hover:bg-raised hover:text-ink pointer-coarse:min-h-11"
          onClick={() => onChange(types.map((type) => type.key))}
        >
          All scheduled types
        </button>
        <button
          type="button"
          className="label min-h-8 rounded-[8px] px-2 text-muted transition-colors hover:bg-raised hover:text-ink disabled:text-faint pointer-coarse:min-h-11"
          disabled={selected.length === 0}
          onClick={() => onChange([])}
        >
          Clear
        </button>
      </ThumbRow>
    </div>
  );
}

/** The empty-state action both Schedule views show under an active filter. */
export function ClearFilterButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="mt-3 inline-flex min-h-10 w-fit items-center rounded-full border border-line-interactive/70 bg-raised/40 px-4 text-sm text-ink transition-colors hover:border-line-strong pointer-coarse:min-h-11"
      onClick={onClick}
    >
      Clear filter
    </button>
  );
}
