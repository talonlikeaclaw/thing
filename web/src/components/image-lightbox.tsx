import { Dialog } from "@base-ui/react/dialog";
import type { RefObject } from "react";

import {
  SheetCloseButton,
  SheetPopup,
  SheetTitle,
  SheetViewport,
} from "@/components/ui/sheet";
import { fileName, fileUrl } from "@/lib/files";

interface ImageLightboxProps {
  spaceId: string;
  /** The stored image path. */
  path: string;
  /** The record or file name the caption reads. */
  title?: string;
  /** The control that opened the lightbox; focus returns here on close. */
  returnFocus?: RefObject<HTMLElement | null>;
  onClose: () => void;
}

/**
 * One image at reading size over a scrim. Built on the sheet primitives so the
 * phone keyboard and safe-area geometry are not a second modal system; Base UI's
 * dialog owns Escape, the backdrop and returning focus to the opener.
 */
export function ImageLightbox({
  spaceId,
  path,
  title,
  returnFocus,
  onClose,
}: ImageLightboxProps) {
  const caption = fileName(path);
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
              <SheetCloseButton label="Close image" />
            </div>
            <img
              src={fileUrl(spaceId, path)}
              alt={title ?? caption}
              className="max-h-[calc(var(--vv-height,100vh)-8rem)] w-full overscroll-contain rounded-[12px] object-contain"
            />
          </SheetPopup>
        </SheetViewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
