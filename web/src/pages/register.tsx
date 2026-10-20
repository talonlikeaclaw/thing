import { type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router";

import { readError } from "@/lib/display";
import { useMe, useRegister } from "@/api/queries";
import { AuthScaffold } from "@/components/auth-scaffold";
import { Button, FormError, TextField } from "@/components/ui/controls";

interface RegisterFormProps {
  /** A code from `/join/:code`; when set, the field is fixed and not editable. */
  invite?: string;
}

export function RegisterForm({ invite }: RegisterFormProps) {
  const register = useRegister();
  const navigate = useNavigate();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const code = invite ?? String(data.get("invite") ?? "").trim();
    register.mutate(
      {
        name: String(data.get("name") ?? "").trim(),
        email: String(data.get("email") ?? "").trim(),
        password: String(data.get("password") ?? ""),
        ...(code ? { invite: code } : {}),
      },
      { onSuccess: () => navigate("/", { replace: true }) },
    );
  }

  return (
    <form className="grid gap-4" onSubmit={onSubmit} noValidate>
      <TextField
        label="Name"
        name="name"
        autoComplete="name"
        required
        autoFocus
        placeholder="Talon"
      />
      <TextField
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        required
        placeholder="you@example.com"
      />
      <TextField
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={10}
        hint="At least 10 characters."
      />
      {invite ? (
        <>
          <input type="hidden" name="invite" value={invite} />
          <p className="text-[13px] text-muted">
            Invite <span className="font-mono text-ink">{invite}</span>
          </p>
        </>
      ) : (
        <TextField
          label="Invite code"
          name="invite"
          placeholder="Optional"
          hint="Needed only when this install already has an owner."
        />
      )}
      <FormError message={register.error ? readError(register.error) : null} />
      <Button type="submit" disabled={register.isPending} className="mt-1 w-full">
        {register.isPending ? "Creating account…" : "Create account"}
      </Button>
    </form>
  );
}

export function RegisterPage() {
  const me = useMe();

  if (me.data) {
    return <Navigate to="/" replace />;
  }

  return (
    <AuthScaffold
      title="Create your account"
      subtitle="The first account on this install needs no invite. Your first space is one step away."
      footer={
        <>
          Already have an account?{" "}
          <Link to="/login" className="text-ink underline decoration-line-strong">
            Sign in
          </Link>
          .
        </>
      }
    >
      <RegisterForm />
    </AuthScaffold>
  );
}
