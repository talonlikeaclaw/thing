import { useParams } from "react-router";

import { useObject, useProperties, useSpace, useType } from "@/api/queries";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { ErrorState } from "@/components/error-state";
import { HistoryPanel } from "@/components/history-panel";
import { ObjectPanel } from "@/components/object-panel";
import { shortId } from "@/lib/display";
import { effectiveProperties } from "@/lib/schema";
import { useRouteMeta } from "@/lib/route";

/** `/s/:spaceId/o/:objectId` — one record, its properties and its markdown body. */
export function ObjectPage() {
  const { spaceId, objectId } = useParams();
  const space = useSpace(spaceId);
  const properties = useProperties(spaceId);
  const object = useObject(spaceId, objectId);
  const type = useType(spaceId, object.data?.type);

  useRouteMeta(object.data?.title ?? "Record");

  if (
    properties.isPending ||
    object.isPending ||
    (object.data !== undefined && type.isPending)
  ) {
    return <p className="text-[13px] text-muted">Reading the record…</p>;
  }

  const error = properties.error ?? object.error ?? type.error;
  if (error) {
    return (
      <ErrorState
        error={error}
        subject="Record"
        onRetry={() => {
          void properties.refetch();
          void object.refetch();
          void type.refetch();
        }}
      />
    );
  }

  const detail = space.data;
  const propertiesData = properties.data;
  const record = object.data;
  if (!detail || !propertiesData || !record || !type.data) {
    return <p className="text-[13px] text-muted">Reading the record…</p>;
  }

  const typeData = type.data;

  return (
    <div className="settle">
      <Breadcrumbs
        items={[
          { label: detail.name, to: `/s/${detail.id}` },
          { label: typeData.name_plural, to: `/s/${detail.id}/t/${typeData.key}` },
          { label: record.title },
        ]}
      />
      <ObjectPanel
        key={record.id}
        spaceId={detail.id}
        type={typeData}
        object={record}
        properties={effectiveProperties(typeData, propertiesData)}
        canEdit={detail.role !== "viewer"}
        reloadObject={async () => (await object.refetch()).data}
      />
      <HistoryPanel
        spaceId={detail.id}
        objectId={record.id}
        properties={effectiveProperties(typeData, propertiesData)}
        memberName={(userId) =>
          detail.members.find((member) => member.user === userId)?.name ?? shortId(userId)
        }
      />
    </div>
  );
}
