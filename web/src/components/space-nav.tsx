import { ChevronDown, ChevronUp } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";

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
  selectedTypeKey?: string;
  /** Marks the Schedule link so it carries `aria-current` on its own page. */
  selected?: "schedule";
  role: Role;
}

/** The space switcher and the space's tables; the rail every space surface shares. */
export function SpaceNav({ spaceId, types, selectedTypeKey, selected, role }: SpaceNavProps) {
  const spaces = useSpaces();
  const space = useSpace(spaceId);
  const agenda = useAgenda(spaceId);
  const me = useMe();
  const navigate = useNavigate();
  const list: SpaceSummary[] = spaces.data ?? [];
  const overdue = agenda.data?.overdue.length ?? 0;
  const userId = me.data?.id;
  const [order, setOrder] = useState<NavLink[]>(DEFAULT_NAV_ORDER);
  const [reordering, setReordering] = useState(false);

  useEffect(() => {
    setReordering(false);
    if (!userId) {
      setOrder([...DEFAULT_NAV_ORDER]);
      return;
    }
    setOrder(readNavOrder(window.localStorage, navOrderKey(userId, spaceId)));
  }, [userId, spaceId]);

  const links: Record<
    NavLink,
    { label: string; to: string; current: boolean; badge?: number }
  > = {
    schedule: {
      label: "Schedule",
      to: `/s/${spaceId}/agenda`,
      current: selected === "schedule",
      ...(overdue > 0 ? { badge: overdue } : {}),
    },
    schema: { label: "Schema", to: `/s/${spaceId}/schema`, current: false },
    members: { label: "Members", to: `/s/${spaceId}/members`, current: false },
    settings: { label: "Settings", to: `/s/${spaceId}/settings`, current: false },
    trash: { label: "Trash", to: `/s/${spaceId}/trash`, current: false },
  };

  function move(link: NavLink, delta: number) {
    const next = moveNavLink(order, link, delta);
    setOrder(next);
    if (userId) {
      writeNavOrder(window.localStorage, navOrderKey(userId, spaceId), next);
    }
  }

  return (
    <aside className="lg:sticky lg:top-6 lg:self-start">
      <div className="border-b rule pb-3">
        <label className="label" htmlFor="space-switcher">
          Space
        </label>
        <select
          id="space-switcher"
          className="mt-1 h-9 w-full rounded-field border border-line bg-ground px-2 text-[14px] text-ink transition-colors hover:border-line-strong focus:border-accent pointer-coarse:h-11 pointer-coarse:text-[16px]"
          value={spaceId}
          onChange={(event) => {
            if (event.target.value !== spaceId) {
              navigate(`/s/${event.target.value}`);
            }
          }}
        >
          {list.some((entry) => entry.id === spaceId) ? null : (
            <option value={spaceId}>{space.data?.name ?? "This space"}</option>
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

      <div className="mt-4">
        <div className="flex items-baseline justify-between">
          <span className="label">Types</span>
          <span className="label tnum">{types.length}</span>
        </div>
        {types.length === 0 ? (
          <p className="mt-2 text-[12px] text-muted">No types yet.</p>
        ) : (
          <ul className="mt-1">
            {types.map((type) => {
              const active = type.key === selectedTypeKey;
              return (
                <li key={type.key} className="border-b rule">
                  <Link
                    to={`/s/${spaceId}/t/${type.key}`}
                    aria-current={active ? "page" : undefined}
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

      <div className="mt-4">
        <div className="border-b rule pb-2">
          <Link
            to="/"
            className="label flex py-1 transition-colors hover:text-accent pointer-coarse:min-h-11 pointer-coarse:content-center"
          >
            All spaces
          </Link>
        </div>
        <ul className="mt-2 flex flex-col gap-1.5">
          {order.map((key, index) => {
            const link = links[key];
            return (
              <li key={key} className="flex items-center gap-1">
                <Link
                  to={link.to}
                  aria-current={link.current ? "page" : undefined}
                  className={cn(
                    "label flex min-w-0 flex-1 items-center justify-between gap-2 py-1 transition-colors hover:text-accent pointer-coarse:min-h-11 pointer-coarse:content-center",
                    link.current && "text-accent",
                  )}
                >
                  <span>{link.label}</span>
                  {link.badge ? (
                    <span
                      className="rounded-full border border-danger px-1.5 text-[10px] tnum text-danger"
                      title={`${link.badge} overdue`}
                    >
                      {link.badge}
                    </span>
                  ) : null}
                </Link>
                {reordering ? (
                  <span className="flex shrink-0 items-center">
                    <button
                      type="button"
                      aria-label={`Move ${link.label} up`}
                      disabled={index === 0}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-[3px] text-faint transition-colors hover:bg-raised hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-faint pointer-coarse:h-11 pointer-coarse:w-11"
                      onClick={() => move(key, -1)}
                    >
                      <ChevronUp aria-hidden size={13} />
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${link.label} down`}
                      disabled={index === order.length - 1}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-[3px] text-faint transition-colors hover:bg-raised hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-faint pointer-coarse:h-11 pointer-coarse:w-11"
                      onClick={() => move(key, 1)}
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
            onClick={() => setReordering((current) => !current)}
          >
            {reordering ? "Done" : "Reorder links"}
          </button>
        </div>
      </div>
    </aside>
  );
}
