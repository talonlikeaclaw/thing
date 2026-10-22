import { useParams } from "react-router";

import { useProperties, useSpace, useType, useTypes } from "@/api/queries";
import { SpaceNav } from "@/components/space-nav";
import { TypeTable } from "@/components/type-table";
import { Button, FormError } from "@/components/ui/controls";
import { readError } from "@/lib/display";
import { effectiveProperties } from "@/lib/schema";

/** `/s/:spaceId/t/:typeKey` — one type's live table. */
export function TypeTablePage() {
  const { spaceId, typeKey } = useParams();
  const space = useSpace(spaceId);
  const types = useTypes(spaceId);
  const type = useType(spaceId, typeKey);
  const properties = useProperties(spaceId);

  if (space.isPending || types.isPending || type.isPending || properties.isPending) {
    return <p className="text-[13px] text-muted">Reading the table…</p>;
  }

  const error = space.error ?? types.error ?? type.error ?? properties.error;
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
            void type.refetch();
            void properties.refetch();
          }}
        >
          Retry
        </Button>
      </div>
    );
  }

  const detail = space.data;
  const typesData = types.data;
  const typeData = type.data;
  const propertiesData = properties.data;
  if (!detail || !typesData || !typeData || !propertiesData) {
    return <p className="text-[13px] text-muted">Reading the table…</p>;
  }

  return (
    <div className="settle grid gap-8 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10">
      <SpaceNav
        spaceId={detail.id}
        types={typesData}
        selectedTypeKey={typeData.key}
        role={detail.role}
      />
      <div className="min-w-0">
        <TypeTable
          key={`${typeData.key}:${spaceId}`}
          spaceId={detail.id}
          type={typeData}
          properties={effectiveProperties(typeData, propertiesData)}
          canEdit={detail.role !== "viewer"}
          timeZone={detail.timezone}
        />
      </div>
    </div>
  );
}
