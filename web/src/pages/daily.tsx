import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useParams } from "react-router";

import {
  useCreateObject,
  useObjects,
  useProperties,
  useSpace,
  useType,
  useTypes,
} from "@/api/queries";
import type { Filter } from "@/api/types";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { ErrorState } from "@/components/error-state";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { withDefaults } from "@/lib/defaults";
import { readError } from "@/lib/display";
import { useRouteMeta } from "@/lib/route";
import { todayIn } from "@/lib/timezone";

/**
 * `/s/:spaceId/daily` — today's note, opened or created once.
 *
 * The day is the space's civil day, and the record is the ordinary record of
 * the space's `daily_type` whose title is that day. The page reads it through
 * the list endpoint, opens the oldest of a duplicate pair, and creates it only
 * for an editor, with the type's defaults and an empty body.
 */
export function DailyPage() {
  const { spaceId } = useParams();
  const space = useSpace(spaceId);
  const types = useTypes(spaceId);
  const create = useCreateObject(spaceId ?? "");
  const createNote = create.mutate;
  const creating = useRef(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useRouteMeta("Today");

  const dailyType = space.data?.daily_type ?? null;
  const type = types.data?.find((summary) => summary.key === dailyType);
  const title = space.data ? todayIn(space.data.timezone) : "";
  const filter: Filter = {
    op: "and",
    conditions: [{ property: "title", condition: "equal", value: title }],
  };
  const list = useObjects(spaceId && type && title ? spaceId : undefined, {
    type: dailyType ?? "",
    filter,
    sorts: [{ property: "updated_at", direction: "asc" }],
    limit: 1,
  });
  const def = useType(type ? spaceId : undefined, type ? dailyType ?? undefined : undefined);
  const properties = useProperties(spaceId);
  const canEdit = space.data ? space.data.role !== "viewer" : false;
  const existing = list.data?.objects[0];

  // One create per visit: a second tab is allowed to make its own note, but
  // this page never creates twice while the first write is in flight, and a
  // refused create stays refused rather than looping.
  useEffect(() => {
    if (
      existing ||
      creating.current ||
      createError ||
      !canEdit ||
      !type ||
      !def.data ||
      !properties.data ||
      !title ||
      !dailyType
    ) {
      return;
    }
    creating.current = true;
    createNote(
      {
        type: dailyType,
        title,
        properties: withDefaults(def.data, properties.data, {}),
        body: "",
      },
      {
        onError: (error) => {
          creating.current = false;
          setCreateError(readError(error));
        },
      },
    );
  }, [existing, createError, canEdit, type, def.data, properties.data, title, dailyType, createNote]);

  if (space.isPending || types.isPending) {
    return <p className="text-[13px] text-muted">Reading today's note…</p>;
  }

  const error = space.error ?? types.error;
  if (error) {
    return (
      <ErrorState
        error={error}
        subject="Today"
        onRetry={() => {
          void space.refetch();
          void types.refetch();
        }}
      />
    );
  }

  if (!space.data) {
    return null;
  }

  if (existing) {
    return <Navigate to={`/s/${space.data.id}/o/${existing.id}`} replace />;
  }

  return (
    <div className="settle max-w-[76rem]">
      <Breadcrumbs
        items={[{ label: space.data.name, to: `/s/${space.data.id}` }, { label: "Today" }]}
      />
      <PageHeader
        title="Today"
        sentence={`The note this space writes for ${title} in ${space.data.timezone}.`}
        meta={type?.name}
      />
      {!dailyType ? (
        <EmptyState
          sentence="This space has no daily note yet. An owner chooses the type it writes in space settings."
          action={
            <Link
              to={`/s/${space.data.id}/settings`}
              className="text-[13px] text-accent underline-offset-4 hover:underline"
            >
              Open space settings
            </Link>
          }
        />
      ) : !type ? (
        <EmptyState
          sentence={`This space's daily note type (${dailyType}) is missing; an owner can choose another in space settings.`}
          action={
            <Link
              to={`/s/${space.data.id}/settings`}
              className="text-[13px] text-accent underline-offset-4 hover:underline"
            >
              Open space settings
            </Link>
          }
        />
      ) : canEdit ? (
        <EmptyState
          sentence={
            createError
              ? `Today's note could not be created: ${createError}`
              : "Writing today's note…"
          }
        />
      ) : (
        <EmptyState
          sentence="An editor can create today's note."
          action={
            <Link
              to={`/s/${space.data.id}/t/${type.key}`}
              className="text-[13px] text-accent underline-offset-4 hover:underline"
            >
              Open {type.name}
            </Link>
          }
        />
      )}
    </div>
  );
}
