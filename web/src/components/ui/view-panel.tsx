import { Dialog } from "@base-ui/react/dialog";
import { Popover } from "@base-ui/react/popover";
import { X } from "lucide-react";
import type { ReactNode, RefObject } from "react";

import { useThumbHandedness } from "@/components/handedness";
import {
  SheetCloseButton,
  SheetFooter,
  SheetHeader,
  SheetPopup,
  SheetTitle,
  SheetViewport,
} from "@/components/ui/sheet";
import { cn } from "@/lib/cn";
import { useCoarsePointer, useCompactWidth } from "@/lib/media";

interface ViewPanelProps {
  /** The overlay's accessible name and the sheet's header title. */
  title: string;
  /** A short count beside the title, e.g. the active conditions. */
  count?: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The control the popover hangs from, and where focus returns on close. */
  anchor: RefObject<HTMLElement | null>;
  /** The body: it scrolls inside the panel, the page never moves. */
  children: ReactNode;
  /** Sticky actions; the sheet adds the safe-area padding, the popover a rule. */
  footer?: ReactNode;
  className?: string;
}

/**
 * The one shell for a view tool: a glass popover under its toolbar button on a
 * fine pointer, the shared sheet on a phone. Both keep the header and the
 * footer fixed while the middle scrolls, so the table underneath never moves.
 */
export function ViewPanel({
  title,
  count,
  open,
  onOpenChange,
  anchor,
  children,
  footer,
  className,
}: ViewPanelProps) {
  const compact = useCompactWidth();
  const coarse = useCoarsePointer();
  const handedness = useThumbHandedness();
  const sheet = compact || coarse;

  const heading = (
    <>
      <span className="min-w-0 truncate">{title}</span>
      {count !== undefined && count > 0 ? (
        <span className="tnum shrink-0 rounded-full bg-accent-wash px-1 font-mono text-[length:var(--text-label)] text-accent-on-wash">
          {count}
        </span>
      ) : null}
    </>
  );

  if (sheet) {
    return (
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-40 scrim" />
          <SheetViewport>
            <SheetPopup className={cn("sm:w-[34rem]", className)}>
              <SheetHeader
                className={cn(
                  "gap-[var(--space-3)]",
                  handedness === "left" ? "justify-start" : "justify-between",
                )}
              >
                {handedness === "left" ? (
                  <>
                    <SheetCloseButton label={`Close ${title.toLowerCase()}`} />
                    <SheetTitle className="flex min-w-0 flex-1 items-center gap-2">
                      {heading}
                    </SheetTitle>
                  </>
                ) : (
                  <>
                    <SheetTitle className="flex min-w-0 flex-1 items-center gap-2">
                      {heading}
                    </SheetTitle>
                    <SheetCloseButton label={`Close ${title.toLowerCase()}`} />
                  </>
                )}
              </SheetHeader>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-[var(--space-4)] py-[var(--space-3)]">
                {children}
              </div>
              {footer ? (
                <SheetFooter className="flex items-center gap-2">{footer}</SheetFooter>
              ) : null}
            </SheetPopup>
          </SheetViewport>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Portal>
        <Popover.Positioner
          anchor={anchor}
          sideOffset={6}
          align="start"
          collisionPadding={8}
          // The toolbar reflows the moment the query becomes dirty (Save view
          // and Reset arrive), which slides the button out from under an open
          // panel. Holding the panel where it opened keeps the pointer on the
          // row it was using; closing and reopening re-aligns it.
          disableAnchorTracking
          className="z-50"
        >
          <Popover.Popup
            aria-label={title}
            finalFocus={() => anchor.current ?? false}
            className={cn(
              "glass-strong flex max-h-[min(34rem,calc(100dvh-6rem))] w-[22rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-card",
              className,
            )}
          >
            <div className="flex items-center justify-between gap-2 border-b rule px-3 py-2">
              <span className="label flex min-w-0 items-center gap-1.5 text-ink">
                {heading}
              </span>
              <button
                type="button"
                aria-label={`Close ${title.toLowerCase()}`}
                className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-faint transition-colors hover:bg-raised hover:text-ink pointer-coarse:size-11"
                onClick={() => onOpenChange(false)}
              >
                <X aria-hidden size={14} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
              {children}
            </div>
            {footer ? (
              <div className="flex items-center gap-2 border-t rule px-3 py-2">{footer}</div>
            ) : null}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
