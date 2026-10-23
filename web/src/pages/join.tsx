import { Link, useNavigate, useParams } from "react-router";

import { useLogout, useMe } from "@/api/queries";
import { AuthScaffold, AuthUnavailable, AuthWaiting } from "@/components/auth-scaffold";
import { RegisterForm } from "@/pages/register";
import { Button } from "@/components/ui/controls";

export function JoinPage() {
  const { code = "" } = useParams();
  const me = useMe();
  const logout = useLogout();
  const navigate = useNavigate();

  if (me.isPending) {
    return <AuthWaiting title="Join this space" />;
  }

  if (me.isError) {
    return (
      <AuthUnavailable
        title="Join this space"
        error={me.error}
        onRetry={() => void me.refetch()}
      />
    );
  }

  if (me.data) {
    return (
      <AuthScaffold
        title="You're already signed in"
        subtitle="An invite is redeemed while creating a new account. Sign out first if this invite is for you."
        footer={
          <Link to="/" className="text-ink underline decoration-line-strong">
            Go to your spaces
          </Link>
        }
      >
        <div className="grid gap-4">
          <p className="text-[13px] text-muted">
            Signed in as <span className="font-mono text-ink">{me.data.email}</span>. The invite
            code is <span className="font-mono text-ink">{code}</span>.
          </p>
          <Button
            variant="ghost"
            disabled={logout.isPending}
            onClick={() => logout.mutate(undefined, { onSuccess: () => navigate("/login") })}
          >
            {logout.isPending ? "Signing out…" : "Sign out"}
          </Button>
        </div>
      </AuthScaffold>
    );
  }

  return (
    <AuthScaffold
      title="Join this space"
      subtitle="You were invited. Create an account and you'll land in the space this link belongs to."
      footer={
        <>
          Wrong link?{" "}
          <Link to="/login" className="text-ink underline decoration-line-strong">
            Sign in instead
          </Link>
          .
        </>
      }
    >
      <RegisterForm invite={code} />
    </AuthScaffold>
  );
}
