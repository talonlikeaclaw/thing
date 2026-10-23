import { useEffect } from "react";

import { useMe } from "@/api/queries";
import { recentKey, recordRecent } from "@/lib/recent";

interface RecentObject {
  id: string;
  type: string;
  title: string;
}

/**
 * Writes one loaded record into this browser's recent list for the space.
 *
 * The stored title is a snapshot of the record as the server returned it, so a
 * rename elsewhere does not rewrite history until the record is opened again.
 * Storage failures stay swallowed inside `recordRecent`: opening a record never
 * depends on the browser keeping a list.
 */
export function useRecordRecent(
  spaceId: string | undefined,
  object: RecentObject | undefined,
): void {
  const me = useMe();
  const userId = me.data?.id;
  const id = object?.id;
  const type = object?.type;
  const title = object?.title;

  useEffect(() => {
    if (!userId || !spaceId || !id || !type || !title) {
      return;
    }
    recordRecent(
      window.localStorage,
      recentKey(userId, spaceId),
      { id, type, title },
      new Date().toISOString(),
    );
  }, [userId, spaceId, id, type, title]);
}
