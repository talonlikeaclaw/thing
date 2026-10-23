import { Dialog } from "@base-ui/react/dialog";

interface ShortcutSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const SHORTCUTS: { keys: string; description: string; scope: string }[] = [
  { keys: "⌘K / Ctrl K", description: "Open the command palette", scope: "Global" },
  { keys: "c", description: "Capture a record", scope: "Global" },
  { keys: "?", description: "Show this shortcut sheet", scope: "Global" },
  { keys: "Esc", description: "Close the open overlay", scope: "Global" },
  { keys: "/", description: "Focus the table's search field", scope: "Table" },
  { keys: "j / k", description: "Move to the next or previous row", scope: "Table" },
  { keys: "x", description: "Select or clear the active row", scope: "Table" },
  { keys: "Enter", description: "Open the active row", scope: "Table" },
  { keys: "⌘S / Ctrl S", description: "Save the current view", scope: "Table" },
];

/** The `?` overlay: one keyed list of every shortcut the app owns. */
export function ShortcutSheet({ open, onOpenChange }: ShortcutSheetProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-ground/85" />
        <Dialog.Viewport className="fixed inset-0 z-50 flex items-end justify-center sm:items-start sm:px-4 sm:pt-[12vh]">
          <Dialog.Popup className="flex max-h-[85dvh] w-full flex-col overflow-hidden rounded-t-sheet border border-line bg-surface sm:w-[34rem] sm:rounded-sheet">
            <div className="flex items-baseline justify-between gap-4 border-b rule px-4 py-3">
              <div>
                <Dialog.Title className="text-[17px] font-medium">Keyboard shortcuts</Dialog.Title>
                <Dialog.Description className="mt-1 text-[13px] text-muted">
                  Plain keys are ignored while a field has focus; the palette and Escape still
                  work.
                </Dialog.Description>
              </div>
              <Dialog.Close className="label shrink-0 py-2 transition-colors hover:text-accent pointer-coarse:min-h-11">
                Close
              </Dialog.Close>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              <dl>
                {SHORTCUTS.map((shortcut) => (
                  <div
                    key={`${shortcut.scope}:${shortcut.keys}`}
                    className="flex items-baseline justify-between gap-4 border-b rule py-2 last:border-b-0"
                  >
                    <dt className="shrink-0">
                      <kbd className="rounded-[3px] border border-line bg-ground px-1.5 py-0.5 font-mono text-[11px] text-ink">
                        {shortcut.keys}
                      </kbd>
                    </dt>
                    <dd className="flex min-w-0 flex-1 items-baseline justify-between gap-3 text-[13px] text-muted">
                      <span>{shortcut.description}</span>
                      <span className="label shrink-0">{shortcut.scope}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
