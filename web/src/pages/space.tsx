import { Link, useParams } from "react-router";

import { useSpace } from "@/api/queries";
import { Button, FormError } from "@/components/ui/controls";
import { formatDate, readError } from "@/lib/display";

export function SpacePage() {
  const { spaceId } = useParams();
  const space = useSpace(spaceId);

  if (space.isPending) {
    return <p className="text-[13px] text-muted">Reading the space…</p>;
  }

  if (space.isError) {
    return (
      <div className="grid max-w-[52ch] gap-3">
        <FormError message={readError(space.error)} />
        <Button variant="ghost" className="w-fit" onClick={() => void space.refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  const detail = space.data;

  return (
    <div className="settle">
      <Link to="/" className="label hover:text-accent">
        ← all spaces
      </Link>

      <div className="mt-4 flex items-baseline gap-3">
        {detail.icon ? (
          <span aria-hidden className="text-[26px] leading-none">
            {detail.icon}
          </span>
        ) : null}
        <h1 className="text-[26px] font-medium tracking-[-0.02em]">{detail.name}</h1>
        <span className="label">{detail.role}</span>
      </div>

      <dl className="mt-8 grid gap-x-6 gap-y-3 border-t rule pt-6 sm:grid-cols-[8rem_minmax(0,1fr)]">
        <dt className="label">Space id</dt>
        <dd className="font-mono text-[12px] break-all text-muted">{detail.id}</dd>
        <dt className="label">Timezone</dt>
        <dd className="font-mono text-[12px] text-muted">{detail.timezone}</dd>
        <dt className="label">Created</dt>
        <dd className="font-mono text-[12px] text-muted">{formatDate(detail.created_at)}</dd>
        <dt className="label">Types</dt>
        <dd className="font-mono text-[12px] tnum text-muted">{detail.type_count}</dd>
      </dl>

      <section aria-labelledby="members" className="mt-10">
        <div className="flex items-baseline justify-between border-b rule pb-2">
          <h2 id="members" className="text-[17px] font-medium">
            Members
          </h2>
          <span className="label tnum">{detail.members.length}</span>
        </div>
        <ul>
          {detail.members.map((member) => (
            <li
              key={member.user}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b rule py-2.5"
            >
              <span className="text-[15px]">{member.name}</span>
              <span className="flex items-baseline gap-4">
                <span className="font-mono text-[12px] text-muted">{member.email ?? member.user}</span>
                <span className="label w-14 text-right">{member.role}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <p className="mt-10 max-w-[52ch] border-t rule pt-4 text-muted">
        {detail.type_count === 0
          ? "No types yet. A type brings its own properties and a table of records."
          : "Types and their records for this space will appear here."}
      </p>
    </div>
  );
}
