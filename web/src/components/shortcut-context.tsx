import { createContext, use, useMemo, type ReactNode } from "react";

interface ShortcutsApi {
  /** Opens the shortcut sheet; the space sheet's footer calls it. */
  open: () => void;
}

const ShortcutsContext = createContext<ShortcutsApi | null>(null);

/** Lets a page-level surface open the shortcut sheet the shell owns. */
export function ShortcutsProvider({
  open,
  children,
}: {
  open: () => void;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ open }), [open]);
  return <ShortcutsContext value={value}>{children}</ShortcutsContext>;
}

export function useShortcuts(): ShortcutsApi {
  const shortcuts = use(ShortcutsContext);
  if (!shortcuts) {
    throw new Error("useShortcuts needs a ShortcutsProvider above it");
  }
  return shortcuts;
}
