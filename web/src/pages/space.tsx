import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";

import { useMe, useSpace, useTrash, useTypes } from "@/api/queries";
import type { TypeSummary } from "@/api/types";
import { useQuickCapture } from "@/components/quick-capture";
import { ThingIcon } from "@/components/thing-icon";
import { Button } from "@/components/ui/controls";
import { relativeTime } from "@/lib/format";
import { readRecent, recentKey, type RecentItem } from "@/lib/recent";
import { useRouteMeta } from "@/lib/route";

/**
 * `/s/:spaceId` — the space home: what changed recently, what the space can
 * hold, and the one action that makes a new space useful.
 */
export function SpacePage() {
  const { spaceId } = useParams();
  const space = useSpace(spaceId);
  const types = useTypes(spaceId);
  const me = useMe();
  const trash = useTrash(spaceId);
  const capture = useQuickCapture();
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const userId = me.data?.id;

  useRouteMeta(space.data?.name ?? "Space");

  // Browser-local and read once for this space: opening a record elsewhere in
  // the app is what updates the list, not merely visiting the home.
  useEffect(() => {
    if (!userId || !spaceId) {
      setRecent([]);
      return;
    }
    setRecent(readRecent(window.localStorage, recentKey(userId, spaceId)));
  }, [userId, spaceId]);

  const detail = space.data;
  if (!detail) {
    return <p className="text-[13px] text-muted">Reading the space…</p>;
  }
  const canEdit = detail.role !== "viewer";
  const typeList = types.data ?? [];
  const trashed = new Set((trash.data ?? []).map((item) => item.id));
  const liveRecent = recent.filter((item) => !trashed.has(item.id));

  return (
    <div className="settle">
      <div className="flex flex-wrap items-baseline gap-3">
        <ThingIcon icon={detail.icon} size="lg" />
        <h1 className="text-[26px] font-medium tracking-[-0.02em]">{detail.name}</h1>
        <span className="label">{detail.role}</span>
        <Link
          to={`/s/${detail.id}/settings`}
          className="label ml-auto transition-colors hover:text-accent pointer-coarse:min-h-11 pointer-coarse:content-center"
        >
          Settings →
        </Link>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        {canEdit ? (
          <Button
            className="min-h-10 px-4 text-[13px] pointer-coarse:min-h-11"
            onClick={() => capture.open()}
          >
            Capture a record
          </Button>
        ) : null}
        <Link
          to={`/s/${detail.id}/agenda`}
          className="inline-flex min-h-10 items-center rounded-field border border-line-interactive px-4 text-[13px] font-medium text-ink transition-colors hover:border-line-strong hover:bg-raised pointer-coarse:min-h-11"
        >
          Open schedule
        </Link>
      </div>

      <section aria-labelledby="space-recent" className="mt-10">
        <div className="flex items-baseline justify-between border-b rule pb-2">
          <h2 id="space-recent" className="text-[17px] font-medium">
            Recent
          </h2>
          <span className="label tnum">{liveRecent.length}</span>
        </div>
        {liveRecent.length === 0 ? (
          <p className="py-4 text-[13px] text-muted">Records you open will appear here.</p>
        ) : (
          <ul>
            {liveRecent.map((item) => (
              <li key={item.id} className="border-b rule">
                <Link
                  to={`/s/${detail.id}/o/${item.id}`}
                  className="flex items-baseline justify-between gap-3 py-2.5 transition-colors hover:text-accent pointer-coarse:min-h-11"
                >
                  <span className="min-w-0 truncate text-[15px]">{item.title}</span>
                  <span className="flex shrink-0 items-baseline gap-3 font-mono text-[10.5px] text-faint">
                    <span>{item.type}</span>
                    <span>{relativeTime(item.at)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="space-types" className="mt-10">
        <div className="flex items-baseline justify-between gap-3 border-b rule pb-2">
          <h2 id="space-types" className="text-[17px] font-medium">
            Types
          </h2>
          <div className="flex items-baseline gap-3">
            <span className="label tnum">{typeList.length}</span>
            {canEdit && typeList.length > 0 ? (
              <Link
                to={`/s/${detail.id}/schema`}
                className="label transition-colors hover:text-accent pointer-coarse:min-h-11 pointer-coarse:content-center"
              >
                + New type
              </Link>
            ) : null}
          </div>
        </div>

        {typeList.length === 0 ? (
          <Onboarding spaceId={detail.id} canEdit={canEdit} />
        ) : (
          <ul>
            {typeList.map((type) => (
              <TypeRow key={type.key} spaceId={detail.id} type={type} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function TypeRow({ spaceId, type }: { spaceId: string; type: TypeSummary }) {
  const records = `${type.object_count} ${
    type.object_count === 1 ? type.name.toLowerCase() : type.name_plural.toLowerCase()
  }`;
  const properties = `${type.property_count} ${
    type.property_count === 1 ? "property" : "properties"
  }`;
  return (
    <li className="border-b rule">
      <Link
        to={`/s/${spaceId}/t/${type.key}`}
        className="flex items-baseline justify-between gap-3 py-3 transition-colors hover:text-accent pointer-coarse:min-h-11"
      >
        <span className="flex min-w-0 items-baseline gap-2">
          <ThingIcon icon={type.icon} size="sm" />
          <span className="truncate text-[15px] font-medium">{type.name}</span>
          <span className="font-mono text-[10.5px] text-faint">{type.key}</span>
          {type.schedule ? <span className="label shrink-0 text-accent">SCHEDULED</span> : null}
        </span>
        <span className="flex shrink-0 items-baseline gap-3 font-mono text-[10.5px] text-faint">
          <span>{records}</span>
          <span>{properties}</span>
        </span>
      </Link>
    </li>
  );
}

function Onboarding({ spaceId, canEdit }: { spaceId: string; canEdit: boolean }) {
  return (
    <div className="mt-4 max-w-[58ch] border-b rule pb-6">
      <h3 className="text-[17px] font-medium">Start with a type</h3>
      <p className="mt-2 text-[13px] text-muted">
        A type is a table. Its properties are columns; its records are rows.
      </p>
      <ol className="mt-3 grid list-decimal gap-1 pl-5 text-[13px] text-muted marker:text-faint">
        <li>Create a type for what you keep track of.</li>
        <li>Add the properties you want to record.</li>
        <li>Add records to fill the table.</li>
      </ol>
      {canEdit ? (
        <div className="mt-4 grid gap-2">
          <Link
            to={`/s/${spaceId}/schema`}
            className="inline-flex min-h-10 w-fit items-center rounded-field bg-accent px-4 text-sm font-medium text-accent-ink transition-[filter] hover:brightness-105 pointer-coarse:min-h-11"
          >
            Create your first type
          </Link>
          <p className="text-[12px] text-faint">
            CSV import appears on a type page once a type exists.
          </p>
        </div>
      ) : (
        <p className="mt-4 text-[13px] text-muted">Ask an owner to create the first type.</p>
      )}
    </div>
  );
}
