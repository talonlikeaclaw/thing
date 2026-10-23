import { type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router";

import { readError } from "@/lib/display";
import { useLogin, useMe } from "@/api/queries";
import { AuthScaffold, AuthUnavailable, AuthWaiting } from "@/components/auth-scaffold";
import { Button, FormError, TextField } from "@/components/ui/controls";

export function LoginPage() {
  const me = useMe();
  const login = useLogin();
  const navigate = useNavigate();
  const location = useLocation();
  const from = internalPath((location.state as { from?: unknown } | null)?.from);

  if (me.isPending) {
    return <AuthWaiting title="Sign in" />;
  }
  if (me.isError) {
    return (
      <AuthUnavailable title="Sign in" error={me.error} onRetry={() => void me.refetch()} />
    );
  }
  if (me.data) {
    return <Navigate to={from} replace />;
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    login.mutate(
      {
        email: String(data.get("email") ?? "").trim(),
        password: String(data.get("password") ?? ""),
      },
      { onSuccess: () => navigate(from, { replace: true }) },
    );
  }

  return (
    <AuthScaffold
      title="Sign in"
      subtitle="Your spaces are where you left them."
      footer={
        <>
          First time here?{" "}
          <Link to="/register" className="text-ink underline decoration-line-strong">
            Create an account
          </Link>
          . Have an invite link? Open the link you were sent.
        </>
      }
    >
      <form className="grid gap-4" onSubmit={onSubmit} noValidate>
        <TextField
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          required
          autoFocus
          placeholder="you@example.com"
        />
        <TextField
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
        <FormError message={login.error ? readError(login.error) : null} />
        <Button type="submit" disabled={login.isPending} className="mt-1 w-full">
          {login.isPending ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </AuthScaffold>
  );
}

/** Only an internal path may be a post-login target. */
function internalPath(raw: unknown): string {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//")) {
    return "/";
  }
  if (raw === "/login" || raw.startsWith("/login?") || raw.startsWith("/login#")) {
    return "/";
  }
  return raw;
}
