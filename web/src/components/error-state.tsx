import { Link, Navigate, useLocation } from "react-router";

import { Button } from "@/components/ui/controls";
import { classifyError } from "@/lib/errors";

interface ErrorStateProps {
  error: unknown;
  /** What the missing thing is called in a 404: `Record`, `Type`, `Space`. */
  subject?: string;
  onRetry?: () => void;
}

/**
 * One refusal surface for every page. A 401 leaves for the login form with
 * the full current location; a 404 names the missing thing and offers the
 * index; a network or server failure offers Retry.
 */
export function ErrorState({ error, subject = "This page", onRetry }: ErrorStateProps) {
  const location = useLocation();
  const classified = classifyError(error, subject);

  if (classified.kind === "unauthenticated") {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: `${location.pathname}${location.search}${location.hash}` }}
      />
    );
  }

  return (
    <div className="settle grid max-w-[52ch] gap-3">
      <h1 className="text-[26px] font-medium tracking-[-0.02em]">{classified.title}</h1>
      <p className="text-muted">{classified.message}</p>
      <div className="flex flex-wrap items-center gap-3">
        {classified.kind === "missing" || classified.kind === "forbidden" ? (
          <Link
            to="/"
            className="inline-flex min-h-10 items-center rounded-field border border-line-interactive px-4 text-sm text-ink transition-colors hover:border-line-strong hover:bg-raised pointer-coarse:min-h-11"
          >
            All spaces
          </Link>
        ) : null}
        {classified.kind !== "missing" && classified.kind !== "forbidden" && onRetry ? (
          <Button variant="ghost" className="w-fit" onClick={() => onRetry()}>
            Retry
          </Button>
        ) : null}
      </div>
    </div>
  );
}
