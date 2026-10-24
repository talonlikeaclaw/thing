import { createContext, use, type ReactNode } from "react";

const PaletteContext = createContext<(() => void) | null>(null);

/** Lets the mobile bar open the palette without owning its sheet. */
export function PaletteProvider({
  open,
  children,
}: {
  open: () => void;
  children: ReactNode;
}) {
  return <PaletteContext value={open}>{children}</PaletteContext>;
}

export function usePalette(): () => void {
  const open = use(PaletteContext);
  if (!open) {
    throw new Error("usePalette needs a PaletteProvider above it");
  }
  return open;
}
