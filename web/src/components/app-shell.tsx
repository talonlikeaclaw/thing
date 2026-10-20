import { Navigate, Outlet, useLocation, useNavigate } from "react-router";

import { useLogout, useMe } from "@/api/queries";
import { Button } from "@/components/ui/controls";
import { Wordmark } from "@/components/wordmark";

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

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b rule">
        <div className="mx-auto flex h-16 w-full max-w-[1080px] items-center justify-between gap-4 px-6">
          <Wordmark />
          <div className="flex items-center gap-4">
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
        <p className="border-t rule pt-4 font-mono text-[11px] text-faint">
          Markdown on disk is the source of truth.
        </p>
      </footer>
    </div>
  );
}
