import { createContext, use, useMemo, type ReactNode } from "react";

interface PaletteApi {
  /** Opens the command surface; the phone bar and the header both call it. */
  open: () => void;
  /** Whether the surface is on screen, so a trigger can mark itself active. */
  isOpen: boolean;
}

const PaletteContext = createContext<PaletteApi | null>(null);

/** Lets the mobile bar open the palette without owning its sheet. */
export function PaletteProvider({
  open,
  isOpen,
  children,
}: {
  open: () => void;
  isOpen: boolean;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ open, isOpen }), [open, isOpen]);
  return <PaletteContext value={value}>{children}</PaletteContext>;
}

export function usePalette(): PaletteApi {
  const palette = use(PaletteContext);
  if (!palette) {
    throw new Error("usePalette needs a PaletteProvider above it");
  }
  return palette;
}
