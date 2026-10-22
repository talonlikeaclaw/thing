import { Link, useNavigate } from "react-router";

import { useAgenda, useSpace, useSpaces } from "@/api/queries";
import type { Role, SpaceSummary, TypeSummary } from "@/api/types";
import { cn } from "@/lib/cn";

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
  const navigate = useNavigate();
  const list: SpaceSummary[] = spaces.data ?? [];
  const overdue = agenda.data?.overdue.length ?? 0;

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

      <div className="mt-4 flex flex-col gap-1.5">
        <Link
          to={`/s/${spaceId}/agenda`}
          aria-current={selected === "schedule" ? "page" : undefined}
          className={cn(
            "label flex items-center justify-between gap-2 py-1 transition-colors hover:text-accent pointer-coarse:min-h-11 pointer-coarse:content-center",
            selected === "schedule" && "text-accent",
          )}
        >
          <span>Schedule</span>
          {overdue > 0 ? (
            <span
              className="rounded-full border border-danger px-1.5 text-[10px] tnum text-danger"
              title={`${overdue} overdue`}
            >
              {overdue}
            </span>
          ) : null}
        </Link>
        <Link
          to={`/s/${spaceId}/schema`}
          className="label py-1 transition-colors hover:text-accent pointer-coarse:min-h-11 pointer-coarse:content-center"
        >
          Schema
        </Link>
        <Link
          to={`/s/${spaceId}/members`}
          className="label py-1 transition-colors hover:text-accent pointer-coarse:min-h-11 pointer-coarse:content-center"
        >
          Members
        </Link>
        <Link
          to={`/s/${spaceId}/settings`}
          className="label py-1 transition-colors hover:text-accent pointer-coarse:min-h-11 pointer-coarse:content-center"
        >
          Settings
        </Link>
        <Link
          to={`/s/${spaceId}/trash`}
          className="label py-1 transition-colors hover:text-accent pointer-coarse:min-h-11 pointer-coarse:content-center"
        >
          Trash
        </Link>
        <Link
          to="/"
          className="label py-1 transition-colors hover:text-accent pointer-coarse:min-h-11 pointer-coarse:content-center"
        >
          All spaces
        </Link>
      </div>
    </aside>
  );
}
