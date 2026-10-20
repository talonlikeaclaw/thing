import type { ReactNode } from "react";

import { Wordmark } from "@/components/wordmark";

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
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[1040px] flex-col px-6">
      <header className="flex h-16 shrink-0 items-center justify-between border-b rule">
        <Wordmark />
        <span className="label hidden sm:inline">Self-hosted · your files</span>
      </header>
      <main className="grid flex-1 content-start gap-12 py-12 md:grid-cols-[minmax(0,400px)_minmax(0,1fr)] md:gap-20 md:py-20">
        <section aria-labelledby="auth-title" className="settle">
          <h1
            id="auth-title"
            className="text-[28px] leading-[1.15] font-medium tracking-[-0.02em]"
          >
            {title}
          </h1>
          <p className="mt-2 max-w-[36ch] text-muted">{subtitle}</p>
          <div className="mt-8">{children}</div>
          {footer ? <div className="mt-6 text-[13px] text-muted">{footer}</div> : null}
        </section>

        <aside aria-label="How thing works" className="hidden md:block md:border-l md:rule md:pl-12">
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

          <div className="mt-10 border-t rule pt-4">
            <p className="label">Example index</p>
            <ul className="mt-2 font-mono text-[12px] text-muted">
              <li className="flex justify-between border-b rule py-1.5">
                <span>7f3a</span>
                <span className="text-ink">Garden</span>
                <span className="tnum">2 types</span>
              </li>
              <li className="flex justify-between border-b rule py-1.5">
                <span>b104</span>
                <span className="text-ink">Chores</span>
                <span className="tnum">1 type</span>
              </li>
            </ul>
          </div>
        </aside>
      </main>
    </div>
  );
}
