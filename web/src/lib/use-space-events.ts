import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { queryKeys } from "@/api/queries";

const RETRY_BASE_MS = 500;
const RETRY_MAX_MS = 15_000;
/** Events arrive in bursts; one invalidation per burst is enough. */
const COALESCE_MS = 80;

/**
 * Keeps this space's cached reads honest.
 *
 * The server sends identity only, so every event (and every reconnect) drops
 * the whole space prefix: a missed frame cannot leave the table stale. The
 * socket is reopened with backoff until the page unmounts.
 */
export function useSpaceEvents(spaceId: string | undefined) {
  const client = useQueryClient();

  useEffect(() => {
    if (!spaceId) {
      return;
    }
    let socket: WebSocket | undefined;
    let retry = 0;
    let retryTimer: number | undefined;
    let invalidateTimer: number | undefined;
    let stopped = false;

    const invalidate = () => {
      if (invalidateTimer !== undefined) {
        return;
      }
      invalidateTimer = window.setTimeout(() => {
        invalidateTimer = undefined;
        void client.invalidateQueries({ queryKey: queryKeys.space(spaceId) });
      }, COALESCE_MS);
    };

    const connect = () => {
      const scheme = window.location.protocol === "https:" ? "wss" : "ws";
      socket = new WebSocket(
        `${scheme}://${window.location.host}/api/spaces/${spaceId}/events`,
      );
      socket.onopen = () => {
        retry = 0;
        // A reconnect may have missed events; the whole space is refetched.
        invalidate();
      };
      socket.onmessage = () => invalidate();
      socket.onclose = () => {
        if (stopped) {
          return;
        }
        const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** retry);
        retry += 1;
        retryTimer = window.setTimeout(connect, delay + Math.random() * 200);
      };
    };

    connect();
    return () => {
      stopped = true;
      if (retryTimer !== undefined) {
        window.clearTimeout(retryTimer);
      }
      if (invalidateTimer !== undefined) {
        window.clearTimeout(invalidateTimer);
      }
      socket?.close();
    };
  }, [spaceId, client]);
}
