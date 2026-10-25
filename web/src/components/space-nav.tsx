import { Dialog } from "@base-ui/react/dialog";
import { ChevronDown, ChevronUp, Plus, Search, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useNavigate } from "react-router";

import { useAgenda, useMe, useSpace, useSpaces } from "@/api/queries";
import type { Role, SpaceSummary, TypeSummary } from "@/api/types";
import { useHandedness } from "@/components/handedness";
import { usePalette } from "@/components/palette-context";
import { useQuickCapture } from "@/components/quick-capture";
import { ThingIcon } from "@/components/thing-icon";
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
 * shares one truthful rail. Below `lg` the rail becomes a bottom bar that
 * opens the same links as a sheet, within reach of a thumb; the table is not
 * pushed below the fold.
 */
export function SpaceNav({ spaceId, types, role }: SpaceNavProps) {
  const location = useLocation();
  const pathname = location.pathname;
  const spaces = useSpaces();
  const space = useSpace(spaceId);
  const agenda = useAgenda(spaceId);
  const me = useMe();
  const capture = useQuickCapture();
  const openPalette = usePalette();
  const { handedness } = useHandedness();
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

  const spaceLabel = (
    <span
      key="label"
      className={cn(
        "flex min-w-0 flex-1 items-center gap-3",
        handedness === "left" && "justify-end",
      )}
    >
      <ThingIcon icon={space.data?.icon} size="md" />
      <span className={cn("min-w-0", handedness === "left" ? "text-right" : "flex-1")}>
        <span className="block truncate text-[15px] font-medium">
          {space.data?.name ?? "This space"}
        </span>
        <span className="label">{role}</span>
      </span>
    </span>
  );

  const spaceChevron = (
    <ChevronUp key="chevron" aria-hidden size={16} className="shrink-0 text-muted" />
  );

  // The chevron stays on the inner edge, beside Capture/Search, so the title
  // and icon keep the outer corner: trailing edge in right mode, leading in
  // left mode.
  const spaceTrigger = (
    <Dialog.Trigger
      key="space"
      aria-label={`Space menu for ${space.data?.name ?? "this space"}`}
      className={cn(
        "flex min-h-14 min-w-0 flex-1 items-center gap-3 text-left",
        handedness === "left" ? "pl-1" : "pr-1",
      )}
    >
      {handedness === "left" ? (
        <>
          {spaceChevron}
          {spaceLabel}
        </>
      ) : (
        <>
          {spaceLabel}
          {spaceChevron}
        </>
      )}
    </Dialog.Trigger>
  );

  const captureAction = (
    <BarAction key="capture" label="Capture a record (C)" onClick={() => capture.open()}>
      <Plus aria-hidden size={17} />
    </BarAction>
  );

  const searchAction = (
    <BarAction key="search" label="Search and commands" onClick={openPalette}>
      <Search aria-hidden size={17} />
    </BarAction>
  );

  // Search stays on the outer edge in both modes: trailing on the right,
  // leading on the left, so the two actions keep the same relationship to the
  // screen corner the thumb reaches.
  const barActions = (
    <span key="actions" className="flex shrink-0 items-center gap-1">
      {handedness === "left" ? (
        <>
          {searchAction}
          {capture.available ? captureAction : null}
        </>
      ) : (
        <>
          {capture.available ? captureAction : null}
          {searchAction}
        </>
      )}
    </span>
  );

  const sheetTitle = (
    <Dialog.Title key="title" className="label">
      Space navigation
    </Dialog.Title>
  );

  const sheetClose = (
    <Dialog.Close
      key="close"
      aria-label="Close space navigation"
      className={cn(
        "inline-flex min-h-11 min-w-11 items-center justify-center rounded-field text-faint transition-colors hover:text-ink",
        handedness === "left" ? "-ml-2" : "-mr-2",
      )}
    >
      <X aria-hidden size={17} />
    </Dialog.Close>
  );

  return (
    <>
      <Dialog.Root open={mobileOpen} onOpenChange={setMobileOpen}>
        {/* The page wrapper animates a transform, which would become the
            containing block of a fixed child; the bar lives on the body. */}
        {createPortal(
          <div className="fixed inset-x-0 bottom-0 z-40 border-t rule bg-ground/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
            <div className="flex items-center gap-1 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))]">
              {handedness === "left" ? (
                <>
                  {barActions}
                  {spaceTrigger}
                </>
              ) : (
                <>
                  {spaceTrigger}
                  {barActions}
                </>
              )}
            </div>
          </div>,
          document.body,
        )}

        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-40 bg-ground/85 lg:hidden" />
          <Dialog.Viewport className="fixed inset-0 z-50 flex items-end lg:hidden">
            <Dialog.Popup className="max-h-[85dvh] w-full overflow-y-auto rounded-t-sheet border border-line bg-surface pt-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pl-[max(1.5rem,env(safe-area-inset-left))] pr-[max(1.5rem,env(safe-area-inset-right))]">
              <div
                className={cn(
                  "flex items-center gap-3",
                  handedness === "left" ? "justify-start" : "justify-between",
                )}
              >
                {handedness === "left" ? (
                  <>
                    {sheetClose}
                    {sheetTitle}
                  </>
                ) : (
                  <>
                    {sheetTitle}
                    {sheetClose}
                  </>
                )}
              </div>
              <Dialog.Description className="sr-only">
                Switch spaces, open a type, or reach a space page.
              </Dialog.Description>

              <SpaceSwitcher
                id="space-switcher-mobile"
                spaceId={spaceId}
                spaceName={space.data?.name ?? "This space"}
                role={role}
                list={list}
                onNavigate={close}
              />
              <div className="mt-4">
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
              <div className="mt-4 border-t rule pt-3">
                <TypesList
                  spaceId={spaceId}
                  types={types}
                  pathname={pathname}
                  onNavigate={close}
                />
              </div>
            </Dialog.Popup>
          </Dialog.Viewport>
        </Dialog.Portal>
      </Dialog.Root>

      <aside className="hidden lg:sticky lg:top-6 lg:block lg:self-start">
        <SpaceSwitcher
          id="space-switcher"
          spaceId={spaceId}
          spaceName={space.data?.name ?? "This space"}
          role={role}
          list={list}
        />

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

        <div className="mt-4 border-t rule pt-3">
          <TypesList spaceId={spaceId} types={types} pathname={pathname} />
        </div>
      </aside>
    </>
  );
}

/** A 44px icon action in the phone's bottom bar. */
function BarAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-field text-muted transition-colors hover:bg-raised hover:text-ink"
      onClick={onClick}
    >
      {children}
    </button>
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
                    "flex min-h-9 items-center justify-between gap-2 px-1 py-2 text-[14px] transition-colors hover:bg-raised hover:text-accent pointer-coarse:min-h-11",
                    active && "text-accent",
                  )}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <ThingIcon icon={type.icon} size="sm" />
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
    <div className="border-b rule">
      <Link
        to="/"
        onClick={onNavigate}
        className="label flex min-h-9 items-center px-1 py-2 transition-colors hover:bg-raised hover:text-accent pointer-coarse:min-h-11"
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
          "label flex min-h-9 items-center px-1 py-2 transition-colors hover:bg-raised hover:text-accent pointer-coarse:min-h-11",
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
  const { handedness } = useHandedness();
  return (
    <>
      <ul className="flex flex-col">
        {order.map((key, index) => {
          const item = UTILITY[key];
          const to = `/s/${spaceId}/${item.path}`;
          const active = pathname === to;
          return (
            <li key={key} className="flex items-center gap-1 border-b rule">
              <Link
                to={to}
                aria-current={active ? "page" : undefined}
                onClick={onNavigate}
                className={cn(
                  "label flex min-h-9 min-w-0 flex-1 items-center justify-between gap-2 px-1 py-2 transition-colors hover:bg-raised hover:text-accent pointer-coarse:min-h-11",
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
      <div
        className={cn(
          "mt-2 flex",
          handedness === "left" ? "justify-start" : "justify-end",
        )}
      >
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
