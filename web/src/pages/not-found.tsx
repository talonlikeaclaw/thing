import { Link } from "react-router";

import { Wordmark } from "@/components/wordmark";
import { useRouteMeta } from "@/lib/route";

export function NotFoundPage() {
  useRouteMeta("Not found");
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[1040px] flex-col px-6">
      <header className="flex h-16 items-center border-b rule">
        <Wordmark />
      </header>
      <main className="settle py-20">
        <h1 className="text-[28px] font-medium tracking-[-0.02em]">There is nothing at this path</h1>
        <p className="mt-2 max-w-[48ch] text-muted">
          The address may be mistyped, or the space may have been deleted. The index knows only what
          is on disk.
        </p>
        <Link to="/" className="mt-6 inline-block text-[13px] underline decoration-line-strong">
          Go to your spaces
        </Link>
      </main>
    </div>
  );
}
