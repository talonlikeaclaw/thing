import { Keyboard, LogOut, Plus, Search, UserRound } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Link,
  Navigate,
  Outlet,
  ScrollRestoration,
  useLocation,
  useMatch,
} from "react-router";

import { useMe, useObject } from "@/api/queries";
import { CommandPalette } from "@/components/command-palette";
import { ConnectionProvider } from "@/components/connection-context";
import { HandednessProvider } from "@/components/handedness";
import { PaletteProvider } from "@/components/palette-context";
import { QuickCaptureProvider, useQuickCapture } from "@/components/quick-capture";
import { ShortcutSheet } from "@/components/shortcut-sheet";
import { SignOutDialog } from "@/components/sign-out-dialog";
import { TableShortcutsProvider } from "@/components/table-shortcuts";
import { focusSheetField, sheetReturnFocus } from "@/components/ui/sheet";
import { Button, Keycap } from "@/components/ui/controls";
import { Wordmark } from "@/components/wordmark";
import {
  SHORTCUTS,
  useGlobalHotkeys,
  type HotkeyBinding,
  type ShortcutDescriptor,
} from "@/lib/hotkeys";
import {
  DEFAULT_HANDEDNESS,
  applyHandedness,
  handednessKey,
  readHandedness,
  resetHandedness,
  writeHandedness,
  type Handedness,
} from "@/lib/handedness";
import { useSpaceEvents } from "@/lib/use-space-events";

/** Signed-out requests go to the form, and come back to where they were. */
export function AuthGate() {
  const me = useMe();
  const location = useLocation();

  if (me.isPending) {
    return (
      <div className="flex min-h-dvh items-center justify-center px-6">
        <div className="settle flex items-baseline gap-3">
          <Wordmark />
          <span className="label">reading the index</span>
        </div>
      </div>
    );
  }

  // A failed probe is not a signed-out visitor: keep the session question open
  // and make it retryable instead of flashing the login form.
  if (me.isError) {
    return (
      <div className="flex min-h-dvh items-center justify-center px-6">
        <div className="settle grid max-w-[42ch] gap-3">
          <h1 className="text-[26px] font-medium tracking-[-0.02em]">
            Could not check your session
          </h1>
          <p className="text-muted">
            The server did not answer. Your spaces are still there; retry when the connection is
            back.
          </p>
          <Button variant="ghost" className="w-fit" onClick={() => void me.refetch()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (me.data === null) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: `${location.pathname}${location.search}${location.hash}` }}
      />
    );
  }

  return <Outlet />;
}

/**
 * The shell owns the space context for quick capture, so the header, palette
 * and hotkeys share one sheet without every page mounting its own provider.
 */
export function AppShell() {
  // A layout route cannot read child params; matching both shapes covers the
  // space home and every page under it.
  const spaceHome = useMatch("/s/:spaceId");
  const spaceChild = useMatch("/s/:spaceId/*");
  const spaceId = spaceHome?.params.spaceId ?? spaceChild?.params.spaceId;
  // Capture follows the page: a type route knows its key, a record route reads
  // the record's type from the same query the page uses, and the space home has
  // no type to offer. The provider validates the key against this space's types.
  const typeRoute = useMatch("/s/:spaceId/t/:typeKey");
  const objectRoute = useMatch("/s/:spaceId/o/:objectId");
  const object = useObject(spaceId, objectRoute?.params.objectId);
  const currentType = typeRoute?.params.typeKey ?? object.data?.type;
  return (
    <HandednessRoot>
      <QuickCaptureProvider spaceId={spaceId} currentType={currentType}>
        <AppFrame spaceId={spaceId} />
      </QuickCaptureProvider>
    </HandednessRoot>
  );
}

/**
 * Handedness lives above quick capture, because that sheet renders outside
 * `AppFrame`'s tree and must move its close control with every other surface.
 */
function HandednessRoot({ children }: { children: ReactNode }) {
  const me = useMe();
  const userId = me.data?.id;
  const [handedness, setHandedness] = useState<Handedness>(DEFAULT_HANDEDNESS);

  // The root attribute is set before paint so the first frame already has the
  // right thumb zone; leaving the shell (or signing out) drops back to right.
  useLayoutEffect(() => {
    if (!userId) {
      resetHandedness(document.documentElement);
      setHandedness(DEFAULT_HANDEDNESS);
      return;
    }
    const stored = readHandedness(window.localStorage, handednessKey(userId));
    setHandedness(stored);
    applyHandedness(document.documentElement, stored);
    return () => resetHandedness(document.documentElement);
  }, [userId]);

  const changeHandedness = useCallback(
    (next: Handedness) => {
      setHandedness(next);
      applyHandedness(document.documentElement, next);
      if (userId) {
        writeHandedness(window.localStorage, handednessKey(userId), next);
      }
    },
    [userId],
  );
  const value = useMemo(
    () => ({ handedness, setHandedness: changeHandedness }),
    [handedness, changeHandedness],
  );

  return <HandednessProvider value={value}>{children}</HandednessProvider>;
}

function AppFrame({ spaceId }: { spaceId: string | undefined }) {
  const me = useMe();
  const location = useLocation();
  const capture = useQuickCapture();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const paletteInputRef = useRef<HTMLInputElement>(null);
  const paletteReturnFocus = useRef<HTMLElement | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);
  // Table bindings are registered by whichever grid is on screen.
  const [tableShortcuts, setTableShortcuts] = useState<ShortcutDescriptor[]>([]);
  const connection = useSpaceEvents(spaceId);
  const previousPath = useRef(location.pathname);
  const [announcement, setAnnouncement] = useState("");

  // The sheet stays mounted, so this runs before React commits the open: the
  // field exists, and the `focus()` lands inside the tap itself — the only
  // moment iOS Safari raises the keyboard. The return target is recorded first
  // because the field, once focused, cannot be the dialog's own restore target.
  const openPalette = useCallback(() => {
    paletteReturnFocus.current = sheetReturnFocus();
    focusSheetField(paletteInputRef.current);
    setPaletteOpen(true);
  }, []);

  const shortcutActions: Record<string, () => void> = {
    palette: () => {
      // A confirmation owns the screen until it is answered.
      if (signOutOpen) {
        return;
      }
      capture.close();
      setShortcutsOpen(false);
      if (paletteOpen) {
        setPaletteOpen(false);
      } else {
        openPalette();
      }
    },
    capture: () => {
      if (capture.available && !signOutOpen) {
        setPaletteOpen(false);
        setShortcutsOpen(false);
        capture.open();
      }
    },
    shortcuts: () => {
      if (!signOutOpen && !paletteOpen && !shortcutsOpen && !capture.isOpen) {
        setShortcutsOpen(true);
      }
    },
    escape: () => {
      if (capture.isOpen) {
        capture.close();
      } else if (paletteOpen) {
        setPaletteOpen(false);
      } else if (shortcutsOpen) {
        setShortcutsOpen(false);
      }
    },
  };
  // A viewer sees no capture action, and the `c` sheet line would lie there.
  const activeShortcuts = [
    ...SHORTCUTS.filter((shortcut) => shortcut.id !== "capture" || capture.available),
    ...tableShortcuts,
  ];
  const bindings: HotkeyBinding[] = activeShortcuts.flatMap((shortcut) => {
    const run = shortcutActions[shortcut.id];
    if (!run) {
      return [];
    }
    return [
      {
        key: shortcut.key,
        ...(shortcut.mod ? { mod: true } : {}),
        ...(shortcut.allowInInput ? { allowInInput: true } : {}),
        run,
      },
    ];
  });
  const shortcutLabel = useGlobalHotkeys(bindings);
  // The header's cap and the registered binding read one descriptor, so the
  // advertised key cannot drift from the one that fires.
  const captureShortcut = SHORTCUTS.find((shortcut) => shortcut.id === "capture");

  // A client navigation moves focus to the new page's heading and announces
  // the document title once. Query-string changes stay where the user is.
  useEffect(() => {
    if (previousPath.current === location.pathname) {
      return;
    }
    previousPath.current = location.pathname;
    const main = document.getElementById("main-content");
    const heading = main?.querySelector<HTMLElement>("h1");
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    } else {
      main?.focus({ preventScroll: true });
    }
    const frame = window.requestAnimationFrame(() => setAnnouncement(document.title));
    return () => window.cancelAnimationFrame(frame);
  }, [location.pathname]);

  return (
    <PaletteProvider open={openPalette}>
      <ConnectionProvider state={connection}>
        <div className="flex min-h-dvh flex-col">
          <ScrollRestoration />
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus:rounded-field focus:border focus:border-line-interactive focus:bg-surface focus:px-4 focus:py-2 focus:text-[13px] focus:text-ink"
          >
            Skip to content
          </a>
          <header className="border-b rule">
            {/*
              At `lg` the header is always the page's rail-and-content grid,
              inside a space or not, so the action zone keeps one x on every
              route instead of jumping between the content edge and the right.
            */}
            <div className="mx-auto flex h-16 w-full max-w-[1400px] items-center justify-between gap-4 px-6 lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10">
              <div className="flex min-w-0 items-center gap-2">
                <Wordmark />
                {/* The text below is `sm` and up; a phone still needs to see
                    that the socket is down, without moving Search or Capture. */}
                {spaceId && connection !== "live" ? (
                  <span
                    role="status"
                    title={connection === "connecting" ? "Connecting…" : "Offline, reconnecting"}
                    aria-label={
                      connection === "connecting" ? "Connecting…" : "Offline, reconnecting"
                    }
                    className="size-2 shrink-0 rounded-full bg-warning sm:hidden"
                  />
                ) : null}
              </div>
              <div
                // Two groups: global chrome at the content edge and the space's
                // own action after it, the account controls at the container's
                // trailing edge. Below `lg` both groups sit together at the right.
                className="ml-auto flex min-w-0 items-center gap-2 sm:gap-4 lg:ml-0 lg:justify-between"
              >
                <div className="flex min-w-0 items-center gap-2 sm:gap-4">
                  <Button
                    variant="ghost"
                    aria-label={`Search and commands (${shortcutLabel})`}
                    aria-haspopup="dialog"
                    className="max-lg:hidden min-h-8 shrink-0 px-3 text-[13px]"
                    onClick={openPalette}
                  >
                    <Search aria-hidden size={15} />
                    <span>Search</span>
                    <Keycap>{shortcutLabel}</Keycap>
                  </Button>
                  {capture.available ? (
                    <Button
                      variant="ghost"
                      aria-label={`Capture a record (${captureShortcut?.keys ?? "C"})`}
                      aria-keyshortcuts={captureShortcut?.key ?? "c"}
                      aria-haspopup="dialog"
                      className="max-lg:hidden min-h-8 shrink-0 px-3 text-[13px]"
                      onClick={() => capture.open()}
                    >
                      <Plus aria-hidden size={15} />
                      <span>Capture</span>
                      <Keycap>{captureShortcut?.keys ?? "C"}</Keycap>
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    aria-label="Keyboard shortcuts (?)"
                    aria-keyshortcuts="?"
                    aria-haspopup="dialog"
                    className="hidden min-h-11 min-w-11 shrink-0 px-2 text-[13px] sm:inline-flex sm:min-h-8 sm:min-w-0 sm:px-3 pointer-coarse:hidden"
                    onClick={() => setShortcutsOpen(true)}
                  >
                    <Keyboard aria-hidden size={15} />
                    <span className="hidden sm:inline">Shortcuts</span>
                    <Keycap className="hidden md:inline">?</Keycap>
                  </Button>
                  {/* The state follows every nav action, so Search and Capture
                      keep their positions when the connection drops. */}
                  {spaceId && connection !== "live" ? (
                    <span
                      role="status"
                      title={connection === "connecting" ? "Connecting…" : "Offline, reconnecting"}
                      className="hidden min-w-0 truncate font-mono text-[11px] text-warning sm:inline"
                    >
                      {connection === "connecting" ? "connecting…" : "offline · reconnecting…"}
                    </span>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2 sm:gap-4">
                  <span className="hidden min-w-0 truncate font-mono text-[12px] text-muted sm:inline lg:hidden xl:inline">
                    {me.data?.email}
                  </span>
                  <Link
                    to="/settings"
                    aria-label="Account settings"
                    className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-field border border-line-interactive px-2 text-[13px] font-medium text-ink transition-colors hover:border-line-strong hover:bg-raised sm:min-h-8 sm:min-w-0 sm:px-3 pointer-coarse:min-h-11"
                  >
                    <UserRound aria-hidden size={15} />
                    <span className="hidden sm:inline">Account</span>
                  </Link>
                  <SignOutDialog open={signOutOpen} onOpenChange={setSignOutOpen}>
                    <LogOut aria-hidden size={15} className="sm:hidden" />
                    <span className="hidden sm:inline">Sign out</span>
                  </SignOutDialog>
                </div>
              </div>
            </div>
          </header>
          <p role="status" aria-live="polite" className="sr-only">
            {announcement}
          </p>
          <main
            id="main-content"
            tabIndex={-1}
            className="mx-auto w-full max-w-[1400px] flex-1 px-6 py-10 focus:outline-none"
          >
            <TableShortcutsProvider onChange={setTableShortcuts}>
              <Outlet />
            </TableShortcutsProvider>
          </main>
          <footer className="mx-auto w-full max-w-[1400px] px-6 py-6 max-lg:pb-24">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-t rule pt-4">
              <p className="font-mono text-[11px] text-faint">
                Markdown on disk is the source of truth.
              </p>
              <div className="flex items-baseline gap-3">
                <Link
                  to="/changelog"
                  className="label py-1 transition-colors hover:text-accent pointer-coarse:min-h-11 pointer-coarse:content-center"
                >
                  Changelog
                </Link>
                <span className="font-mono text-[12px] tnum text-faint">v{__APP_VERSION__}</span>
              </div>
            </div>
          </footer>
          <CommandPalette
            open={paletteOpen}
            onOpenChange={setPaletteOpen}
            inputRef={paletteInputRef}
            returnFocusRef={paletteReturnFocus}
            spaceId={spaceId}
            {...(capture.available
              ? {
                  // Capture takes over focus; the closing palette must not pull
                  // it back to the bar before the capture field keeps the tap.
                  onCapture: () => {
                    paletteReturnFocus.current = null;
                    capture.open();
                  },
                }
              : {})}
          />
          <ShortcutSheet
            open={shortcutsOpen}
            onOpenChange={setShortcutsOpen}
            shortcuts={activeShortcuts}
          />
        </div>
      </ConnectionProvider>
    </PaletteProvider>
  );
}
