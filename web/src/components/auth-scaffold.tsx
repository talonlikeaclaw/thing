import type { ReactNode } from "react";

import { Wordmark } from "@/components/wordmark";
import { Button, FormError } from "@/components/ui/controls";
import { readError } from "@/lib/display";
import { useRouteMeta } from "@/lib/route";

interface AuthScaffoldProps {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
}

/**
 * The signed-out surface: one form on a sheet, and a margin of product truth.
 * The notes are real properties of the product, not claims about a future one.
 */
export function AuthScaffold({ title, subtitle, children, footer }: AuthScaffoldProps) {
  useRouteMeta(title);
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[1060px] flex-col px-4 sm:px-6">
      <header className="glass mt-3 flex h-14 shrink-0 items-center justify-between rounded-full px-4 sm:px-6">
        <Wordmark />
        <span className="label hidden sm:inline">Self-hosted · your files</span>
      </header>
      <main className="grid flex-1 content-start gap-10 py-10 md:grid-cols-[minmax(0,400px)_minmax(0,1fr)] md:gap-16 md:py-16">
        <section aria-labelledby="auth-title" className="settle">
          <h1 id="auth-title" className="display text-display break-words">
            {title}
          </h1>
          <p className="mt-2 max-w-[36ch] text-[length:var(--text-small)] leading-[var(--text-small--line-height)] text-muted">
            {subtitle}
          </p>
          <div className="mt-8">{children}</div>
          {footer ? <div className="mt-6 text-[13px] text-muted">{footer}</div> : null}
        </section>

        <aside aria-label="How thing works" className="glass hidden rounded-[26px] p-8 md:block">
          <dl className="settle space-y-6">
            <div>
              <dt className="label">Your files</dt>
              <dd className="mt-1 max-w-[34ch] text-[15px]">
                Every record is a markdown file on your disk. Back it up with rsync, read it with
                grep, keep it in git.
              </dd>
            </div>
            <div>
              <dt className="label">Your schema</dt>
              <dd className="mt-1 max-w-[34ch] text-[15px]">
                Types and properties are yours to define. No migration step, no one else's idea of
                a plant or a chore.
              </dd>
            </div>
            <div>
              <dt className="label">Together</dt>
              <dd className="mt-1 max-w-[34ch] text-[15px]">
                Invite people into a space at owner, editor or viewer. Changes reach open screens
                without a refresh.
              </dd>
            </div>
          </dl>
        </aside>
      </main>
    </div>
  );
}

/** The auth surface while the session probe is still unanswered. */
export function AuthWaiting({ title }: { title: string }) {
  return (
    <AuthScaffold title={title} subtitle="Checking your session first.">
      <p role="status" className="text-[13px] text-muted">
        Checking your session…
      </p>
    </AuthScaffold>
  );
}

/** A failed session probe is retryable; it is not a signed-out visitor. */
export function AuthUnavailable({
  title,
  error,
  onRetry,
}: {
  title: string;
  error: unknown;
  onRetry: () => void;
}) {
  return (
    <AuthScaffold title={title} subtitle="The server did not answer. Your session is still here.">
      <div className="grid gap-3">
        <FormError message={readError(error)} />
        <Button variant="ghost" className="w-fit" onClick={onRetry}>
          Retry
        </Button>
      </div>
    </AuthScaffold>
  );
}
