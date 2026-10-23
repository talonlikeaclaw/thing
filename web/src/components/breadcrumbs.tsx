import { Link } from "react-router";

import { cn } from "@/lib/cn";

export interface Crumb {
  label: string;
  /** Omit on the current page; the last crumb is always current. */
  to?: string;
}

/** `Space / Type / Record`, with the current page unlinked. */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-4">
      <ol className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {items.map((item, index) => {
          const current = index === items.length - 1;
          return (
            <li key={`${item.label}:${index}`} className="flex min-w-0 items-baseline gap-2">
              {index > 0 ? (
                <span aria-hidden className="text-faint">
                  /
                </span>
              ) : null}
              {current || item.to === undefined ? (
                <span
                  aria-current={current ? "page" : undefined}
                  className={cn(
                    "max-w-[46ch] truncate text-[12px]",
                    current ? "text-ink" : "text-muted",
                  )}
                >
                  {item.label}
                </span>
              ) : (
                <Link
                  to={item.to}
                  className="max-w-[46ch] truncate text-[12px] text-muted transition-colors hover:text-accent pointer-coarse:min-h-11 pointer-coarse:content-center"
                >
                  {item.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
