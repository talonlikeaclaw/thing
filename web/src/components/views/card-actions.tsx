import { Check, MoreHorizontal } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { ObjectSummary } from "@/api/types";
import { useThumbHandedness } from "@/components/handedness";
import { cn } from "@/lib/cn";
import { useWideLayout } from "@/lib/media";

interface CardActionsProps {
  row: ObjectSummary;
  canEdit: boolean;
  completing: boolean;
  pending: boolean;
  showComplete: boolean;
  verb: string;
  onComplete: () => void;
  onDuplicate: () => void;
  onTrash: () => void;
  /**
   * A board card gives a phone one kebab instead of two controls: Complete
   * moves into the menu on a coarse pointer and the card stops reserving the
   * gutter beside it.
   */
  menuCompleteOnCoarse?: boolean;
  /**
   * The tile sits on a picture, so the glyph cannot borrow the accent: it goes
   * light with a dark halo, which holds on a bright sky and a dark leaf alike.
   */
  onImage?: boolean;
}

/** One row of any card or attachment action menu, at the shared menu scale. */
export const cardMenuItem =
  "w-full rounded-[8px] px-2 py-1.5 text-left hover:bg-[var(--color-accent-wash-hover)] focus:bg-[var(--color-accent-wash-hover)] focus:outline-none pointer-coarse:min-h-11";

const button =
  "card-action inline-flex h-8 w-8 items-center justify-center rounded-full transition-[background-color,color,transform] duration-[var(--duration-fast)] ease-[var(--ease-out)] active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:h-11 pointer-coarse:w-11";

/** The pane's glyph treatment, then any per-surface modifiers. */
function buttonClass(onImage: boolean, extra?: string | false) {
  return cn(button, onImage && "card-action-photo", extra);
}

const MENU_WIDTH = 168;
const MENU_GAP = 4;
const VIEWPORT_MARGIN = 8;

/**
 * The same Complete plus kebab actions on a board card, gallery tile or
 * calendar chip. The controls sit outside the card's link so a click never
 * navigates by accident.
 *
 * The menu is portalled to the body and positioned against the trigger: the
 * board's horizontal scrollport clips overflowing children, so an absolutely
 * positioned menu would be cut off on the last lane and covered by the next
 * card's own buttons.
 */
export function CardActions({
  row,
  canEdit,
  completing,
  pending,
  showComplete,
  verb,
  onComplete,
  onDuplicate,
  onTrash,
  menuCompleteOnCoarse = false,
  onImage = false,
}: CardActionsProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const container = useRef<HTMLDivElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const menu = useRef<HTMLDivElement | null>(null);
  const handedness = useThumbHandedness();
  const wide = useWideLayout();

  /** The trigger's leading edge in left mode, trailing edge in right mode. */
  function anchorLeft(rect: DOMRect): number {
    const preferred = handedness === "left" ? rect.left : rect.right - MENU_WIDTH;
    return Math.min(
      Math.max(VIEWPORT_MARGIN, preferred),
      window.innerWidth - MENU_WIDTH - VIEWPORT_MARGIN,
    );
  }

  function place() {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    const left = anchorLeft(rect);
    const below = rect.bottom + MENU_GAP;
    const menuHeight = menu.current?.offsetHeight ?? 0;
    const preferred =
      menuHeight > 0 && below + menuHeight > window.innerHeight - VIEWPORT_MARGIN
        ? rect.top - menuHeight - MENU_GAP
        : below;
    const top =
      menuHeight > 0
        ? Math.min(
            Math.max(VIEWPORT_MARGIN, preferred),
            window.innerHeight - menuHeight - VIEWPORT_MARGIN,
          )
        : preferred;
    setPosition({ top, left });
  }

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = trigger.current?.getBoundingClientRect();
    if (rect) {
      setPosition({
        top: rect.bottom + MENU_GAP,
        left: anchorLeft(rect),
      });
    }
    setOpen(true);
  }

  // The menu is outside the trigger's box; keep it anchored while scrolling.
  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    place();
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) {
      return;
    }
    const onScroll = () => place();
    const onResize = () => place();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        !container.current?.contains(target) &&
        !menu.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [open]);

  if (!canEdit) {
    return null;
  }

  const completeButton = showComplete ? (
    <button
      type="button"
      aria-label={`${verb} ${row.title}`}
      title={verb}
      disabled={completing || pending}
      className={buttonClass(onImage, menuCompleteOnCoarse && "pointer-coarse:hidden")}
      onClick={onComplete}
    >
      <Check aria-hidden size={15} strokeWidth={2.4} />
    </button>
  ) : null;

  const menuButton = (
    <button
      ref={trigger}
      type="button"
      aria-label={`Actions for ${row.title}`}
      aria-haspopup="menu"
      aria-expanded={open}
      title="Actions"
      className={buttonClass(onImage)}
      onClick={toggle}
    >
      <MoreHorizontal aria-hidden size={16} strokeWidth={2.4} />
    </button>
  );

  return (
    <div
      ref={container}
      className="flex items-center gap-0.5"
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (
          next instanceof Node &&
          (container.current?.contains(next) || menu.current?.contains(next))
        ) {
          return;
        }
        setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      {wide || handedness === "left" ? (
        <>
          {completeButton}
          {menuButton}
        </>
      ) : (
        <>
          {menuButton}
          {completeButton}
        </>
      )}
      {open
        ? createPortal(
            <div
              ref={menu}
              role="menu"
              aria-label={`Actions for ${row.title}`}
              className="card-menu fixed z-50 min-w-[10rem] rounded-card p-1.5 text-[13px]"
              style={{ top: position.top, left: position.left, width: MENU_WIDTH }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setOpen(false);
                  trigger.current?.focus();
                }
              }}
            >
              {showComplete && menuCompleteOnCoarse ? (
                <button
                  type="button"
                  role="menuitem"
                  className={cn(cardMenuItem, "hidden disabled:opacity-50 pointer-coarse:block")}
                  disabled={completing || pending}
                  onClick={() => {
                    setOpen(false);
                    onComplete();
                  }}
                >
                  {verb}
                </button>
              ) : null}
              <button
                type="button"
                role="menuitem"
                className={cardMenuItem}
                disabled={pending}
                onClick={() => {
                  setOpen(false);
                  onDuplicate();
                }}
              >
                Duplicate
              </button>
              <button
                type="button"
                role="menuitem"
                className={cn(cardMenuItem, "text-danger disabled:opacity-50")}
                disabled={pending}
                onClick={() => {
                  setOpen(false);
                  onTrash();
                }}
              >
                Move to trash
              </button>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
