import { Link } from "react-router";

import { CHANGELOG } from "@/content/changelog";

/** The user-facing release notes the footer links to. */
export function ChangelogPage() {
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
            <ul className="mt-2 grid gap-1.5 text-[14px] text-muted">
              {entry.changes.map((change) => (
                <li key={change} className="flex gap-2">
                  <span aria-hidden className="text-faint">
                    —
                  </span>
                  <span>{change}</span>
                </li>
              ))}
            </ul>
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
