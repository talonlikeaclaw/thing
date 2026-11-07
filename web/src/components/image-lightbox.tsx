import { Dialog } from "@base-ui/react/dialog";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, type RefObject } from "react";

import { IconButton } from "@/components/ui/controls";
import {
  SheetCloseButton,
  SheetPopup,
  SheetTitle,
  SheetViewport,
} from "@/components/ui/sheet";
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
 * caller opens a set. Built on the sheet primitives so the phone keyboard and
 * safe-area geometry are not a second modal system; Base UI's dialog owns
 * Escape, the backdrop and returning focus to the opener.
 */
export function ImageLightbox({
  spaceId,
  images,
  index,
  onIndexChange,
  returnFocus,
  onClose,
}: ImageLightboxProps) {
  const count = images.length;
  const current = images[index] ?? images[0];
  const caption = current
    ? (current.title ?? fileName(current.path))
    : "";
  const multiple = count > 1;

  useEffect(() => {
    if (!multiple) {
      return;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        onIndexChange((index - 1 + count) % count);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        onIndexChange((index + 1) % count);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [count, index, multiple, onIndexChange]);

  if (!current) {
    return null;
  }

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
            finalFocus={returnFocus}
            className="max-w-[min(94vw,72rem)] p-2"
          >
            <div className="flex items-center justify-between gap-3 px-1 pb-2">
              <SheetTitle className="truncate text-[length:var(--text-small)] font-medium">
                {caption}
              </SheetTitle>
              <div className="flex shrink-0 items-center gap-1">
                {multiple ? (
                  <>
                    <IconButton
                      label="Previous image"
                      variant="quiet"
                      size={36}
                      onClick={() =>
                        onIndexChange((index - 1 + count) % count)
                      }
                    >
                      <ChevronLeft aria-hidden size={18} />
                    </IconButton>
                    <span
                      aria-live="polite"
                      className="min-w-[3.5rem] text-center font-mono text-[11px] tabular-nums text-faint"
                    >
                      {index + 1} / {count}
                    </span>
                    <IconButton
                      label="Next image"
                      variant="quiet"
                      size={36}
                      onClick={() => onIndexChange((index + 1) % count)}
                    >
                      <ChevronRight aria-hidden size={18} />
                    </IconButton>
                  </>
                ) : null}
                <SheetCloseButton label="Close image" />
              </div>
            </div>
            <img
              src={fileUrl(spaceId, current.path)}
              alt={caption}
              className="max-h-[calc(var(--vv-height,100vh)-8rem)] w-full overscroll-contain rounded-[12px] object-contain"
            />
          </SheetPopup>
        </SheetViewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
