import { createContext, use, useEffect, type ReactNode } from "react";

import type { ShortcutDescriptor } from "@/lib/hotkeys";

const PageShortcutsContext = createContext<((list: ShortcutDescriptor[]) => void) | null>(null);

/**
 * Lets the surface on screen declare the keys it actually handles while it is
 * mounted — the table grid, a journal day — so the `?` sheet never lists a
 * shortcut that would do nothing on this route.
 */
export function PageShortcutsProvider({
  onChange,
  children,
}: {
  onChange: (list: ShortcutDescriptor[]) => void;
  children: ReactNode;
}) {
  return <PageShortcutsContext value={onChange}>{children}</PageShortcutsContext>;
}

/** Registers a stable descriptor list for the lifetime of the calling surface. */
export function usePageShortcuts(descriptors: ShortcutDescriptor[]) {
  const register = use(PageShortcutsContext);
  useEffect(() => {
    if (!register) {
      return;
    }
    register(descriptors);
    return () => register([]);
  }, [register, descriptors]);
}
