import { Link, Navigate, useParams } from "react-router";

import { useSpace, useTypes } from "@/api/queries";
import { Button, FormError } from "@/components/ui/controls";
import { readError } from "@/lib/display";

/** `/s/:spaceId` is the first type's table, unless the space has no types yet. */
export function SpacePage() {
  const { spaceId } = useParams();
  const space = useSpace(spaceId);
  const types = useTypes(spaceId);

  if (space.isPending || types.isPending) {
    return <p className="text-[13px] text-muted">Reading the space…</p>;
  }

  const error = space.error ?? types.error;
  if (error) {
    return (
      <div className="grid max-w-[52ch] gap-3">
        <FormError message={readError(error)} />
        <Button
          variant="ghost"
          className="w-fit"
          onClick={() => {
            void space.refetch();
            void types.refetch();
          }}
        >
          Retry
        </Button>
      </div>
    );
  }

  const detail = space.data;
  const first = types.data?.[0];
  if (!detail) {
    return <p className="text-[13px] text-muted">Reading the space…</p>;
  }
  if (first) {
    return <Navigate to={`/s/${detail.id}/t/${first.key}`} replace />;
  }

  return (
    <div className="settle max-w-[52ch]">
      <div className="flex items-baseline gap-3">
        {detail.icon ? (
          <span aria-hidden className="text-[26px] leading-none">
            {detail.icon}
          </span>
        ) : null}
        <h1 className="text-[26px] font-medium tracking-[-0.02em]">{detail.name}</h1>
        <span className="label">{detail.role}</span>
        <Link
          to={`/s/${detail.id}/settings`}
          className="label ml-auto transition-colors hover:text-accent pointer-coarse:min-h-11 pointer-coarse:content-center"
        >
          Settings →
        </Link>
      </div>
      <p className="mt-3 text-muted">
        This space has no types yet. A type is a table: its properties become columns and
        its records become rows.
      </p>
      <Link
        to={`/s/${detail.id}/schema`}
        className="mt-4 inline-flex min-h-10 w-fit items-center rounded-field bg-accent px-4 text-sm font-medium text-accent-ink transition-[filter] hover:brightness-105 pointer-coarse:min-h-11"
      >
        Create your first type
      </Link>
    </div>
  );
}
