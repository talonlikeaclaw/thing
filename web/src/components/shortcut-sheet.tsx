import { Dialog } from "@base-ui/react/dialog";

import { useHandedness } from "@/components/handedness";
import {
  SheetCloseButton,
  SheetHeader,
  SheetPopup,
  SheetTitle,
  SheetViewport,
} from "@/components/ui/sheet";
import { cn } from "@/lib/cn";
import type { ShortcutDescriptor } from "@/lib/hotkeys";

interface ShortcutSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Only the bindings the current route actually registers. */
  shortcuts: ShortcutDescriptor[];
}

/** The `?` overlay: one keyed list of every active shortcut. */
export function ShortcutSheet({ open, onOpenChange, shortcuts }: ShortcutSheetProps) {
  const { handedness } = useHandedness();
  const title = (
    <div className="min-w-0 flex-1">
      <SheetTitle>Keyboard shortcuts</SheetTitle>
      <Dialog.Description className="mt-1 text-[length:var(--text-small)] leading-[var(--text-small--line-height)] text-muted">
        Plain keys are ignored while a field has focus; the palette and Escape still work.
      </Dialog.Description>
    </div>
  );
  const close = <SheetCloseButton label="Close keyboard shortcuts" />;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-ground/85" />
        <SheetViewport>
          <SheetPopup className="sm:w-[34rem]">
            <SheetHeader
              className={cn(
                "gap-[var(--space-4)]",
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

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-[var(--space-4)] pt-[var(--space-3)] pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <dl>
                {shortcuts.map((shortcut) => (
                  <div
                    key={shortcut.id}
                    className="grid grid-cols-1 items-baseline gap-1 border-b rule py-2.5 last:border-b-0 sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-[var(--space-4)]"
                  >
                    <dt>
                      <kbd className="rounded-[3px] border border-line bg-ground px-1.5 py-0.5 font-mono text-[length:var(--text-label)] text-ink">
                        {shortcut.keys}
                      </kbd>
                    </dt>
                    <dd className="flex min-w-0 items-baseline justify-between gap-3 text-[length:var(--text-small)] leading-[var(--text-small--line-height)] text-muted">
                      <span>{shortcut.label}</span>
                      <span className="label shrink-0">{shortcut.scope}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </SheetPopup>
        </SheetViewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
