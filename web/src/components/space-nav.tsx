import { Dialog } from "@base-ui/react/dialog";
import {
  ArrowUpDown,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronUp,
  House,
  Images,
  Keyboard,
  LayoutGrid,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings,
  Shapes,
  Table2,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useNavigate } from "react-router";

import { useAgenda, useMe, useSpace, useSpaces } from "@/api/queries";
import type { Role, SpaceSummary, TypeSummary } from "@/api/types";
import { useThumbHandedness } from "@/components/handedness";
import { usePalette } from "@/components/palette-context";
import { useQuickCapture } from "@/components/quick-capture";
import { useShortcuts } from "@/components/shortcut-context";
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
import { PHONE_SPACE_SLOT_ID } from "@/lib/phone";

interface SpaceNavProps {
  spaceId: string;
  types: TypeSummary[];
  role: Role;
  /** The desktop rail's width; the phone sheet never folds. */
  folded?: boolean;
  onToggleFold?: () => void;
  /** Unfold without writing the reader's preference, as Reorder does. */
  onUnfold?: () => void;
}

const UTILITY: Record<NavLink, { label: string; path: string; icon: typeof House }> = {
  schedule: { label: "Schedule", path: "agenda", icon: CalendarDays },
  schema: { label: "Schema", path: "schema", icon: Shapes },
  library: { label: "Library", path: "library", icon: Images },
  members: { label: "Members", path: "members", icon: Users },
  settings: { label: "Settings", path: "settings", icon: Settings },
  trash: { label: "Trash", path: "trash", icon: Trash2 },
};

/**
 * One rail row. Quiet at rest; the current page is ink text behind a 2px
 * accent rule, never a filled chip, so the rail stays a list rather than a
 * toolbar.
 */
function railItem(active: boolean, folded = false) {
  return cn(
    "flex min-h-9 min-w-0 items-center gap-2 rounded-full py-2 pl-3 pr-2 text-[14px] text-muted transition-colors hover:bg-raised/60 hover:text-ink pointer-coarse:min-h-11",
    active && "bg-accent-wash text-accent-on-wash",
    folded && "size-11 min-h-11 justify-center gap-0 p-0",
  );
}

/**
 * The space switcher and the space's tables, plus the utility links.
 *
 * The current link comes from the pathname, so every surface under a space
 * shares one truthful rail. Below `lg` the rail becomes a bottom bar that
 * opens the same links as a sheet, within reach of a thumb; the table is not
 * pushed below the fold.
 */
export function SpaceNav({
  spaceId,
  types,
  role,
  folded = false,
  onToggleFold,
  onUnfold,
}: SpaceNavProps) {
  const location = useLocation();
  const pathname = location.pathname;
  const spaces = useSpaces();
  const space = useSpace(spaceId);
  const agenda = useAgenda(spaceId, { days: 14 });
  const me = useMe();
  const capture = useQuickCapture();
  const palette = usePalette();
  const shortcuts = useShortcuts();
  const handedness = useThumbHandedness();
  const list: SpaceSummary[] = spaces.data ?? [];
  // The rail badge reports the whole space, never a page filter: every overdue
  // row is inside the default window.
  const overdue = agenda.data?.rows.filter((row) => row.status === "overdue").length ?? 0;
  const userId = me.data?.id;
  const [order, setOrder] = useState<NavLink[]>(DEFAULT_NAV_ORDER);
  const [reordering, setReordering] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [typesBelow, setTypesBelow] = useState(false);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const typesRef = useRef<HTMLDivElement | null>(null);
  // The shell owns the header; the space sheet owns its trigger. The trigger
  // is portalled into the header slot after mount, because the header is not
  // in the DOM yet when this component first renders.
  const [phoneSlot, setPhoneSlot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setPhoneSlot(document.getElementById(PHONE_SPACE_SLOT_ID));
  }, []);

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

  // The header names the space and opens the same sheet. The chevron points
  // down because the sheet rises from the bottom of the screen.
  const phoneSpaceTrigger = (
    <Dialog.Trigger
      key="space-header"
      aria-label={`Switch space, currently ${space.data?.name ?? "this space"}`}
      className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-field px-1.5 text-left transition-colors hover:bg-raised data-[popup-open]:text-ink"
    >
      <ThingIcon icon={space.data?.icon} name={space.data?.name} size="sm" />
      <span className="min-w-0 flex-1 truncate text-[14px] text-ink">
        {space.data?.name ?? "This space"}
      </span>
      <ChevronDown aria-hidden size={14} className="shrink-0 text-faint" />
    </Dialog.Trigger>
  );

  // The bottom bar keeps the sheet within thumb reach. It is a labelled
  // destination, not a second bare icon, so it reads apart from Capture and
  // Search and shares their active marker.
  // The trigger owns the bar's empty width, not just its icon: a thumb lands
  // on "the left of the bar", so the whole idle area opens the space sheet and
  // its contents sit against their own edge.
  const spaceTrigger = (
    <Dialog.Trigger
      key="space"
      aria-label={`Space menu for ${space.data?.name ?? "this space"}`}
      className={cn(barTab(mobileOpen), "justify-self-stretch")}
    >
      <span
        aria-hidden
        className={cn(
          "grid size-8 place-items-center rounded-full transition-colors",
          mobileOpen && "bg-accent-wash text-accent-on-wash",
        )}
      >
        <ThingIcon icon={space.data?.icon} name={space.data?.name} size="sm" />
      </span>
      <span>Space</span>
    </Dialog.Trigger>
  );

  // The dock is three cells: the space sheet, the one saturated action, and
  // search. Handedness swaps the outer cells; the capture circle stays in the
  // middle so the thumb finds the same raised control from either side.
  const captureAction = (
    <button
      key="capture"
      type="button"
      aria-label="Capture a record (C)"
      aria-haspopup="dialog"
      className="action-circle mx-auto grid size-14 place-items-center transition-transform active:scale-95"
      onClick={() => capture.open()}
    >
      <Plus aria-hidden size={23} strokeWidth={2.4} />
    </button>
  );

  const searchAction = (
    <BarAction
      key="search"
      label="Search and commands"
      active={palette.isOpen}
      onClick={palette.open}
      icon={<Search aria-hidden size={18} strokeWidth={2} />}
    >
      Search
    </BarAction>
  );

  const captureSlot = capture.available ? (
    captureAction
  ) : (
    <span key="capture-empty" aria-hidden className="size-14" />
  );

  const barActions = (
    <>
      {handedness === "left" ? (
        <>
          {searchAction}
          {captureSlot}
        </>
      ) : (
        <>
          {captureSlot}
          {searchAction}
        </>
      )}
    </>
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
            containing block of a fixed child; the dock lives on the body. */}
        {createPortal(
          <div
            data-phone-bar
            className="fixed inset-x-2 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-40 lg:hidden"
          >
            <div className="glass mx-auto grid h-[4.25rem] max-w-md grid-cols-[1fr_auto_1fr] items-center gap-1 rounded-full px-2 shadow-[var(--shadow-dock)]">
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
        {phoneSlot ? createPortal(phoneSpaceTrigger, phoneSlot) : null}

        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-40 scrim lg:hidden" />
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
                className="min-h-0 flex-1 overflow-y-auto overscroll-contain pt-3 pb-3 pl-[max(1.5rem,env(safe-area-inset-left))] pr-[max(1.5rem,env(safe-area-inset-right))]"
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
                  className="flex min-h-12 shrink-0 items-center justify-between gap-3 border-t rule bg-raised/60 pl-[max(1.5rem,env(safe-area-inset-left))] pr-[max(1.5rem,env(safe-area-inset-right))] pb-2 pt-2 text-left transition-colors hover:bg-raised"
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
              {/* A phone has no `?` key. The sheet's footer is the one place
                  the shortcut list can be reached from the thumb, and it
                  stays put while the list above it scrolls. */}
              <div
                className={cn(
                  "flex shrink-0 items-center border-t rule pl-[max(1.5rem,env(safe-area-inset-left))] pr-[max(1.5rem,env(safe-area-inset-right))] pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-2",
                  handedness === "left" ? "justify-start" : "justify-end",
                )}
              >
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center gap-2 rounded-field px-1.5 text-[13px] text-muted transition-colors hover:text-ink"
                  onClick={() => {
                    close();
                    shortcuts.open();
                  }}
                >
                  <Keyboard aria-hidden size={16} />
                  Keyboard shortcuts
                </button>
              </div>
            </SheetPopup>
          </SheetViewport>
        </Dialog.Portal>
      </Dialog.Root>

      <aside
        id="space-rail"
        className={cn(
          "glass hidden rounded-[22px] duration-[180ms] ease-[cubic-bezier(0.2,0,0,1)] motion-safe:transition-[padding] motion-reduce:transition-none lg:sticky lg:top-[calc(var(--shell-header-h)+0.5rem)] lg:block lg:max-h-[calc(100dvh-var(--shell-header-h)-1.5rem)] lg:self-start lg:overflow-y-auto lg:overscroll-contain",
          folded ? "p-2" : "p-4",
        )}
      >
        <SpaceSwitcher
          id="space-switcher"
          spaceId={spaceId}
          spaceName={space.data?.name ?? "This space"}
          spaceIcon={space.data?.icon}
          role={role}
          list={list}
          folded={folded}
          control={
            <button
              type="button"
              aria-expanded={!folded}
              aria-controls="space-rail"
              aria-label={folded ? "Unfold navigation" : "Fold navigation"}
              title={folded ? "Unfold navigation" : "Fold navigation"}
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-raised/60 hover:text-ink"
              onClick={() => {
                if (!folded) {
                  setReordering(false);
                }
                onToggleFold?.();
              }}
            >
              {folded ? (
                <PanelLeftOpen aria-hidden size={16} strokeWidth={1.5} />
              ) : (
                <PanelLeftClose aria-hidden size={16} strokeWidth={1.5} />
              )}
            </button>
          }
        />

        <div className={cn("flex flex-col", folded ? "mt-2 gap-1" : "mt-4")}>
          <AllSpacesLink folded={folded} />
          <OverviewLink spaceId={spaceId} pathname={pathname} folded={folded} />
          <UtilityLinks
            spaceId={spaceId}
            pathname={pathname}
            order={order}
            overdue={overdue}
            reordering={reordering}
            onMove={move}
            onToggleReorder={() => {
              onUnfold?.();
              setReordering((current) => !current);
            }}
            folded={folded}
          />
        </div>

        <div className={cn("border-t rule", folded ? "mt-2 pt-2" : "mt-4 pt-3")}>
          <TypesList
            spaceId={spaceId}
            types={types}
            pathname={pathname}
            folded={folded}
          />
        </div>
      </aside>
    </>
  );
}

/**
 * One labelled destination in the phone's bottom bar: icon over a readable
 * label, a 44px target, and a 2px accent marker at the top edge while its
 * surface is open. Never a row of identical bare icons.
 */
function barTab(active: boolean) {
  return cn(
    "relative flex min-h-11 min-w-0 flex-col items-center justify-center gap-1 rounded-full px-2 text-[11px] leading-none text-muted transition-colors hover:text-ink",
    active && "text-ink",
  );
}

/** A labelled action in the phone's bottom bar. */
function BarAction({
  label,
  active,
  onClick,
  icon,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <button type="button" aria-label={label} className={barTab(active)} onClick={onClick}>
      <span
        aria-hidden
        className={cn(
          "grid size-8 place-items-center rounded-full transition-colors",
          active && "bg-accent-wash text-accent-on-wash",
        )}
      >
        {icon}
      </span>
      <span>{children}</span>
    </button>
  );
}

function SpaceSwitcher({
  id,
  spaceId,
  spaceName,
  spaceIcon,
  role,
  list,
  folded = false,
  control,
  onNavigate,
}: {
  id: string;
  spaceId: string;
  spaceName: string;
  spaceIcon?: string | null;
  role: Role;
  list: SpaceSummary[];
  folded?: boolean;
  /** The rail's fold toggle, in the same row as the Space label. */
  control?: ReactNode;
  onNavigate?: () => void;
}) {
  const navigate = useNavigate();
  const current = list.find((entry) => entry.id === spaceId);
  return (
    <div className={cn("border-b rule", folded ? "pb-2" : "pb-3")}>
      <div
        className={cn(
          "flex items-center gap-2",
          folded ? "justify-center" : "justify-between",
        )}
      >
        <label className={folded ? "sr-only" : "label text-faint"} htmlFor={id}>
          Space
        </label>
        {control}
      </div>
      {folded ? (
        <div className="relative mx-auto size-11 rounded-field focus-within:ring-2 focus-within:ring-accent">
          <span
            aria-hidden
            className="pointer-events-none grid size-11 place-items-center rounded-field border border-line-interactive/70 bg-raised/40 text-ink"
          >
            <ThingIcon
              icon={current?.icon ?? spaceIcon}
              name={current?.name ?? spaceName}
              size="md"
            />
          </span>
          <select
            id={id}
            aria-label={`Space: ${current?.name ?? spaceName}`}
            className="absolute inset-0 size-11 cursor-pointer appearance-none rounded-field opacity-0"
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
        </div>
      ) : (
        <>
          <select
            id={id}
            className="mt-1 h-9 w-full rounded-[10px] border border-line-interactive/70 bg-raised/40 px-3 text-[14px] text-ink transition-colors hover:border-line-strong focus:border-accent pointer-coarse:h-11 pointer-coarse:text-[16px]"
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
        </>
      )}
    </div>
  );
}

function TypesList({
  spaceId,
  types,
  pathname,
  folded = false,
  onNavigate,
}: {
  spaceId: string;
  types: TypeSummary[];
  pathname: string;
  folded?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <div>
      {folded ? null : (
        <div className="flex items-baseline justify-between">
          <span className="flex items-center gap-1.5">
            <Table2 aria-hidden size={14} className="shrink-0 text-faint" />
            <span className="label text-faint">Types</span>
          </span>
          <span className="label tnum text-faint">{types.length}</span>
        </div>
      )}
      {types.length === 0 ? (
        folded ? null : <p className="mt-2 text-[12px] text-muted">No types yet.</p>
      ) : (
        <ul className={cn("flex flex-col", folded ? "gap-1" : "mt-1")}>
          {types.map((type) => {
            const to = `/s/${spaceId}/t/${type.key}`;
            const active = pathname === to;
            const count = `${type.object_count} ${type.object_count === 1 ? "record" : "records"}`;
            return (
              <li key={type.key} className={cn(folded && "flex justify-center")}>
                <Link
                  to={to}
                  aria-current={active ? "page" : undefined}
                  title={folded ? `${type.name_plural} · ${count}` : undefined}
                  onClick={onNavigate}
                  className={cn(
                    railItem(active, folded),
                    folded ? "mx-auto" : "justify-between",
                  )}
                >
                  <span className={cn(folded ? "flex items-center" : "flex min-w-0 items-center gap-1.5")}>
                    <ThingIcon icon={type.icon} name={type.name} size="sm" />
                    <span className={folded ? "sr-only" : "truncate"}>{type.name_plural}</span>
                  </span>
                  <span className={folded ? "sr-only" : "label tnum shrink-0"}>
                    {folded ? count : type.object_count}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function AllSpacesLink({
  folded = false,
  onNavigate,
}: {
  folded?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <div className={cn(folded && "flex justify-center")}>
      <Link
        to="/"
        title={folded ? "All spaces" : undefined}
        onClick={onNavigate}
        className={cn(railItem(false, folded), folded && "mx-auto")}
      >
        <LayoutGrid aria-hidden size={14} className="shrink-0 text-faint" />
        <span className={folded ? "sr-only" : undefined}>All spaces</span>
      </Link>
    </div>
  );
}

function OverviewLink({
  spaceId,
  pathname,
  folded = false,
  onNavigate,
}: {
  spaceId: string;
  pathname: string;
  folded?: boolean;
  onNavigate?: () => void;
}) {
  const to = `/s/${spaceId}`;
  const active = pathname === to;
  return (
    <div className={cn(folded && "flex justify-center")}>
      <Link
        to={to}
        aria-current={active ? "page" : undefined}
        title={folded ? "Overview" : undefined}
        onClick={onNavigate}
        className={cn(railItem(active, folded), folded && "mx-auto")}
      >
        <House aria-hidden size={14} className={cn("shrink-0", active ? "text-accent" : "text-faint")} />
        <span className={folded ? "sr-only" : undefined}>Overview</span>
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
  folded = false,
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
  folded?: boolean;
}) {
  const handedness = useThumbHandedness();
  return (
    <>
      <ul className={cn("flex flex-col", folded && "gap-1")}>
        {order.map((key, index) => {
          const item = UTILITY[key];
          const Icon = item.icon;
          const to = `/s/${spaceId}/${item.path}`;
          const active = pathname === to;
          return (
            <li key={key} className={cn("flex items-center gap-1", folded && "justify-center")}>
              <Link
                to={to}
                aria-current={active ? "page" : undefined}
                title={folded ? item.label : undefined}
                onClick={onNavigate}
                className={cn(
                  railItem(active, folded),
                  folded ? "mx-auto" : "flex-1 justify-between",
                )}
              >
                <span className={cn(folded ? "flex items-center" : "flex min-w-0 items-center gap-2")}>
                  <Icon
                    aria-hidden
                    size={14}
                    className={cn("shrink-0", active ? "text-accent" : "text-faint")}
                  />
                  <span className={folded ? "sr-only" : "truncate"}>{item.label}</span>
                </span>
                {key === "schedule" && overdue > 0 && !reordering && !folded ? (
                  <span
                    className="shrink-0 rounded-full border border-danger px-1.5 text-[11px] tnum text-danger"
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
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full text-faint transition-colors hover:bg-raised hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-faint pointer-coarse:h-11 pointer-coarse:w-11"
                    onClick={() => onMove(key, -1)}
                  >
                    <ChevronUp aria-hidden size={13} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${item.label} down`}
                    disabled={index === order.length - 1}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full text-faint transition-colors hover:bg-raised hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-faint pointer-coarse:h-11 pointer-coarse:w-11"
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
      {showReorderControl === false || folded ? null : (
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
