import { Check, MoreHorizontal } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";

import type { ObjectSummary } from "@/api/types";
import { cn } from "@/lib/cn";

interface CardActionsProps {
  spaceId: string;
  row: ObjectSummary;
  canEdit: boolean;
  completing: boolean;
  pending: boolean;
  showComplete: boolean;
  verb: string;
  onComplete: () => void;
  onDuplicate: () => void;
  onTrash: () => void;
}

const button =
  "inline-flex h-7 w-7 items-center justify-center rounded-[3px] bg-surface/90 text-faint transition-colors hover:bg-raised hover:text-accent disabled:opacity-50 pointer-coarse:h-11 pointer-coarse:w-11";

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
  spaceId,
  row,
  canEdit,
  completing,
  pending,
  showComplete,
  verb,
  onComplete,
  onDuplicate,
  onTrash,
}: CardActionsProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const container = useRef<HTMLDivElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const menu = useRef<HTMLDivElement | null>(null);

  function place() {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    const left = Math.min(
      Math.max(VIEWPORT_MARGIN, rect.right - MENU_WIDTH),
      window.innerWidth - MENU_WIDTH - VIEWPORT_MARGIN,
    );
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
        left: Math.min(
          Math.max(VIEWPORT_MARGIN, rect.right - MENU_WIDTH),
          window.innerWidth - MENU_WIDTH - VIEWPORT_MARGIN,
        ),
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
      {showComplete ? (
        <button
          type="button"
          aria-label={`${verb} ${row.title}`}
          title={verb}
          disabled={completing || pending}
          className={button}
          onClick={onComplete}
        >
          <Check aria-hidden size={14} />
        </button>
      ) : null}
      <button
        ref={trigger}
        type="button"
        aria-label={`Actions for ${row.title}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Actions"
        className={button}
        onClick={toggle}
      >
        <MoreHorizontal aria-hidden size={15} />
      </button>
      {open
        ? createPortal(
            <div
              ref={menu}
              role="menu"
              aria-label={`Actions for ${row.title}`}
              className="fixed z-50 min-w-[10rem] rounded-field border border-line bg-surface p-1 text-[13px]"
              style={{ top: position.top, left: position.left, width: MENU_WIDTH }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setOpen(false);
                  trigger.current?.focus();
                }
              }}
            >
              <Link
                role="menuitem"
                to={`/s/${spaceId}/o/${row.id}`}
                className="block rounded-[3px] px-2 py-1.5 text-left hover:bg-raised focus:bg-raised focus:outline-none pointer-coarse:min-h-11"
                onClick={() => setOpen(false)}
              >
                Open
              </Link>
              <button
                type="button"
                role="menuitem"
                className={cn(
                  "block w-full rounded-[3px] px-2 py-1.5 text-left hover:bg-raised focus:bg-raised focus:outline-none pointer-coarse:min-h-11",
                )}
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
                className="block w-full rounded-[3px] px-2 py-1.5 text-left text-danger hover:bg-raised focus:bg-raised focus:outline-none disabled:opacity-50 pointer-coarse:min-h-11"
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
