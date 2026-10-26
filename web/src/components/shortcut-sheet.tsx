import { Dialog } from "@base-ui/react/dialog";

import { useHandedness } from "@/components/handedness";
import { SheetPopup, SheetViewport } from "@/components/ui/sheet";
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
    <div key="title">
      <Dialog.Title className="text-[17px] font-medium">Keyboard shortcuts</Dialog.Title>
      <Dialog.Description className="mt-1 text-[13px] text-muted">
        Plain keys are ignored while a field has focus; the palette and Escape still work.
      </Dialog.Description>
    </div>
  );
  const close = (
    <Dialog.Close
      key="close"
      className={cn(
        "label shrink-0 py-2 transition-colors hover:text-accent pointer-coarse:min-h-11",
        handedness === "left" ? "-ml-1" : "-mr-1",
      )}
    >
      Close
    </Dialog.Close>
  );

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-ground/85" />
        <SheetViewport>
          <SheetPopup className="sm:w-[34rem]">
            <div
              className={cn(
                "flex items-baseline gap-4 border-b rule px-4 py-3",
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
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <dl>
                {shortcuts.map((shortcut) => (
                  <div
                    key={shortcut.id}
                    className="flex items-baseline justify-between gap-4 border-b rule py-2 last:border-b-0"
                  >
                    <dt className="shrink-0">
                      <kbd className="rounded-[3px] border border-line bg-ground px-1.5 py-0.5 font-mono text-[11px] text-ink">
                        {shortcut.keys}
                      </kbd>
                    </dt>
                    <dd className="flex min-w-0 flex-1 items-baseline justify-between gap-3 text-[13px] text-muted">
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
