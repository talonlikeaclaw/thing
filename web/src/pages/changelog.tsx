import { ChevronDown } from "lucide-react";
import { Link } from "react-router";

import { CHANGELOG } from "@/content/changelog";
import { cn } from "@/lib/cn";
import { useRouteMeta } from "@/lib/route";

function ChangeList({
  changes,
  muted = false,
}: {
  changes: string[];
  muted?: boolean;
}) {
  return (
    <ul className={cn("mt-2 grid gap-1.5 text-[14px]", muted ? "text-muted" : "text-ink")}>
      {changes.map((change) => (
        <li key={change} className="flex gap-2">
          <span aria-hidden className="text-faint">
            —
          </span>
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
    <div className="settle max-w-[62ch]">
      <p className="label">Changelog</p>
      <h1 className="mt-1 text-[28px] font-medium tracking-[-0.02em]">What changed</h1>
      <p className="mt-2 text-muted">
        Release notes for thing. The footer shows the version running right now.
      </p>

      <div className="mt-8 grid gap-8">
        {CHANGELOG.map((entry) => (
          <section key={entry.version} className="border-t rule pt-4">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="font-mono text-[13px] text-accent">{entry.version}</h2>
              <span className="text-[15px] font-medium">{entry.title}</span>
              {entry.upcoming ? <span className="label">IN PROGRESS</span> : null}
            </div>
            <ChangeList changes={entry.highlights} />
            {entry.details && entry.details.length > 0 ? (
              <details className="group mt-3">
                <summary className="label inline-flex cursor-pointer list-none items-center gap-1.5 py-1 transition-colors hover:text-ink pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden">
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
                <div className="mt-1 border-l rule pl-3">
                  <ChangeList changes={entry.details} muted />
                </div>
              </details>
            ) : null}
          </section>
        ))}
      </div>

      <Link
        to="/"
        className="label mt-8 inline-flex py-2 transition-colors hover:text-accent pointer-coarse:min-h-11"
      >
        ← All spaces
      </Link>
    </div>
  );
}
