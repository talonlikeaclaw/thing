import { Keyboard, Search } from "lucide-react";
import { useState } from "react";
import { Link, Navigate, Outlet, useLocation, useMatch, useNavigate } from "react-router";

import { useLogout, useMe } from "@/api/queries";
import { CommandPalette } from "@/components/command-palette";
import { ShortcutSheet } from "@/components/shortcut-sheet";
import { Button } from "@/components/ui/controls";
import { Wordmark } from "@/components/wordmark";
import { useGlobalHotkeys } from "@/lib/hotkeys";

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

  if (!me.data) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}

export function AppShell() {
  const me = useMe();
  const logout = useLogout();
  const navigate = useNavigate();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // A layout route cannot read child params; matching both shapes covers the
  // space home and every page under it.
  const spaceHome = useMatch("/s/:spaceId");
  const spaceChild = useMatch("/s/:spaceId/*");
  const spaceId = spaceHome?.params.spaceId ?? spaceChild?.params.spaceId;
  const shortcutLabel = useGlobalHotkeys([
    {
      key: "k",
      mod: true,
      allowInInput: true,
      run: () => {
        setShortcutsOpen(false);
        setPaletteOpen((open) => !open);
      },
    },
    {
      key: "?",
      run: () => {
        if (!paletteOpen) {
          setShortcutsOpen(true);
        }
      },
    },
    {
      key: "escape",
      allowInInput: true,
      run: () => {
        if (paletteOpen) {
          setPaletteOpen(false);
        } else if (shortcutsOpen) {
          setShortcutsOpen(false);
        }
      },
    },
  ]);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b rule">
        <div className="mx-auto flex h-16 w-full max-w-[1080px] items-center justify-between gap-4 px-6">
          <Wordmark />
          <div className="flex items-center gap-2 sm:gap-4">
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
      <main className="mx-auto w-full max-w-[1080px] flex-1 px-6 py-10">
        <Outlet />
      </main>
      <footer className="mx-auto w-full max-w-[1080px] px-6 py-6">
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
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} spaceId={spaceId} />
      <ShortcutSheet open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </div>
  );
}
