import { Popover } from "@base-ui/react/popover";
import { MoreHorizontal } from "lucide-react";
import { useState } from "react";

import { focusRing } from "@/components/ui/controls";
import { cardMenuItem } from "@/components/views/card-actions";
import { cn } from "@/lib/cn";

interface AttachmentMenuProps {
  /** What the menu belongs to, for the trigger's and menu's accessible name. */
  label: string;
  /** Over a picture, the pane follows the gallery's photo treatment. */
  onImage?: boolean;
  /** Whether the current file can become the record's cover. */
  canSetCover?: boolean;
  disabled?: boolean;
  onSetCover?: () => void;
  onRemove: () => void;
  className?: string;
}

/**
 * The one action menu for a stored file: a frosted pane opening Set as cover
 * and Remove, the same pane and rows a gallery tile uses.
 */
export function AttachmentMenu({
  label,
  onImage = false,
  canSetCover = false,
  disabled = false,
  onSetCover,
  onRemove,
  className,
}: AttachmentMenuProps) {
  const [open, setOpen] = useState(false);
  const name = `Actions for ${label}`;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        aria-label={name}
        title="Actions"
        disabled={disabled}
        className={cn(
          "inline-flex size-8 shrink-0 items-center justify-center rounded-full transition-[background-color,color,transform] duration-[var(--duration-fast)] ease-[var(--ease-out)] active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:size-11",
          onImage ? "card-action card-action-photo" : "card-action",
          focusRing,
          className,
        )}
      >
        <MoreHorizontal aria-hidden size={16} strokeWidth={2.4} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={4} collisionPadding={8} className="z-50">
          <Popover.Popup
            aria-label={name}
            className="card-menu min-w-[10rem] rounded-card p-1.5 text-[13px]"
          >
            {canSetCover ? (
              <button
                type="button"
                role="menuitem"
                className={cardMenuItem}
                onClick={() => {
                  setOpen(false);
                  onSetCover?.();
                }}
              >
                Set as cover
              </button>
            ) : null}
            <button
              type="button"
              role="menuitem"
              className={cn(cardMenuItem, "text-danger")}
              onClick={() => {
                setOpen(false);
                onRemove();
              }}
            >
              Remove
            </button>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
