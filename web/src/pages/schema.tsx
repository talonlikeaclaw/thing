import { useParams, useSearchParams } from "react-router";

import { useProperties, useSpace, useType, useTypes } from "@/api/queries";
import { PropertyEditor } from "@/components/schema/property-editor";
import { PropertyList } from "@/components/schema/property-list";
import { TypeEditor } from "@/components/schema/type-editor";
import { TypeList } from "@/components/schema/type-list";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { ErrorState } from "@/components/error-state";
import { useRouteMeta } from "@/lib/route";
import { effectiveProperties } from "@/lib/schema";

export function SchemaPage() {
  const { spaceId } = useParams();
  const space = useSpace(spaceId);
  const types = useTypes(spaceId);
  const properties = useProperties(spaceId);
  const [params, setParams] = useSearchParams();

  const selectedTypeKey = params.get("type") ?? types.data?.[0]?.key;
  const type = useType(spaceId, selectedTypeKey);
  const selectedPropertyKey = params.get("property") ?? undefined;
  const selectedProperty = properties.data?.find(
    (property) => property.key === selectedPropertyKey,
  );

  function selectType(key: string) {
    const next = new URLSearchParams(params);
    next.set("type", key);
    next.delete("property");
    setParams(next, { replace: true });
  }

  function selectProperty(key: string) {
    const next = new URLSearchParams(params);
    next.set("property", key);
    setParams(next, { replace: true });
  }

  useRouteMeta("Schema");

  if (types.isPending || properties.isPending) {
    return <p className="text-[13px] text-muted">Reading the schema…</p>;
  }

  if (types.isError || properties.isError) {
    const error = types.error ?? properties.error;
    return (
      <ErrorState
        error={error}
        subject="Schema"
        onRetry={() => {
          void types.refetch();
          void properties.refetch();
        }}
      />
    );
  }

  const detail = space.data;
  if (!detail) {
    return <p className="text-[13px] text-muted">Reading the schema…</p>;
  }
  const canEdit = detail.role !== "viewer";

  return (
    <div className="settle">
      <Breadcrumbs
        items={[{ label: detail.name, to: `/s/${detail.id}` }, { label: "Schema" }]}
      />

      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h1 className="text-[26px] font-medium tracking-[-0.02em]">Schema</h1>
        <span className="label">{detail.role}</span>
      </div>
      <p className="mt-2 max-w-[62ch] text-muted">
        Types are tables and properties are columns. Both are shared by everyone in the space;
        every change is written to the markdown files on disk.
      </p>

      <div className="mt-10 grid gap-12 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)] lg:gap-10">
        <TypeList
          spaceId={detail.id}
          types={types.data}
          selectedKey={selectedTypeKey}
          canEdit={canEdit}
          onSelect={selectType}
          onCreated={selectType}
        />
        <div>
          {type.isPending && selectedTypeKey ? (
            <p className="text-[13px] text-muted">Reading the type…</p>
          ) : type.isError ? (
            <div className="grid gap-3">
              <ErrorState error={type.error} subject="This type" onRetry={() => void type.refetch()} />
            </div>
          ) : type.data ? (
            <TypeEditor
              key={type.data.key}
              spaceId={detail.id}
              type={type.data}
              properties={effectiveProperties(type.data, properties.data)}
              recordCount={
                types.data.find((summary) => summary.key === type.data?.key)?.object_count ?? 0
              }
              canEdit={canEdit}
            />
          ) : (
            <p className="max-w-[48ch] border-t rule pt-4 text-muted">
              No type selected yet. Create a type to give this space its first table.
            </p>
          )}
        </div>
      </div>

      <div className="mt-16 grid gap-12 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)] lg:gap-10">
        <PropertyList
          spaceId={detail.id}
          properties={properties.data}
          types={types.data}
          selectedKey={selectedPropertyKey}
          canEdit={canEdit}
          onSelect={selectProperty}
          onCreated={selectProperty}
        />
        <div>
          {selectedProperty ? (
            <PropertyEditor
              key={selectedProperty.key}
              spaceId={detail.id}
              property={selectedProperty}
              types={types.data}
              canEdit={canEdit}
              onRenamed={selectProperty}
            />
          ) : (
            <p className="max-w-[48ch] border-t rule pt-4 text-muted">
              Select a property to edit it, or create one to describe a new column. A property's
              format is fixed once it exists; its name, options and colours stay editable.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
