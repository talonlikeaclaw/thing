import { ChevronDown } from "lucide-react";
import { Link } from "react-router";

import { CHANGELOG, type ChangelogSection } from "@/content/changelog";
import { ThumbRow } from "@/components/handedness";
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

/**
 * One release's grouped changes: a heading per theme, a sentence on why the
 * group exists, then a claim and its context per change.
 */
function SectionList({ version, sections }: { version: string; sections: ChangelogSection[] }) {
  return (
    <div>
      {sections.map((section, index) => (
        <details
          key={section.title}
          className={cn("group", index === 0 ? "mt-4" : "mt-1")}
        >
          <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 rounded-[12px] px-1 py-2 transition-colors hover:bg-raised/50 group-open:bg-raised/40 sm:gap-3 sm:px-2 [&::-webkit-details-marker]:hidden pointer-coarse:min-h-12">
            <span
              aria-hidden
              className="tnum w-4 shrink-0 font-mono text-[11px] text-faint transition-colors group-open:text-accent sm:w-5"
            >
              {String(index + 1).padStart(2, "0")}
            </span>
            <h3
              id={`section-${version}-${section.title.toLowerCase().replaceAll(" ", "-")}`}
              className="min-w-0 flex-1 text-[15px] leading-[1.35] font-medium text-ink transition-colors group-open:text-accent"
            >
              {section.title}
            </h3>
            <span className="label hidden shrink-0 text-faint sm:inline">
              {section.items.length} {section.items.length === 1 ? "change" : "changes"}
            </span>
            <span
              aria-hidden
              className="grid size-7 shrink-0 place-items-center rounded-full border border-line-interactive/70 text-muted transition-colors group-open:border-accent/50 group-open:bg-accent-wash group-open:text-accent-on-wash"
            >
              <ChevronDown
                size={14}
                className="transition-transform group-open:rotate-180"
              />
            </span>
          </summary>
          <div className="mt-1 grid gap-2 border-l border-accent/30 pl-3 sm:ml-[1.75rem] sm:pl-4">
            {section.intro ? (
              <p className="max-w-[62ch] text-[13px] leading-[1.55] text-muted">
                {section.intro}
              </p>
            ) : null}
            <ul className="mt-1 grid gap-3">
              {section.items.map((item) => (
                <li key={item.lead} className="grid gap-0.5">
                  <span className="text-[14px] leading-[1.5] font-medium text-ink">
                    {item.lead}
                  </span>
                  <span className="max-w-[68ch] text-[14px] leading-[1.55] text-muted">
                    {item.body}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </details>
      ))}
    </div>
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
              className={cn(
                "scroll-mt-[calc(var(--shell-header-h)+1rem)] rounded-[22px] border bg-surface p-4 sm:p-6",
                entry.sections ? "border-accent/25 sm:p-7" : "border-line",
              )}
            >
              {entry.sections ? (
                <span aria-hidden className="mb-4 block h-0.5 w-9 rounded-full bg-accent" />
              ) : null}
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
                {entry.date ? (
                  <span className="tnum ml-auto font-mono text-[11px] text-faint">
                    {entry.date}
                  </span>
                ) : null}
              </div>

              {entry.summary ? (
                <p className="mt-4 max-w-[62ch] text-[16px] leading-[1.6] text-ink">
                  {entry.summary}
                </p>
              ) : null}

              {entry.sections && entry.sections.length > 0 ? (
                <SectionList version={entry.version} sections={entry.sections} />
              ) : (
                <ChangeList changes={entry.highlights ?? []} />
              )}

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

      <ThumbRow className="mt-8 items-center lg:justify-start">
        <Button variant="ghost" render={<Link to="/" />}>
          All spaces
        </Button>
      </ThumbRow>
    </div>
  );
}
