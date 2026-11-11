import { Link, Navigate, useLocation } from "react-router";

import { Button } from "@/components/ui/controls";
import { readError } from "@/lib/display";
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
      <h1 className="display text-title">{classified.title}</h1>
      <p className="text-muted">{classified.message}</p>
      <div className="flex flex-wrap items-center gap-3">
        {classified.kind === "missing" || classified.kind === "forbidden" ? (
          <Link
            to="/"
            className="inline-flex min-h-10 items-center rounded-[10px] border border-line-interactive/70 bg-raised/40 px-4 text-sm text-ink transition-colors hover:border-line-strong hover:bg-raised pointer-coarse:min-h-11"
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

interface InlineErrorProps {
  error: unknown;
  onRetry?: () => void;
}

/**
 * One refusal inside a band that has other content — the activity margin, the
 * graph, a section of a loaded page. It prints the server's own sentence, so a
 * failed part never reads as an empty one.
 */
export function InlineError({ error, onRetry }: InlineErrorProps) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3">
      <p className="text-[13px] text-muted">{readError(error)}</p>
      {onRetry ? (
        <button
          type="button"
          className="min-h-11 text-[12px] text-muted underline decoration-line-strong hover:text-ink pointer-fine:min-h-0"
          onClick={onRetry}
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}
