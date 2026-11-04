import { ChevronDown } from "lucide-react";
import { Link } from "react-router";

import { CHANGELOG } from "@/content/changelog";
import { Button } from "@/components/ui/controls";
import { cn } from "@/lib/cn";
import { useRouteMeta } from "@/lib/route";

function ChangeList({ changes, muted = false }: { changes: string[]; muted?: boolean }) {
  return (
    <ul className={cn("mt-3 grid gap-2.5 text-[14px] leading-[1.55]", muted ? "text-muted" : "text-ink")}>
      {changes.map((change) => (
        <li key={change} className="flex gap-2.5">
          <span
            aria-hidden
            className={cn(
              "mt-[0.55em] size-1.5 shrink-0 rounded-full",
              muted ? "bg-line-interactive" : "bg-accent",
            )}
          />
          <span>{change}</span>
        </li>
      ))}
    </ul>
  );
}

/** The user-facing release notes the footer links to. */
export function ChangelogPage() {
  useRouteMeta("Changelog");
  return (
    <div className="settle mx-auto max-w-[86rem]">
      <header className="px-1 pb-6">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <h1 className="display text-display">What changed</h1>
          <span className="label tnum text-faint">v{__APP_VERSION__}</span>
        </div>
        <p className="mt-2 max-w-[60ch] text-[13px] text-muted">
          Release notes for thing.
        </p>
      </header>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,72ch)_15rem] xl:items-start xl:gap-12">
        <nav
          aria-label="Versions"
          className="glass hidden rounded-[22px] p-4 xl:sticky xl:top-[calc(var(--shell-header-h)+0.5rem)] xl:col-start-2 xl:row-start-1 xl:block"
        >
          <p className="label text-faint">Versions</p>
          <ul className="mt-2 grid gap-0.5">
            {CHANGELOG.map((entry) => (
              <li key={entry.version}>
                <a
                  href={`#v-${entry.version}`}
                  className="flex min-h-11 items-center justify-between gap-2 rounded-full px-2.5 font-mono text-[12px] text-muted transition-colors hover:bg-raised/60 hover:text-ink xl:min-h-9"
                >
                  <span>{entry.version}</span>
                  <span className="max-w-[9rem] truncate text-right text-[11px] text-faint">
                    {entry.upcoming ? "in progress" : entry.title}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="grid min-w-0 gap-4">
          {CHANGELOG.map((entry) => (
            <article
              key={entry.version}
              id={`v-${entry.version}`}
              className="scroll-mt-[calc(var(--shell-header-h)+1rem)] rounded-[22px] border border-line bg-surface p-5 sm:p-6"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span
                  className={cn(
                    "inline-flex items-center rounded-full px-2.5 py-1 font-mono text-[11px] leading-none tracking-[0.06em]",
                    entry.upcoming
                      ? "bg-accent-wash text-accent-on-wash"
                      : "bg-raised text-muted",
                  )}
                >
                  {entry.version}
                </span>
                <h2 className="text-heading font-medium">{entry.title}</h2>
                {entry.upcoming ? <span className="label text-accent">in progress</span> : null}
              </div>

              <ChangeList changes={entry.highlights} />

              {entry.details && entry.details.length > 0 ? (
                <details className="group mt-4 border-t border-line/70 pt-3">
                  <summary className="label inline-flex cursor-pointer list-none items-center gap-1.5 rounded-full py-1 transition-colors hover:text-ink pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden">
                    <ChevronDown
                      aria-hidden
                      size={13}
                      className="transition-transform group-open:rotate-180"
                    />
                    <span className="group-open:hidden">
                      {entry.details.length} more{" "}
                      {entry.details.length === 1 ? "change" : "changes"}
                    </span>
                    <span className="hidden group-open:inline">Hide changes</span>
                  </summary>
                  <ChangeList changes={entry.details} muted />
                </details>
              ) : null}
            </article>
          ))}
        </div>
      </div>

      <div className="mt-8">
        <Button variant="ghost" render={<Link to="/" />}>
          All spaces
        </Button>
      </div>
    </div>
  );
}
