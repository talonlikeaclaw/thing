import { Dialog } from "@base-ui/react/dialog";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, type RefObject } from "react";

import { useThumbHandedness } from "@/components/handedness";
import { IconButton } from "@/components/ui/controls";
import {
  SheetCloseButton,
  SheetPopup,
  SheetTitle,
  SheetViewport,
} from "@/components/ui/sheet";
import { cn } from "@/lib/cn";
import { fileName, fileUrl } from "@/lib/files";

/** One stored image the lightbox can show. */
export interface LightboxImage {
  path: string;
  /** The caption; falls back to the file name. */
  title?: string;
}

interface ImageLightboxProps {
  spaceId: string;
  /** The images the caller steps through, in display order. */
  images: LightboxImage[];
  /** The image currently shown. */
  index: number;
  onIndexChange: (index: number) => void;
  /** The control that opened the lightbox; focus returns here on close. */
  returnFocus?: RefObject<HTMLElement | null>;
  onClose: () => void;
}

/**
 * One image at reading size over a scrim, with previous and next when the
 * caller opens a set. The picture sits in a fixed stage, so the arrows never
 * move when the image's own size changes. Built on the sheet primitives so the
 * phone keyboard and safe-area geometry are not a second modal system; Base
 * UI's dialog owns Escape, the backdrop and returning focus to the opener.
 */
export function ImageLightbox({
  spaceId,
  images,
  index,
  onIndexChange,
  returnFocus,
  onClose,
}: ImageLightboxProps) {
  const handedness = useThumbHandedness();
  const count = images.length;
  const current = images[index] ?? images[0];
  const caption = current ? (current.title ?? fileName(current.path)) : "";
  const multiple = count > 1;

  useEffect(() => {
    if (!multiple) {
      return;
    }
    // Capture at the window: the dialog's own key handling swallows bubble
    // events, so a bubble listener never sees the arrow keys.
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        onIndexChange((index - 1 + count) % count);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        onIndexChange((index + 1) % count);
      }
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [count, index, multiple, onIndexChange]);

  if (!current) {
    return null;
  }

  const counter = multiple ? (
    <span
      aria-live="polite"
      className="min-w-[3.5rem] text-center font-mono text-[11px] tabular-nums text-white/60"
    >
      {index + 1} / {count}
    </span>
  ) : null;
  const closeButton = (
    <SheetCloseButton
      label="Close image"
      className="text-white/70 hover:bg-white/10 hover:text-white focus-visible:outline-white"
    />
  );
  const controls = (
    <div className="flex shrink-0 items-center gap-2">
      {handedness === "left" ? (
        <>
          {closeButton}
          {counter}
        </>
      ) : (
        <>
          {counter}
          {closeButton}
        </>
      )}
    </div>
  );

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 scrim" />
        <SheetViewport placement="center">
          <SheetPopup
            data-photo=""
            finalFocus={returnFocus}
            className="w-[min(94vw,72rem)] p-2"
          >
            <div
              className={cn(
                "flex items-center gap-3 px-1 pb-2",
                handedness === "left" ? "justify-start" : "justify-between",
              )}
            >
              {handedness === "left" ? controls : null}
              <SheetTitle className="min-w-0 truncate text-[length:var(--text-small)] font-medium text-white">
                {caption}
              </SheetTitle>
              {handedness === "left" ? null : controls}
            </div>
            <div className="relative flex h-[calc(var(--vv-height,100vh)-8rem)] items-center justify-center overflow-hidden rounded-[12px]">
              <img
                src={fileUrl(spaceId, current.path)}
                alt={caption}
                className="max-h-full max-w-full overscroll-contain rounded-[12px] object-contain"
              />
              {multiple ? (
                <>
                  <IconButton
                    label="Previous image"
                    size={32}
                    variant="quiet"
                    className="card-action-neutral absolute top-[calc(50%-1rem)] left-2 focus-visible:outline-white"
                    onClick={() => onIndexChange((index - 1 + count) % count)}
                  >
                    <ChevronLeft aria-hidden size={16} strokeWidth={2.4} />
                  </IconButton>
                  <IconButton
                    label="Next image"
                    size={32}
                    variant="quiet"
                    className="card-action-neutral absolute top-[calc(50%-1rem)] right-2 focus-visible:outline-white"
                    onClick={() => onIndexChange((index + 1) % count)}
                  >
                    <ChevronRight aria-hidden size={16} strokeWidth={2.4} />
                  </IconButton>
                </>
              ) : null}
            </div>
          </SheetPopup>
        </SheetViewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
