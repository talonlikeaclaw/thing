import { Keyboard, Plus, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  Link,
  Navigate,
  Outlet,
  ScrollRestoration,
  useLocation,
  useMatch,
  useNavigate,
} from "react-router";

import { useLogout, useMe } from "@/api/queries";
import { CommandPalette } from "@/components/command-palette";
import { QuickCaptureProvider, useQuickCapture } from "@/components/quick-capture";
import { ShortcutSheet } from "@/components/shortcut-sheet";
import { TableShortcutsProvider } from "@/components/table-shortcuts";
import { Button } from "@/components/ui/controls";
import { Wordmark } from "@/components/wordmark";
import {
  SHORTCUTS,
  useGlobalHotkeys,
  type HotkeyBinding,
  type ShortcutDescriptor,
} from "@/lib/hotkeys";
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
  return (
    <QuickCaptureProvider spaceId={spaceId}>
      <AppFrame spaceId={spaceId} />
    </QuickCaptureProvider>
  );
}

function AppFrame({ spaceId }: { spaceId: string | undefined }) {
  const me = useMe();
  const logout = useLogout();
  const navigate = useNavigate();
  const location = useLocation();
  const capture = useQuickCapture();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // Table bindings are registered by whichever grid is on screen.
  const [tableShortcuts, setTableShortcuts] = useState<ShortcutDescriptor[]>([]);
  const connection = useSpaceEvents(spaceId);
  const previousPath = useRef(location.pathname);
  const [announcement, setAnnouncement] = useState("");

  const shortcutActions: Record<string, () => void> = {
    palette: () => {
      capture.close();
      setShortcutsOpen(false);
      setPaletteOpen((open) => !open);
    },
    capture: () => {
      if (capture.available) {
        setPaletteOpen(false);
        setShortcutsOpen(false);
        capture.open();
      }
    },
    shortcuts: () => {
      if (!paletteOpen && !shortcutsOpen && !capture.isOpen) {
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
    <div className="flex min-h-dvh flex-col">
      <ScrollRestoration />
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus:rounded-field focus:border focus:border-line-interactive focus:bg-surface focus:px-4 focus:py-2 focus:text-[13px] focus:text-ink"
      >
        Skip to content
      </a>
      <header className="border-b rule">
        <div className="mx-auto flex h-16 w-full max-w-[1400px] items-center justify-between gap-4 px-6">
          <Wordmark />
          <div className="flex items-center gap-2 sm:gap-4">
            {capture.available ? (
              <Button
                variant="ghost"
                aria-label="Capture a record (C)"
                aria-keyshortcuts="c"
                aria-haspopup="dialog"
                className="min-h-11 min-w-11 px-2 text-[13px] sm:min-h-8 sm:min-w-0 sm:px-3 pointer-coarse:min-h-11"
                onClick={() => capture.open()}
              >
                <Plus aria-hidden size={15} />
                <span className="hidden sm:inline">Capture</span>
              </Button>
            ) : null}
            {spaceId && connection !== "live" ? (
              <span
                role="status"
                className="hidden font-mono text-[11px] text-warning sm:inline"
              >
                {connection === "connecting" ? "connecting…" : "offline · reconnecting…"}
              </span>
            ) : null}
            <Button
              variant="ghost"
              aria-label={`Search and commands (${shortcutLabel})`}
              aria-haspopup="dialog"
              className="min-h-11 min-w-11 px-2 text-[13px] sm:min-h-8 sm:min-w-0 sm:px-3 pointer-coarse:min-h-11"
              onClick={() => setPaletteOpen(true)}
            >
              <Search aria-hidden size={15} />
              <span className="hidden sm:inline">Search</span>
              <kbd className="hidden rounded-[3px] border border-line px-1.5 py-0.5 font-mono text-[10px] text-faint sm:inline">
                {shortcutLabel}
              </kbd>
            </Button>
            <Button
              variant="ghost"
              aria-label="Keyboard shortcuts (?)"
              aria-keyshortcuts="?"
              aria-haspopup="dialog"
              className="min-h-11 min-w-11 px-2 text-[13px] sm:min-h-8 sm:min-w-0 sm:px-3 pointer-coarse:min-h-11"
              onClick={() => setShortcutsOpen(true)}
            >
              <Keyboard aria-hidden size={15} />
              <span className="hidden sm:inline">Shortcuts</span>
              <kbd className="hidden rounded-[3px] border border-line px-1.5 py-0.5 font-mono text-[10px] text-faint md:inline">
                ?
              </kbd>
            </Button>
            <span className="hidden font-mono text-[12px] text-muted sm:inline">
              {me.data?.email}
            </span>
            <Button
              variant="ghost"
              className="min-h-8 px-3 text-[13px] pointer-coarse:min-h-11"
              disabled={logout.isPending}
              onClick={() => logout.mutate(undefined, { onSuccess: () => navigate("/login") })}
            >
              {logout.isPending ? "Signing out…" : "Sign out"}
            </Button>
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
      <footer className="mx-auto w-full max-w-[1400px] px-6 py-6">
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
            <span className="font-mono text-[11px] tnum text-faint">v{__APP_VERSION__}</span>
          </div>
        </div>
      </footer>
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        spaceId={spaceId}
        {...(capture.available ? { onCapture: () => capture.open() } : {})}
      />
      <ShortcutSheet
        open={shortcutsOpen}
        onOpenChange={setShortcutsOpen}
        shortcuts={activeShortcuts}
      />
    </div>
  );
}
