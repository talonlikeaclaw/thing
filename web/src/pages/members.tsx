import { useState } from "react";
import { Link, useParams } from "react-router";

import { useSpace, useUpdateSpace } from "@/api/queries";
import { Button, FormError, SelectField } from "@/components/ui/controls";
import { formatDate, readError } from "@/lib/display";
import { timezoneNames } from "@/lib/timezone";

export function MembersPage() {
  const { spaceId } = useParams();
  const space = useSpace(spaceId);
  const update = useUpdateSpace(spaceId ?? "");
  const [pendingZone, setPendingZone] = useState<string | null>(null);
  const [zoneError, setZoneError] = useState<string | null>(null);

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
  const zone = pendingZone ?? detail.timezone;
  const zoneOptions = timezoneNames(detail.timezone).map((name) => ({
    value: name,
    label: name,
  }));

  function changeZone(next: string) {
    if (next === detail.timezone || update.isPending) {
      return;
    }
    setPendingZone(next);
    setZoneError(null);
    update.mutate(
      { timezone: next },
      {
        onSuccess: () => setPendingZone(null),
        onError: (error) => {
          setPendingZone(null);
          setZoneError(readError(error));
        },
      },
    );
  }

  return (
    <div className="settle">
      <Link to={`/s/${spaceId}`} className="label hover:text-accent">
        ← {space.data?.name ?? "space"}
      </Link>

      <div className="mt-4 flex items-baseline gap-3">
        {detail.icon ? (
          <span aria-hidden className="text-[26px] leading-none">
            {detail.icon}
          </span>
        ) : null}
        <h1 className="text-[26px] font-medium tracking-[-0.02em]">{detail.name}</h1>
        <span className="label">{detail.role}</span>
        <Link
          to={`/s/${detail.id}/schema`}
          className="label ml-auto transition-colors hover:text-accent pointer-coarse:min-h-11 pointer-coarse:content-center"
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

      <section aria-labelledby="space-timezone" className="mt-10">
        <div className="flex items-baseline justify-between border-b rule pb-2">
          <h2 id="space-timezone" className="text-[17px] font-medium">
            Space timezone
          </h2>
          {update.isPending ? <span className="label">saving</span> : null}
        </div>
        <div className="mt-4 max-w-[28rem]">
          {detail.role === "owner" ? (
            <SelectField
              label="Zone"
              value={zone}
              options={zoneOptions}
              onValueChange={changeZone}
              disabled={update.isPending}
              hint="Due and overdue are calendar days in this zone."
            />
          ) : (
            <>
              <p className="font-mono text-[12px] text-muted">{detail.timezone}</p>
              <p className="mt-1 text-[13px] text-muted">
                Due and overdue are calendar days in this zone.
              </p>
            </>
          )}
          {zoneError ? (
            <div className="mt-3">
              <FormError message={zoneError} />
            </div>
          ) : null}
        </div>
      </section>

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
