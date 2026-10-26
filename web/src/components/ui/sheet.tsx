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
 * Focus a field of a sheet that is kept mounted while closed, from inside the
 * gesture that opened it. iOS Safari only raises the keyboard for `focus()`
 * during the tap itself, and only for a field that already exists: by the time
 * a freshly mounted field's effects run, the gesture is over. `inert` is what
 * keeps the closed sheet out of the tab order and the accessibility tree, so it
 * is dropped here, in the same task, before the field takes focus; the open
 * commit clears it for good. See `.sheet-popup[hidden]` in `globals.css`.
 */
/**
 * The element a sheet should hand focus back to. Captured by the opener before
 * the open commit: a sheet that focuses a field inside the gesture makes that
 * field the dialog's "previously focused" element, so the dialog's own restore
 * would land on an inert sheet and drop focus to the body. Body and anything
 * inside a sheet are not restore targets.
 */
export function sheetReturnFocus(): HTMLElement | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || active === document.body) {
    return null;
  }
  return active.closest(".sheet-popup") === null ? active : null;
}

export function focusSheetField(field: HTMLElement | null) {
  if (!field) {
    return;
  }
  field.closest<HTMLElement>(".sheet-popup")?.removeAttribute("inert");
  field.focus({ preventScroll: true });
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
