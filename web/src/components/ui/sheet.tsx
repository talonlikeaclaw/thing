import { Dialog } from "@base-ui/react/dialog";
import { useEffect, type ComponentProps } from "react";

import { cn } from "@/lib/cn";
import { applyViewportMetrics, subscribeVisualViewport } from "@/lib/viewport";

/**
 * `sheet` is a bottom sheet on a phone and a top-anchored sheet from `sm` up
 * (the palette, capture, shortcuts and add-property). `bottom` stays a bottom
 * sheet at every width (the space drawer). `center` is a centred dialog (sign
 * out) that still gets the keyboard-aware height.
 */
type SheetPlacement = "sheet" | "bottom" | "center";

interface SheetViewportProps extends ComponentProps<typeof Dialog.Viewport> {
  placement?: SheetPlacement;
}

/**
 * The positioning half of every overlay. The geometry lives in `globals.css`
 * (`.sheet-viewport`) so it can read the visual-viewport custom properties;
 * this component exists so no caller can forget the placement attribute.
 */
export function SheetViewport({ placement = "sheet", className, ...props }: SheetViewportProps) {
  return (
    <Dialog.Viewport
      data-placement={placement === "sheet" ? undefined : placement}
      className={cn("sheet-viewport", className)}
      {...props}
    />
  );
}

/**
 * The panel half: one surface, one hairline, the sheet curve, and a max height
 * measured against the visual viewport so a keyboard can never cover the
 * footer. Callers add only their width and their own padding.
 */
export function SheetPopup({ className, ...props }: ComponentProps<typeof Dialog.Popup>) {
  return <Dialog.Popup className={cn("sheet-popup", className)} {...props} />;
}

/**
 * Publish the visual viewport's size where the sheet CSS reads it. Mounted once
 * in `AppFrame`; it subscribes rather than re-rendering, so opening the keyboard
 * costs one style write, not a React commit per frame.
 */
export function useSheetViewport() {
  useEffect(() => {
    const root = document.documentElement;
    return subscribeVisualViewport((metrics) => applyViewportMetrics(root, metrics));
  }, []);
}
