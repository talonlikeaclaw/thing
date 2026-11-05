import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Outlet, useParams } from "react-router";

import { useMe, useSpace, useTypes, useUpdateSpace } from "@/api/queries";
import { ErrorState } from "@/components/error-state";
import { SpaceNav } from "@/components/space-nav";
import {
  DEFAULT_ACCENT,
  applyAccent,
  clearStoredAccent,
  isAccentId,
  readStoredAccent,
  resetAccent,
  storedAccentKey,
  type AccentId,
} from "@/lib/accent";
import {
  DEFAULT_RAIL,
  railKey,
  readRail,
  writeRail,
  type RailWidth,
} from "@/lib/rail";
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
  const update = useUpdateSpace(spaceId ?? "");
  const error = space.error ?? types.error;
  const userId = me.data?.id;

  // The desktop rail folds per reader and space; the phone never uses this.
  const [rail, setRail] = useState<RailWidth>(DEFAULT_RAIL);
  const railStorage = userId && spaceId ? railKey(userId, spaceId) : null;
  useEffect(() => {
    setRail(railStorage ? readRail(window.localStorage, railStorage) : DEFAULT_RAIL);
  }, [railStorage]);
  const setRailWidth = (width: RailWidth) => {
    setRail(width);
    if (railStorage) {
      writeRail(window.localStorage, railStorage, width);
    }
  };

  // The shared accent: the space's own preset, else a one-time seed from the
  // v0.4 browser-local choice, else Lichen. `SpaceLayout` is the only applier.
  const shared = space.data?.accent;
  const [seed, setSeed] = useState<AccentId | null>(null);
  const seeded = useRef(false);
  const accent = isAccentId(shared) ? shared : (seed ?? DEFAULT_ACCENT);

  useLayoutEffect(() => {
    applyAccent(document.documentElement, accent);
    return () => resetAccent(document.documentElement);
  }, [accent]);

  // The shared value wins once it exists; drop this user's stale local key.
  useEffect(() => {
    if (!userId || !spaceId || !shared) {
      return;
    }
    clearStoredAccent(window.localStorage, storedAccentKey(userId, spaceId));
  }, [userId, spaceId, shared]);

  // An owner's old local choice seeds the space once. A failure leaves the
  // key in place and falls back to Lichen for this session; the next load
  // retries. A non-owner never seeds the shared appearance.
  useEffect(() => {
    if (!space.data || space.data.role !== "owner" || shared || !userId || !spaceId) {
      return;
    }
    if (seeded.current) {
      return;
    }
    seeded.current = true;
    const key = storedAccentKey(userId, spaceId);
    const stored = readStoredAccent(window.localStorage, key);
    if (stored === DEFAULT_ACCENT) {
      return;
    }
    setSeed(stored);
    update.mutate(
      { accent: stored },
      {
        onSuccess: () => {
          clearStoredAccent(window.localStorage, key);
          setSeed(null);
        },
        onError: () => setSeed(null),
      },
    );
  }, [space.data, shared, userId, spaceId, update]);

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
    // The page footer already clears the phone bar (`max-lg:pb-24`), so the
    // layout adds no second reservation beneath the last block.
    <div
      data-rail={rail}
      className="settle grid gap-8 duration-[180ms] ease-[cubic-bezier(0.2,0,0,1)] motion-safe:transition-[grid-template-columns] motion-reduce:transition-none lg:grid-cols-[var(--rail-w)_minmax(0,1fr)] lg:gap-10"
    >
      <SpaceNav
        spaceId={detail.id}
        types={typeList}
        role={detail.role}
        folded={rail === "folded"}
        onToggleFold={() => setRailWidth(rail === "folded" ? "wide" : "folded")}
        onUnfold={() => setRail("wide")}
      />
      <div className="min-w-0">
        <Outlet />
      </div>
    </div>
  );
}
