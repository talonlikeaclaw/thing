import { Link, useParams } from "react-router";

import { useObject, useProperties, useSpace, useType, useTypes } from "@/api/queries";
import { HistoryPanel } from "@/components/history-panel";
import { ObjectPanel } from "@/components/object-panel";
import { SpaceNav } from "@/components/space-nav";
import { Button, FormError } from "@/components/ui/controls";
import { readError, shortId } from "@/lib/display";
import { effectiveProperties } from "@/lib/schema";
import { useSpaceEvents } from "@/lib/use-space-events";

/** `/s/:spaceId/o/:objectId` — one record, its properties and its markdown body. */
export function ObjectPage() {
  const { spaceId, objectId } = useParams();
  const space = useSpace(spaceId);
  const types = useTypes(spaceId);
  const properties = useProperties(spaceId);
  const object = useObject(spaceId, objectId);
  const type = useType(spaceId, object.data?.type);

  useSpaceEvents(spaceId);

  if (
    space.isPending ||
    types.isPending ||
    properties.isPending ||
    object.isPending ||
    (object.data !== undefined && type.isPending)
  ) {
    return <p className="text-[13px] text-muted">Reading the record…</p>;
  }

  const error = space.error ?? types.error ?? properties.error ?? object.error ?? type.error;
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
            void properties.refetch();
            void object.refetch();
          }}
        >
          Retry
        </Button>
      </div>
    );
  }

  const detail = space.data;
  const typesData = types.data;
  const propertiesData = properties.data;
  const record = object.data;
  if (!detail || !typesData || !propertiesData || !record) {
    return <p className="text-[13px] text-muted">Reading the record…</p>;
  }

  return (
    <div className="settle grid gap-8 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10">
      <SpaceNav
        spaceId={detail.id}
        types={typesData}
        selectedTypeKey={record.type}
        role={detail.role}
      />
      <div className="min-w-0">
        <Link
          to={`/s/${detail.id}/t/${record.type}`}
          className="label inline-flex items-center gap-1.5 transition-colors hover:text-accent pointer-coarse:min-h-11"
        >
          ← {type.data?.name_plural ?? record.type}
        </Link>
        <ObjectPanel
          key={record.id}
          spaceId={detail.id}
          type={type.data}
          object={record}
          properties={effectiveProperties(type.data, propertiesData)}
          canEdit={detail.role !== "viewer"}
          reloadObject={async () => (await object.refetch()).data}
        />
        <HistoryPanel
          spaceId={detail.id}
          objectId={record.id}
          properties={effectiveProperties(type.data, propertiesData)}
          memberName={(userId) =>
            detail.members.find((member) => member.user === userId)?.name ?? shortId(userId)
          }
        />
      </div>
    </div>
  );
}
