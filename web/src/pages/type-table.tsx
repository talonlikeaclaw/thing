import { useParams } from "react-router";

import { useProperties, useSpace, useType } from "@/api/queries";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { ErrorState } from "@/components/error-state";
import { TypeTable } from "@/components/type-table";
import { effectiveProperties } from "@/lib/schema";
import { useRouteMeta } from "@/lib/route";

/** `/s/:spaceId/t/:typeKey` — one type's live table. */
export function TypeTablePage() {
  const { spaceId, typeKey } = useParams();
  const space = useSpace(spaceId);
  const type = useType(spaceId, typeKey);
  const properties = useProperties(spaceId);

  useRouteMeta(type.data?.name_plural ?? "Type");

  if (type.isPending || properties.isPending) {
    return <p className="text-[13px] text-muted">Reading the table…</p>;
  }

  const error = type.error ?? properties.error;
  if (error) {
    return (
      <ErrorState
        error={error}
        subject="Type"
        onRetry={() => {
          void type.refetch();
          void properties.refetch();
        }}
      />
    );
  }

  const detail = space.data;
  const typeData = type.data;
  const propertiesData = properties.data;
  if (!detail || !typeData || !propertiesData) {
    return <p className="text-[13px] text-muted">Reading the table…</p>;
  }

  return (
    <>
      <Breadcrumbs
        items={[
          { label: detail.name, to: `/s/${detail.id}` },
          { label: typeData.name_plural },
        ]}
      />
      <TypeTable
        key={`${typeData.key}:${spaceId}`}
        spaceId={detail.id}
        type={typeData}
        properties={effectiveProperties(typeData, propertiesData)}
        canEdit={detail.role !== "viewer"}
        timeZone={detail.timezone}
      />
    </>
  );
}
