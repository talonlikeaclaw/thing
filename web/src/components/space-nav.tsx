import { ChevronDown, ChevronUp } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";

import { useAgenda, useMe, useSpace, useSpaces } from "@/api/queries";
import type { Role, SpaceSummary, TypeSummary } from "@/api/types";
import { cn } from "@/lib/cn";
import {
  DEFAULT_NAV_ORDER,
  moveNavLink,
  navOrderKey,
  readNavOrder,
  writeNavOrder,
  type NavLink,
} from "@/lib/nav-order";

interface SpaceNavProps {
  spaceId: string;
  types: TypeSummary[];
  role: Role;
}

const UTILITY: Record<NavLink, { label: string; path: string }> = {
  schedule: { label: "Schedule", path: "agenda" },
  schema: { label: "Schema", path: "schema" },
  members: { label: "Members", path: "members" },
  settings: { label: "Settings", path: "settings" },
  trash: { label: "Trash", path: "trash" },
};

/**
 * The space switcher and the space's tables, plus the utility links.
 *
 * The current link comes from the pathname, so every surface under a space
 * shares one truthful rail. Below `lg` the rail becomes a sticky disclosure
 * bar; the table is not pushed below the fold.
 */
export function SpaceNav({ spaceId, types, role }: SpaceNavProps) {
  const location = useLocation();
  const pathname = location.pathname;
  const spaces = useSpaces();
  const space = useSpace(spaceId);
  const agenda = useAgenda(spaceId);
  const me = useMe();
  const list: SpaceSummary[] = spaces.data ?? [];
  const overdue = agenda.data?.overdue.length ?? 0;
  const userId = me.data?.id;
  const [order, setOrder] = useState<NavLink[]>(DEFAULT_NAV_ORDER);
  const [reordering, setReordering] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setReordering(false);
    if (!userId) {
      setOrder([...DEFAULT_NAV_ORDER]);
      return;
    }
    setOrder(readNavOrder(window.localStorage, navOrderKey(userId, spaceId)));
  }, [userId, spaceId]);

  // A selection has already gone where it was going; put the sheet away.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setMobileOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  function move(link: NavLink, delta: number) {
    const next = moveNavLink(order, link, delta);
    setOrder(next);
    if (userId) {
      writeNavOrder(window.localStorage, navOrderKey(userId, spaceId), next);
    }
  }

  const close = () => setMobileOpen(false);

  return (
    <>
      <div className="sticky top-0 z-30 -mx-6 border-b rule bg-ground/95 px-6 py-2 backdrop-blur lg:hidden">
        <button
          type="button"
          aria-expanded={mobileOpen}
          aria-controls="space-menu"
          className="flex min-h-11 w-full items-center gap-3 text-left"
          onClick={() => setMobileOpen((open) => !open)}
        >
          {space.data?.icon ? (
            <span aria-hidden className="text-[18px] leading-none">
              {space.data.icon}
            </span>
          ) : null}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-medium">
              {space.data?.name ?? "This space"}
            </span>
            <span className="label">{role}</span>
          </span>
          <ChevronDown
            aria-hidden
            size={16}
            className={cn("shrink-0 text-muted transition-transform", mobileOpen && "rotate-180")}
          />
        </button>

        {mobileOpen ? (
          <div id="space-menu" className="max-h-[70dvh] overflow-y-auto border-t rule pt-3 pb-4">
            <SpaceSwitcher
              id="space-switcher-mobile"
              spaceId={spaceId}
              spaceName={space.data?.name ?? "This space"}
              role={role}
              list={list}
              onNavigate={close}
            />
            <div className="mt-4">
              <TypesList
                spaceId={spaceId}
                types={types}
                pathname={pathname}
                onNavigate={close}
              />
            </div>
            <div className="mt-4 border-t rule pt-3">
              <AllSpacesLink onNavigate={close} />
              <OverviewLink spaceId={spaceId} pathname={pathname} onNavigate={close} />
              <UtilityLinks
                spaceId={spaceId}
                pathname={pathname}
                order={order}
                overdue={overdue}
                reordering={reordering}
                onMove={move}
                onToggleReorder={() => setReordering((current) => !current)}
                onNavigate={close}
              />
            </div>
          </div>
        ) : null}
      </div>

      <aside className="hidden lg:sticky lg:top-6 lg:block lg:self-start">
        <SpaceSwitcher
          id="space-switcher"
          spaceId={spaceId}
          spaceName={space.data?.name ?? "This space"}
          role={role}
          list={list}
        />

        <div className="mt-4">
          <TypesList spaceId={spaceId} types={types} pathname={pathname} />
        </div>

        <div className="mt-4">
          <AllSpacesLink />
          <OverviewLink spaceId={spaceId} pathname={pathname} />
          <UtilityLinks
            spaceId={spaceId}
            pathname={pathname}
            order={order}
            overdue={overdue}
            reordering={reordering}
            onMove={move}
            onToggleReorder={() => setReordering((current) => !current)}
          />
        </div>
      </aside>
    </>
  );
}

function SpaceSwitcher({
  id,
  spaceId,
  spaceName,
  role,
  list,
  onNavigate,
}: {
  id: string;
  spaceId: string;
  spaceName: string;
  role: Role;
  list: SpaceSummary[];
  onNavigate?: () => void;
}) {
  const navigate = useNavigate();
  return (
    <div className="border-b rule pb-3">
      <label className="label" htmlFor={id}>
        Space
      </label>
      <select
        id={id}
        className="mt-1 h-9 w-full rounded-field border border-line-interactive bg-ground px-2 text-[14px] text-ink transition-colors hover:border-line-strong focus:border-accent pointer-coarse:h-11 pointer-coarse:text-[16px]"
        value={spaceId}
        onChange={(event) => {
          if (event.target.value !== spaceId) {
            navigate(`/s/${event.target.value}`);
            onNavigate?.();
          }
        }}
      >
        {list.some((entry) => entry.id === spaceId) ? null : (
          <option value={spaceId}>{spaceName}</option>
        )}
        {list.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.icon ? `${entry.icon} ` : ""}
            {entry.name}
          </option>
        ))}
      </select>
      <p className="mt-1 font-mono text-[10px] text-faint">{role}</p>
    </div>
  );
}

function TypesList({
  spaceId,
  types,
  pathname,
  onNavigate,
}: {
  spaceId: string;
  types: TypeSummary[];
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="label">Types</span>
        <span className="label tnum">{types.length}</span>
      </div>
      {types.length === 0 ? (
        <p className="mt-2 text-[12px] text-muted">No types yet.</p>
      ) : (
        <ul className="mt-1">
          {types.map((type) => {
            const to = `/s/${spaceId}/t/${type.key}`;
            const active = pathname === to;
            return (
              <li key={type.key} className="border-b rule">
                <Link
                  to={to}
                  aria-current={active ? "page" : undefined}
                  onClick={onNavigate}
                  className={cn(
                    "flex items-baseline justify-between gap-2 py-2 text-[14px] transition-colors hover:text-accent pointer-coarse:min-h-11",
                    active && "text-accent",
                  )}
                >
                  <span className="flex min-w-0 items-baseline gap-1.5">
                    {type.icon ? (
                      <span aria-hidden className="leading-none">
                        {type.icon}
                      </span>
                    ) : null}
                    <span className="truncate">{type.name_plural}</span>
                  </span>
                  <span className="label tnum shrink-0">{type.object_count}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function AllSpacesLink({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="border-b rule pb-2">
      <Link
        to="/"
        onClick={onNavigate}
        className="label flex py-1 transition-colors hover:text-accent pointer-coarse:min-h-11 pointer-coarse:content-center"
      >
        All spaces
      </Link>
    </div>
  );
}

function OverviewLink({
  spaceId,
  pathname,
  onNavigate,
}: {
  spaceId: string;
  pathname: string;
  onNavigate?: () => void;
}) {
  const to = `/s/${spaceId}`;
  const active = pathname === to;
  return (
    <div className="border-b rule">
      <Link
        to={to}
        aria-current={active ? "page" : undefined}
        onClick={onNavigate}
        className={cn(
          "label flex py-1 transition-colors hover:text-accent pointer-coarse:min-h-11 pointer-coarse:content-center",
          active && "text-accent",
        )}
      >
        Overview
      </Link>
    </div>
  );
}

function UtilityLinks({
  spaceId,
  pathname,
  order,
  overdue,
  reordering,
  onMove,
  onToggleReorder,
  onNavigate,
}: {
  spaceId: string;
  pathname: string;
  order: NavLink[];
  overdue: number;
  reordering: boolean;
  onMove: (link: NavLink, delta: number) => void;
  onToggleReorder: () => void;
  onNavigate?: () => void;
}) {
  return (
    <>
      <ul className="mt-2 flex flex-col gap-1.5">
        {order.map((key, index) => {
          const item = UTILITY[key];
          const to = `/s/${spaceId}/${item.path}`;
          const active = pathname === to;
          return (
            <li key={key} className="flex items-center gap-1">
              <Link
                to={to}
                aria-current={active ? "page" : undefined}
                onClick={onNavigate}
                className={cn(
                  "label flex min-w-0 flex-1 items-center justify-between gap-2 py-1 transition-colors hover:text-accent pointer-coarse:min-h-11 pointer-coarse:content-center",
                  active && "text-accent",
                )}
              >
                <span>{item.label}</span>
                {key === "schedule" && overdue > 0 ? (
                  <span
                    className="rounded-full border border-danger px-1.5 text-[10px] tnum text-danger"
                    title={`${overdue} overdue`}
                  >
                    {overdue}
                  </span>
                ) : null}
              </Link>
              {reordering ? (
                <span className="flex shrink-0 items-center">
                  <button
                    type="button"
                    aria-label={`Move ${item.label} up`}
                    disabled={index === 0}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-[3px] text-faint transition-colors hover:bg-raised hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-faint pointer-coarse:h-11 pointer-coarse:w-11"
                    onClick={() => onMove(key, -1)}
                  >
                    <ChevronUp aria-hidden size={13} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${item.label} down`}
                    disabled={index === order.length - 1}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-[3px] text-faint transition-colors hover:bg-raised hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-faint pointer-coarse:h-11 pointer-coarse:w-11"
                    onClick={() => onMove(key, 1)}
                  >
                    <ChevronDown aria-hidden size={13} />
                  </button>
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
      <div className="mt-1 flex justify-end">
        <button
          type="button"
          aria-pressed={reordering}
          className="label py-1 text-faint transition-colors hover:text-accent pointer-coarse:min-h-11 pointer-coarse:content-center"
          onClick={onToggleReorder}
        >
          {reordering ? "Done" : "Reorder links"}
        </button>
      </div>
    </>
  );
}
