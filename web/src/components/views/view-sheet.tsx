import { Dialog } from "@base-ui/react/dialog";
import {
  ArrowUpDown,
  Columns3,
  FileSpreadsheet,
  Plus,
  Settings2,
} from "lucide-react";
import type { ReactNode } from "react";

import { useThumbHandedness } from "@/components/handedness";
import { SheetCloseButton, SheetPopup, SheetViewport } from "@/components/ui/sheet";
import { cn } from "@/lib/cn";

/** Every surface the phone's one View sheet can show. */
export type ViewSheetPanel = "menu" | "sort" | "columns" | "settings" | "save" | "data";

interface ViewSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  panel: ViewSheetPanel;
  onPanelChange: (panel: ViewSheetPanel) => void;
  canEdit: boolean;
  /** The active sort and column counts, printed on the menu rows. */
  counts: { sorts: number; columns: number };
  /** The body for each sub-panel; the menu is the sheet's own list. */
  panels: Partial<Record<Exclude<ViewSheetPanel, "menu">, ReactNode>>;
}

const TITLES: Record<ViewSheetPanel, string> = {
  menu: "View",
  sort: "Sort",
  columns: "Columns",
  settings: "View settings",
  save: "Save as view",
  data: "Data — CSV",
};

const ROW =
  "flex w-full items-center gap-3 rounded-[12px] px-3 py-2.5 text-left text-[14px] text-ink transition-colors hover:bg-raised/60 pointer-coarse:min-h-11";

/**
 * The phone's one View sheet: Sort, Columns, view settings, save-as and data,
 * each swapping the same sheet's body behind a Back control. The toolbar keeps
 * Search, Filter and View only; the counts on the Sort and Columns rows are the
 * toolbar badges the wide layout wears.
 */
export function ViewSheet({
  open,
  onOpenChange,
  panel,
  onPanelChange,
  canEdit,
  counts,
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
    <SheetCloseButton label={`Close ${TITLES[panel].toLowerCase()}`} />
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
                "flex items-center gap-4 border-b rule px-4 py-3",
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
                  <button
                    type="button"
                    className={ROW}
                    aria-label={counts.sorts > 0 ? `Sort, ${counts.sorts}` : "Sort"}
                    onClick={() => onPanelChange("sort")}
                  >
                    <ArrowUpDown aria-hidden size={16} className="text-faint" />
                    <span className="flex-1">Sort</span>
                    {counts.sorts > 0 ? (
                      <span className="tnum rounded-full bg-accent-wash px-1.5 font-mono text-[11px] text-accent-on-wash">
                        {counts.sorts}
                      </span>
                    ) : null}
                  </button>
                  {canEdit ? (
                    <button
                      type="button"
                      className={ROW}
                      aria-label={`Columns, ${counts.columns}`}
                      onClick={() => onPanelChange("columns")}
                    >
                      <Columns3 aria-hidden size={16} className="text-faint" />
                      <span className="flex-1">Columns</span>
                      <span className="tnum rounded-full bg-accent-wash px-1.5 font-mono text-[11px] text-accent-on-wash">
                        {counts.columns}
                      </span>
                    </button>
                  ) : null}
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
