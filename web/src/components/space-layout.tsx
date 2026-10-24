import { useEffect } from "react";
import { Outlet, useParams } from "react-router";

import { useMe, useSpace, useTypes } from "@/api/queries";
import { ErrorState } from "@/components/error-state";
import { SpaceNav } from "@/components/space-nav";
import { recordVisit, visitsKey } from "@/lib/visits";

/**
 * One owner for the space's rail, its pending state and its refusals.
 *
 * Pages inside the outlet can rely on the space and its types being loaded;
 * they never repeat the fallback or mount a second rail.
 */
export function SpaceLayout() {
  const { spaceId } = useParams();
  const space = useSpace(spaceId);
  const types = useTypes(spaceId);
  const me = useMe();
  const error = space.error ?? types.error;
  const userId = me.data?.id;

  // The spaces list orders by the last space opened, browser-local.
  useEffect(() => {
    if (!userId || !spaceId) {
      return;
    }
    recordVisit(window.localStorage, visitsKey(userId), spaceId, Date.now());
  }, [userId, spaceId]);

  // The layout owns the title while no page is rendered; a loaded space lets
  // the page set its own, and this effect stays out of the way.
  useEffect(() => {
    if (space.isPending || types.isPending) {
      document.title = "Reading the space · thing";
    } else if (error) {
      document.title = "Space · thing";
    }
  }, [space.isPending, types.isPending, error]);

  if (space.isPending || types.isPending) {
    return (
      <div className="settle grid max-w-[52ch] gap-2">
        <p className="label">space</p>
        <p className="text-[13px] text-muted">Reading the space…</p>
      </div>
    );
  }

  if (error) {
    return (
      <ErrorState
        error={error}
        subject="Space"
        onRetry={() => {
          void space.refetch();
          void types.refetch();
        }}
      />
    );
  }

  const detail = space.data;
  const typeList = types.data;
  if (!detail || !typeList) {
    return <p className="text-[13px] text-muted">Reading the space…</p>;
  }

  return (
    <div className="settle grid gap-8 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10">
      <SpaceNav spaceId={detail.id} types={typeList} role={detail.role} />
      <div className="min-w-0">
        <Outlet />
      </div>
    </div>
  );
}
