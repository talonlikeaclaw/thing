import { Dialog } from "@base-ui/react/dialog";
import {
  ArrowUpDown,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronUp,
  House,
  LayoutGrid,
  Plus,
  Search,
  Settings,
  Shapes,
  Table2,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useNavigate } from "react-router";

import { useAgenda, useMe, useSpace, useSpaces } from "@/api/queries";
import type { Role, SpaceSummary, TypeSummary } from "@/api/types";
import { useConnection } from "@/components/connection-context";
import { useHandedness } from "@/components/handedness";
import { usePalette } from "@/components/palette-context";
import { useQuickCapture } from "@/components/quick-capture";
import { ThingIcon } from "@/components/thing-icon";
import { SheetPopup, SheetViewport } from "@/components/ui/sheet";
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

const UTILITY: Record<NavLink, { label: string; path: string; icon: typeof House }> = {
  schedule: { label: "Schedule", path: "agenda", icon: CalendarDays },
  schema: { label: "Schema", path: "schema", icon: Shapes },
  members: { label: "Members", path: "members", icon: Users },
  settings: { label: "Settings", path: "settings", icon: Settings },
  trash: { label: "Trash", path: "trash", icon: Trash2 },
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
  const connection = useConnection();
  const list: SpaceSummary[] = spaces.data ?? [];
  const overdue = agenda.data?.overdue.length ?? 0;
  const userId = me.data?.id;
  const [order, setOrder] = useState<NavLink[]>(DEFAULT_NAV_ORDER);
  const [reordering, setReordering] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [typesBelow, setTypesBelow] = useState(false);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const typesRef = useRef<HTMLDivElement | null>(null);

  // When the type list sits below the sheet's fold, say so at the bottom edge
  // and make that strip a jump to it. The section heading alone is not enough:
  // a phone at 85dvh can hide it entirely behind the space and page links.
  useEffect(() => {
    if (!mobileOpen || typeof IntersectionObserver === "undefined") {
      setTypesBelow(false);
      return;
    }
    let observer: IntersectionObserver | null = null;
    let frame = 0;
    const attach = () => {
      const scrollport = sheetRef.current;
      const section = typesRef.current;
      if (!scrollport || !section) {
        frame = requestAnimationFrame(attach);
        return;
      }
      // Pixels only: IntersectionObserver refuses `rem` in `rootMargin`.
      observer = new IntersectionObserver(
        (entries) => setTypesBelow(!entries.some((entry) => entry.isIntersecting)),
        { root: scrollport, rootMargin: "0px 0px -56px 0px" },
      );
      observer.observe(section);
    };
    attach();
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [mobileOpen, types.length]);

  function showTypes() {
    typesRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

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

  // The chevron belongs to the name, not to the row's far edge: it shows the
  // name opens a sheet without detaching from it.
  const spaceChevron = <ChevronUp aria-hidden size={16} className="shrink-0 text-muted" />;

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
        <span
          className={cn(
            "flex min-w-0 items-center gap-1",
            handedness === "left" && "flex-row-reverse",
          )}
        >
          <span className="truncate text-[15px] font-medium">
            {space.data?.name ?? "This space"}
          </span>
          {spaceChevron}
        </span>
        <span className="label">{role}</span>
      </span>
    </span>
  );

  const spaceTrigger = (
    <Dialog.Trigger
      key="space"
      aria-label={`Space menu for ${space.data?.name ?? "this space"}`}
      className={cn(
        "flex min-h-14 min-w-0 flex-1 items-center gap-3 text-left",
        handedness === "left" ? "pl-1" : "pr-1",
      )}
    >
      {spaceLabel}
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
      {/* The header's connection line is hidden below `sm`; the bar keeps the
          self-hoster's only live signal as a dot. */}
      {connection === "live" ? null : (
        <span
          role="status"
          title={connection === "connecting" ? "Connecting…" : "Offline, reconnecting"}
          className="inline-flex w-3 shrink-0 items-center justify-center"
        >
          <span aria-hidden className="h-2 w-2 rounded-full bg-warning" />
          <span className="sr-only">
            {connection === "connecting" ? "Connecting…" : "Offline, reconnecting…"}
          </span>
        </span>
      )}
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

  // Pinned beside the close control: the utilities list is the part most likely
  // to be cut by the sheet's fold, so its toggle must not live there.
  const sheetReorder = (
    <button
      key="reorder"
      type="button"
      aria-pressed={reordering}
      className="label inline-flex min-h-9 items-center gap-1.5 rounded-field px-1.5 text-faint transition-colors hover:text-accent pointer-coarse:min-h-11"
      onClick={() => setReordering((current) => !current)}
    >
      {reordering ? (
        <Check aria-hidden size={13} />
      ) : (
        <ArrowUpDown aria-hidden size={13} />
      )}
      {reordering ? "Done" : "Reorder"}
    </button>
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
          <SheetViewport placement="bottom" className="lg:hidden">
            <SheetPopup>
              <div className="shrink-0 pt-4 pl-[max(1.5rem,env(safe-area-inset-left))] pr-[max(1.5rem,env(safe-area-inset-right))]">
                <div
                  className={cn(
                    "flex items-center gap-3",
                    handedness === "left" ? "justify-start" : "justify-between",
                  )}
                >
                  {handedness === "left" ? (
                    <>
                      <span className="flex shrink-0 items-center gap-1">
                        {sheetClose}
                        {sheetReorder}
                      </span>
                      {sheetTitle}
                    </>
                  ) : (
                    <>
                      {sheetTitle}
                      <span className="flex shrink-0 items-center gap-1">
                        {sheetReorder}
                        {sheetClose}
                      </span>
                    </>
                  )}
                </div>
                <Dialog.Description className="sr-only">
                  Switch spaces, open a type, or reach a space page.
                </Dialog.Description>
              </div>
              <div
                ref={sheetRef}
                className="min-h-0 flex-1 overflow-y-auto overscroll-contain pt-3 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pl-[max(1.5rem,env(safe-area-inset-left))] pr-[max(1.5rem,env(safe-area-inset-right))]"
              >
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
                    showReorderControl={false}
                  />
                </div>
                <div ref={typesRef} className="mt-4 border-t rule pt-3">
                  <TypesList
                    spaceId={spaceId}
                    types={types}
                    pathname={pathname}
                    onNavigate={close}
                  />
                </div>
              </div>
              {typesBelow ? (
                <button
                  type="button"
                  aria-label={`Show ${types.length === 1 ? "the type" : `${types.length} types`} below`}
                  className="flex min-h-12 shrink-0 items-center justify-between gap-3 border-t rule bg-raised/60 pl-[max(1.5rem,env(safe-area-inset-left))] pr-[max(1.5rem,env(safe-area-inset-right))] pb-[calc(0.5rem+env(safe-area-inset-bottom))] pt-2 text-left transition-colors hover:bg-raised"
                  onClick={showTypes}
                >
                  {handedness === "left" ? (
                    <ChevronDown aria-hidden size={16} className="text-muted" />
                  ) : null}
                  <span className="flex items-baseline gap-2">
                    <span className="label">Types</span>
                    <span className="tnum text-[12px] text-accent">{types.length}</span>
                    <span className="text-[13px] text-muted">below</span>
                  </span>
                  {handedness === "left" ? null : (
                    <ChevronDown aria-hidden size={16} className="text-muted" />
                  )}
                </button>
              ) : null}
            </SheetPopup>
          </SheetViewport>
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
      <p className="mt-1 font-mono text-[11px] text-faint">{role}</p>
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
        <span className="flex items-center gap-1.5">
          <Table2 aria-hidden size={14} className="shrink-0 text-muted" />
          <span className="label">Types</span>
        </span>
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
        className="label flex min-h-9 items-center gap-2 px-1 py-2 transition-colors hover:bg-raised hover:text-accent pointer-coarse:min-h-11"
      >
        <LayoutGrid aria-hidden size={14} className="shrink-0" />
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
          "label flex min-h-9 items-center gap-2 px-1 py-2 transition-colors hover:bg-raised hover:text-accent pointer-coarse:min-h-11",
          active && "text-accent",
        )}
      >
        <House aria-hidden size={14} className="shrink-0" />
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
  showReorderControl,
}: {
  spaceId: string;
  pathname: string;
  order: NavLink[];
  overdue: number;
  reordering: boolean;
  onMove: (link: NavLink, delta: number) => void;
  onToggleReorder: () => void;
  onNavigate?: () => void;
  /** False when the caller pins the toggle itself, as the phone sheet does. */
  showReorderControl?: boolean;
}) {
  const { handedness } = useHandedness();
  return (
    <>
      <ul className="flex flex-col">
        {order.map((key, index) => {
          const item = UTILITY[key];
          const Icon = item.icon;
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
                <span className="flex min-w-0 items-center gap-2">
                  <Icon aria-hidden size={14} className="shrink-0" />
                  <span>{item.label}</span>
                </span>
                {key === "schedule" && overdue > 0 ? (
                  <span
                    className="rounded-full border border-danger px-1.5 text-[11px] tnum text-danger"
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
      {showReorderControl === false ? null : (
        <div
          className={cn(
            "mt-2 flex",
            handedness === "left" ? "justify-start" : "justify-end",
          )}
        >
          <button
            type="button"
            aria-pressed={reordering}
            className="label inline-flex items-center gap-1.5 py-1 text-faint transition-colors hover:text-accent pointer-coarse:min-h-11 pointer-coarse:content-center"
            onClick={onToggleReorder}
          >
            {reordering ? (
              <Check aria-hidden size={13} />
            ) : (
              <ArrowUpDown aria-hidden size={13} />
            )}
            {reordering ? "Done" : "Reorder links"}
          </button>
        </div>
      )}
    </>
  );
}
