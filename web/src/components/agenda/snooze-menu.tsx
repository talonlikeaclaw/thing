import { Dialog } from "@base-ui/react/dialog";
import { Popover } from "@base-ui/react/popover";
import { AlarmClock } from "lucide-react";
import { useState } from "react";

import { useHandedness } from "@/components/handedness";
import {
  SheetCloseButton,
  SheetHeader,
  SheetPopup,
  SheetTitle,
  SheetViewport,
} from "@/components/ui/sheet";
import { cn } from "@/lib/cn";
import { useCompactWidth } from "@/lib/media";
import {
  MAX_SNOOZE_DAYS,
  parseSnoozeDays,
  SNOOZE_PRESETS,
  snoozeLabel,
} from "@/lib/schedule";

const TRIGGER =
  "inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-line-interactive/70 bg-raised/40 text-muted transition-colors hover:border-line-strong hover:bg-raised hover:text-ink disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:size-11";
const ROW =
  "flex min-h-10 w-full items-center rounded-[10px] px-2 text-left text-[13px] text-ink transition-colors hover:bg-raised pointer-coarse:min-h-11";
const SUBMIT =
  "inline-flex min-h-8 shrink-0 items-center justify-center rounded-full border border-line-interactive/70 bg-raised/40 px-3 text-[13px] text-ink transition-colors hover:border-line-strong disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:min-h-11";

/**
 * Puts one scheduled record off for a number of days.
 *
 * The alarm trigger opens a Base UI popover beside it on a fine pointer and the
 * app's sheet on a phone; both offer 1 day, 3 days and 1 week in one tap and a
 * bounded field for any other count. Snooze moves the due date, so the record
 * follows it in the List, the Calendar and the badge.
 */
export function SnoozeMenu({
  title,
  disabled = false,
  onSnooze,
}: {
  /** The record's title, for the labels a screen reader reads. */
  title: string;
  disabled?: boolean;
  onSnooze: (days: number) => void;
}) {
  const compact = useCompactWidth();
  const { handedness } = useHandedness();
  const [open, setOpen] = useState(false);
  const label = `Snooze “${title}”`;
  const trigger = <AlarmClock aria-hidden size={14} />;

  const apply = (days: number) => {
    setOpen(false);
    onSnooze(days);
  };

  if (!compact) {
    return (
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger
          aria-label={label}
          title="Snooze"
          disabled={disabled}
          className={TRIGGER}
        >
          {trigger}
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner
            sideOffset={4}
            align={handedness === "left" ? "start" : "end"}
            className="z-50"
          >
            <Popover.Popup className="w-[13.5rem] glass-strong rounded-card p-1.5">
              <SnoozeBody onSnooze={apply} />
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    );
  }

  const close = <SheetCloseButton label="Close snooze" />;
  const heading = (
    <SheetTitle className="min-w-0 flex-1 truncate">Snooze “{title}”</SheetTitle>
  );

  return (
    <>
      <button
        type="button"
        aria-label={label}
        title="Snooze"
        aria-expanded={open}
        aria-haspopup="dialog"
        disabled={disabled}
        className={TRIGGER}
        onClick={() => setOpen(true)}
      >
        {trigger}
      </button>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-40 scrim" />
          <SheetViewport>
            <SheetPopup className="sm:w-[26rem]">
              <SheetHeader
                className={cn(
                  "gap-[var(--space-3)]",
                  handedness === "left" ? "justify-start" : "justify-between",
                )}
              >
                {handedness === "left" ? (
                  <>
                    {close}
                    {heading}
                  </>
                ) : (
                  <>
                    {heading}
                    {close}
                  </>
                )}
              </SheetHeader>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-[var(--space-4)] py-[var(--space-3)] pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                <SnoozeBody onSnooze={apply} />
              </div>
            </SheetPopup>
          </SheetViewport>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

/** The presets and the bounded field, shared by the popover and the sheet. */
function SnoozeBody({ onSnooze }: { onSnooze: (days: number) => void }) {
  const [text, setText] = useState("2");
  const days = parseSnoozeDays(text);

  return (
    <div>
      <ul>
        {SNOOZE_PRESETS.map((preset) => (
          <li key={preset}>
            <button type="button" className={ROW} onClick={() => onSnooze(preset)}>
              {snoozeLabel(preset)}
            </button>
          </li>
        ))}
      </ul>
      <form
        className="mt-1 flex items-center gap-2 border-t rule pt-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (days !== undefined) {
            onSnooze(days);
          }
        }}
      >
        <label className="flex min-w-0 flex-1 items-center gap-2 text-[13px] text-muted">
          Days
          <input
            inputMode="numeric"
            autoComplete="off"
            aria-label="Days to snooze"
            value={text}
            onChange={(event) => setText(event.target.value)}
            className="min-h-8 w-16 rounded-field border border-line bg-transparent px-2 text-right font-mono text-[13px] tnum text-ink outline-none focus:border-line-strong pointer-coarse:min-h-11 pointer-coarse:text-base"
          />
        </label>
        <button type="submit" className={SUBMIT} disabled={days === undefined}>
          Snooze
        </button>
      </form>
      <p className="mt-1 font-mono text-[11px] text-faint">
        Between 1 and {MAX_SNOOZE_DAYS} days.
      </p>
    </div>
  );
}
