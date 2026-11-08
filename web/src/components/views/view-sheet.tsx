import { Dialog } from "@base-ui/react/dialog";
import { FileSpreadsheet, Plus, Settings2 } from "lucide-react";
import type { ReactNode } from "react";

import { useThumbHandedness } from "@/components/handedness";
import { SheetPopup, SheetViewport } from "@/components/ui/sheet";
import { cn } from "@/lib/cn";

/** Every surface the phone's one More sheet can show. Sort and Columns have their own triggers. */
export type ViewSheetPanel = "menu" | "settings" | "save" | "data";

interface ViewSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  panel: ViewSheetPanel;
  onPanelChange: (panel: ViewSheetPanel) => void;
  canEdit: boolean;
  /** The body for each sub-panel; the menu is the sheet's own list. */
  panels: Partial<Record<Exclude<ViewSheetPanel, "menu">, ReactNode>>;
}

const TITLES: Record<ViewSheetPanel, string> = {
  menu: "More",
  settings: "View settings",
  save: "Save as view",
  data: "Data — CSV",
};

const ROW =
  "flex w-full items-center gap-3 rounded-[12px] px-3 py-2.5 text-left text-[14px] text-ink transition-colors hover:bg-raised/60 pointer-coarse:min-h-11";

/**
 * The phone's More sheet: view settings, save-as and data, each swapping the
 * same sheet's body. Sort and Columns are their own toolbar triggers, so
 * nothing a user reaches for daily hides behind this menu. The header keeps a
 * Back control and a Close target.
 */
export function ViewSheet({
  open,
  onOpenChange,
  panel,
  onPanelChange,
  canEdit,
  panels,
}: ViewSheetProps) {
  const handedness = useThumbHandedness();
  const back = (
    <button
      type="button"
      className={cn(
        "label shrink-0 py-2 transition-colors hover:text-accent pointer-coarse:min-h-11",
        handedness === "left" ? "-ml-1" : "-mr-1",
      )}
      onClick={() => onPanelChange("menu")}
    >
      Back
    </button>
  );
  const close = (
    <Dialog.Close
      className={cn(
        "label shrink-0 py-2 transition-colors hover:text-accent pointer-coarse:min-h-11",
        handedness === "left" ? "-ml-1" : "-mr-1",
      )}
    >
      Close
    </Dialog.Close>
  );
  const title = (
    <Dialog.Title key="title" className="min-w-0 flex-1 truncate text-[17px] font-medium">
      {TITLES[panel]}
    </Dialog.Title>
  );

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 scrim" />
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
                  <span className="flex shrink-0 items-baseline gap-3">
                    {close}
                    {panel === "menu" ? null : back}
                  </span>
                  {title}
                </>
              ) : (
                <>
                  {title}
                  <span className="flex shrink-0 items-baseline gap-3">
                    {panel === "menu" ? null : back}
                    {close}
                  </span>
                </>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              {panel === "menu" ? (
                <div className="flex flex-col gap-1" aria-label="View actions">
                  {canEdit ? (
                    <button
                      type="button"
                      className={ROW}
                      onClick={() => onPanelChange("settings")}
                    >
                      <Settings2 aria-hidden size={16} className="text-faint" />
                      View settings
                    </button>
                  ) : null}
                  {canEdit ? (
                    <button
                      type="button"
                      className={ROW}
                      onClick={() => onPanelChange("save")}
                    >
                      <Plus aria-hidden size={16} className="text-faint" />
                      Save as view…
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={ROW}
                    onClick={() => onPanelChange("data")}
                  >
                    <FileSpreadsheet aria-hidden size={16} className="text-faint" />
                    Data — CSV
                  </button>
                </div>
              ) : null}

              {panel === "menu" ? null : <div>{panels[panel] ?? null}</div>}
            </div>
          </SheetPopup>
        </SheetViewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
