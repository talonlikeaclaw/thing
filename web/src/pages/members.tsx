import { Link, useParams } from "react-router";

import { useSpace } from "@/api/queries";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { formatDate } from "@/lib/display";
import { useRouteMeta } from "@/lib/route";

export function MembersPage() {
  const { spaceId } = useParams();
  const space = useSpace(spaceId);

  useRouteMeta("Members");

  const detail = space.data;
  if (!detail) {
    return <p className="text-[13px] text-muted">Reading the space…</p>;
  }

  return (
    <div className="settle">
      <Breadcrumbs
        items={[{ label: detail.name, to: `/s/${detail.id}` }, { label: "Members" }]}
      />

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
        <Link
          to={`/s/${detail.id}/schema`}
          className="label transition-colors hover:text-accent pointer-coarse:min-h-11 pointer-coarse:content-center"
        >
          Schema →
        </Link>
      </div>

      <dl className="mt-8 grid gap-x-6 gap-y-3 border-t rule pt-6 sm:grid-cols-[8rem_minmax(0,1fr)]">
        <dt className="label">Space id</dt>
        <dd className="font-mono text-[12px] break-all text-muted">{detail.id}</dd>
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

    </div>
  );
}
