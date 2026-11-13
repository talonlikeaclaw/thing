import { Dialog } from "@base-ui/react/dialog";
import {
  ArrowUpDown,
  Columns3,
  FileSpreadsheet,
  Plus,
  Settings2,
} from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

import type { ViewKind } from "@/api/types";
import { useThumbHandedness } from "@/components/handedness";
import {
  SheetCloseButton,
  SheetPopup,
  SheetTitle,
  SheetViewport,
} from "@/components/ui/sheet";
import { viewKindIcon, viewKindLabel } from "@/components/views/view-tabs";
import { cn } from "@/lib/cn";

/** Every surface the one View sheet can show. */
export type ViewSheetPanel = "columns" | "sort" | "settings" | "save" | "data";

interface ViewSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  panel: ViewSheetPanel;
  onPanelChange: (panel: ViewSheetPanel) => void;
  /** The view being edited: its name is the sheet's title and its kind its folio. */
  viewName: string;
  kind: ViewKind;
  /** The tabs this reader may use, in the order they appear. */
  available: ViewSheetPanel[];
  /** The active sort and column counts, printed on their tabs. */
  counts: { sorts: number; columns: number };
  panels: Partial<Record<ViewSheetPanel, ReactNode>>;
}

interface PanelCopy {
  label: string;
  icon: typeof Columns3;
  /** The panel's own heading, one step more specific than its tab. */
  title: string;
  blurb: string;
  /** A creation action, ruled apart from the sections that edit this view. */
  creation?: boolean;
}

const PANELS: Record<ViewSheetPanel, PanelCopy> = {
  columns: {
    label: "Columns",
    icon: Columns3,
    title: "Shown columns",
    blurb: "What the records show, and the order they read in.",
  },
  sort: {
    label: "Sort",
    icon: ArrowUpDown,
    title: "Sort order",
    blurb: "The first rule decides; a later one breaks its ties.",
  },
  settings: {
    label: "General",
    icon: Settings2,
    title: "View details",
    blurb: "The view's name and its default.",
  },
  save: {
    label: "Save as view",
    icon: Plus,
    title: "Save this view",
    blurb: "Keeps this page's search, filters and sorts as a named view.",
    creation: true,
  },
  data: {
    label: "Data",
    icon: FileSpreadsheet,
    title: "CSV import and export",
    blurb: "One type at a time, out to a file or in from one.",
  },
};

/**
 * The writes this sheet makes land as they happen, so no panel of it carries a
 * Save; the footer says so once, for the three panels that edit in place.
 */
/** The General panel holds one kind-specific control, and says which. */
const SETTINGS_BLURB: Record<ViewKind, string> = {
  table: "The view's name, its default, and its summary band.",
  board: "The view's name, its default, and the property the columns group by.",
  gallery: "The view's name, its default, and the cover each tile leads with.",
  calendar: "The view's name, its default, and the date it plots.",
};

const LIVE_PANEL: Record<ViewSheetPanel, boolean> = {
  columns: true,
  sort: true,
  settings: true,
  save: false,
  data: false,
};

/**
 * The one View surface: every column, sort, detail and CSV action for the
 * selected view, in a row of tabs. The sheet is the same on a phone and a wide
 * screen; only its width changes, and the strip scrolls rather than wraps so the
 * tabs never become two ragged rows.
 */
export function ViewSheet({
  open,
  onOpenChange,
  panel,
  onPanelChange,
  viewName,
  kind,
  available,
  counts,
  panels,
}: ViewSheetProps) {
  const handedness = useThumbHandedness();
  const track = useRef<HTMLDivElement>(null);
  const keyboard = useRef(false);
  const close = <SheetCloseButton label="Close view" />;
  const KindIcon = viewKindIcon(kind);
  const copy = PANELS[panel];
  const blurb = panel === "settings" ? SETTINGS_BLURB[kind] : copy.blurb;

  const meta = [
    `${viewKindLabel(kind)} view`,
    available.includes("columns") && counts.columns > 0
      ? `${counts.columns} ${counts.columns === 1 ? "column" : "columns"}`
      : null,
    available.includes("sort") && counts.sorts > 0
      ? `${counts.sorts} ${counts.sorts === 1 ? "sort" : "sorts"}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  // The strip holds one tab stop: the arrows move the selection, and the focus
  // follows it, so a keyboard reader never tabs through five hidden panels.
  function step(delta: number) {
    const index = available.indexOf(panel);
    const next = available[(index + delta + available.length) % available.length];
    if (next !== undefined) {
      keyboard.current = true;
      onPanelChange(next);
    }
  }

  function goTo(edge: "first" | "last") {
    const next = edge === "first" ? available[0] : available[available.length - 1];
    if (next !== undefined) {
      keyboard.current = true;
      onPanelChange(next);
    }
  }

  useEffect(() => {
    const tab = track.current?.querySelector<HTMLElement>(`[data-panel="${panel}"]`);
    tab?.scrollIntoView({ block: "nearest", inline: "nearest" });
    if (keyboard.current) {
      keyboard.current = false;
      tab?.focus();
    }
  }, [panel]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 scrim" />
        <SheetViewport>
          <SheetPopup className="sm:w-[38rem]">
            <div
              className={cn(
                "flex items-center gap-3 border-b rule px-4 py-3",
                handedness === "left" ? "justify-start" : "justify-between",
              )}
            >
              {handedness === "left" ? close : null}
              <div className="flex min-w-0 flex-1 items-center gap-2.5">
                <span
                  aria-hidden
                  className="inline-flex size-8 shrink-0 items-center justify-center rounded-[10px] border border-line/70 bg-raised/40 text-ink"
                >
                  <KindIcon size={15} />
                </span>
                <div className="min-w-0">
                  <SheetTitle className="truncate">{viewName}</SheetTitle>
                  <p className="label mt-0.5">{meta}</p>
                </div>
              </div>
              {handedness === "left" ? null : close}
            </div>

            <div
              role="tablist"
              aria-label="View panels"
              ref={track}
              className={cn(
                // The strip is a direct flex item so a finger can pan it; a
                // scroll container nested in a shrink-0 block does not scroll
                // by touch. The min-height keeps the flex item from shrinking
                // its tabs away on a short sheet. There is deliberately no
                // mask here: a mask on a scroll container can break touch
                // panning in mobile Safari, and the cut tab is the "more" cue.
                "mx-3 mt-3 flex min-h-11 w-fit min-w-0 max-w-[calc(100%-1.5rem)] flex-nowrap items-center gap-0.5 overflow-x-auto overscroll-x-contain rounded-full border border-line/80 bg-inset/60 p-1 pointer-coarse:min-h-14",
              )}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                  event.preventDefault();
                  step(1);
                } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                  event.preventDefault();
                  step(-1);
                } else if (event.key === "Home") {
                  event.preventDefault();
                  goTo("first");
                } else if (event.key === "End") {
                  event.preventDefault();
                  goTo("last");
                }
              }}
            >
              {available.map((value) => {
                const entry = PANELS[value];
                const { label, icon: Icon } = entry;
                const selected = panel === value;
                const count =
                  value === "columns"
                    ? counts.columns
                    : value === "sort"
                      ? counts.sorts
                      : 0;
                return (
                  <span key={value} role="none" className="flex shrink-0 items-center">
                    {entry.creation ? (
                      <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-line" />
                    ) : null}
                    <button
                      type="button"
                      role="tab"
                      data-panel={value}
                      id={`view-tab-${value}`}
                      aria-selected={selected}
                      aria-controls={selected ? `view-panel-${value}` : undefined}
                      tabIndex={selected ? 0 : -1}
                      aria-label={count > 0 ? `${label}, ${count}` : label}
                      className={cn(
                        "inline-flex min-h-8 shrink-0 scroll-mx-2 items-center gap-1.5 rounded-full px-3 text-[12px] transition-colors pointer-coarse:min-h-11",
                        selected
                          ? "bg-accent-wash text-accent-on-wash"
                          : entry.creation
                            ? "text-ink hover:bg-raised/60"
                            : "text-muted hover:bg-raised/60 hover:text-ink",
                      )}
                      onClick={() => onPanelChange(value)}
                    >
                      <Icon aria-hidden size={13} />
                      {label}
                      {count > 0 ? (
                        <span className="tnum font-mono text-[10px] opacity-70">{count}</span>
                      ) : null}
                    </button>
                  </span>
                );
              })}
            </div>

            <div
              role="tabpanel"
              id={`view-panel-${panel}`}
              aria-labelledby={`view-tab-${panel}`}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5"
            >
              <div className="mb-3">
                <h3 className="text-[15px] font-medium text-ink">{copy.title}</h3>
                <p className="mt-1 max-w-[52ch] text-[13px] leading-[1.5] text-muted">
                  {blurb}
                </p>
              </div>
              {panels[panel] ?? null}
            </div>

            {LIVE_PANEL[panel] ? (
              <div className="flex shrink-0 items-center justify-between gap-3 border-t rule px-4 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))]">
                <span className="label">Changes save as you go</span>
              </div>
            ) : null}
          </SheetPopup>
        </SheetViewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
