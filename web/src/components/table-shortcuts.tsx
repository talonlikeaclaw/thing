import { createContext, use, useEffect, type ReactNode } from "react";

import type { ShortcutDescriptor } from "@/lib/hotkeys";

const TableShortcutsContext = createContext<((list: ShortcutDescriptor[]) => void) | null>(null);

/**
 * Lets the table grid declare the keys it actually handles while it is
 * mounted, so the `?` sheet never lists a table shortcut that would do
 * nothing on this route.
 */
export function TableShortcutsProvider({
  onChange,
  children,
}: {
  onChange: (list: ShortcutDescriptor[]) => void;
  children: ReactNode;
}) {
  return <TableShortcutsContext value={onChange}>{children}</TableShortcutsContext>;
}

/** Registers a stable descriptor list for the lifetime of the calling grid. */
export function useTableShortcuts(descriptors: ShortcutDescriptor[]) {
  const register = use(TableShortcutsContext);
  useEffect(() => {
    if (!register) {
      return;
    }
    register(descriptors);
    return () => register([]);
  }, [register, descriptors]);
}
