import { useLayoutEffect, useMemo } from "react";
import { useLocation } from "react-router";

import { useMe, useSpaces } from "@/api/queries";
import {
  DEFAULT_ACCENT,
  applyAccent,
  isAccentId,
  resetAccent,
  syncThemeColor,
} from "@/lib/accent";
import { readVisits, visitsKey } from "@/lib/visits";

/**
 * The room outside a space. A profile theme is global: it applies on the
 * account settings page and the Spaces list as soon as it is chosen, whether
 * or not it also overrides spaces. With no profile accent, the most recently
 * visited space keeps the room after the reader returns to the list; with
 * neither, the default Lichen room applies. Inside a space, `SpaceLayout` owns
 * the accent and the override decides between the space and the profile.
 */
export function ProfileTheme({ inSpace }: { inSpace: boolean }) {
  const me = useMe();
  const spaces = useSpaces();
  const pathname = useLocation().pathname;
  const userId = me.data?.id;

  // Re-read on navigation: `SpaceLayout` records a visit when a space opens,
  // and the list must see that visit when the reader returns to it.
  const visits = useMemo(
    () => (userId ? readVisits(window.localStorage, visitsKey(userId)) : {}),
    [userId, pathname],
  );

  const profile = isAccentId(me.data?.accent) ? me.data.accent : null;
  const override = me.data?.accent_override === true;
  const lastSpace = useMemo(() => {
    let last: { id: string; at: number } | null = null;
    for (const space of spaces.data ?? []) {
      const at = visits[space.id];
      if (at !== undefined && (last === null || at > last.at)) {
        last = { id: space.id, at };
      }
    }
    return last ? (spaces.data ?? []).find((space) => space.id === last.id) : undefined;
  }, [spaces.data, visits]);

  // A chosen profile theme is global outside spaces. Without one, an override
  // still asks for the default room; otherwise the last space carries the room.
  const accent =
    profile ??
    (override
      ? DEFAULT_ACCENT
      : lastSpace
        ? isAccentId(lastSpace.accent)
          ? lastSpace.accent
          : DEFAULT_ACCENT
        : null);

  useLayoutEffect(() => {
    if (inSpace || !accent) {
      return;
    }
    const root = document.documentElement;
    applyAccent(root, accent);
    syncThemeColor(root);
    return () => {
      resetAccent(root);
      syncThemeColor(root);
    };
  }, [accent, inSpace]);

  return null;
}
