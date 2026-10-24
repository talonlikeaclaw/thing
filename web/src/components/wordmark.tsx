import { Link } from "react-router";

import { cn } from "@/lib/cn";

/** The wordmark carries the one non-state use of the accent: a specimen square. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <Link
      to="/"
      className={cn(
        "inline-flex items-center gap-2 font-mono text-[15px] leading-none tracking-[-0.01em] pointer-coarse:min-h-11",
        className,
      )}
    >
      <span aria-hidden className="size-2.5 shrink-0 rounded-[2px] bg-accent" />
      <span>thing</span>
    </Link>
  );
}
