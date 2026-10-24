import { Link } from "react-router";

import type { ObjectSummary, PropertyDef, TypeDef, ViewDef } from "@/api/types";
import { PropertyValue } from "@/components/property-cell";
import { CardActions } from "@/components/views/card-actions";

interface GalleryViewProps {
  spaceId: string;
  type: TypeDef;
  view: ViewDef;
  rows: ObjectSummary[];
  properties: PropertyDef[];
  canEdit: boolean;
  completing: boolean;
  pendingRows: ReadonlySet<string>;
  verb: string;
  onComplete: (row: ObjectSummary) => void;
  onDuplicate: (row: ObjectSummary) => void;
  onTrash: (row: ObjectSummary) => void;
}

/** A gallery of typographic tiles: the cover label, then the view's columns. */
export function GalleryView({
  spaceId,
  type,
  view,
  rows,
  properties,
  canEdit,
  completing,
  pendingRows,
  verb,
  onComplete,
  onDuplicate,
  onTrash,
}: GalleryViewProps) {
  const propertyByKey = new Map(properties.map((property) => [property.key, property]));
  const cover = view.cover ? propertyByKey.get(view.cover) : undefined;
  const cards = view.columns.filter((key) => key !== "title");
  const fallback = type.icon ?? type.name_plural;

  return (
    <ul className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
      {rows.map((row) => {
        const coverLabel = cover ? row.values[cover.key]?.label.trim() : "";
        return (
          <li key={row.id} className="relative min-w-0">
            <div className="absolute top-1 right-1 z-10">
              <CardActions
                spaceId={spaceId}
                row={row}
                canEdit={canEdit}
                completing={completing}
                pending={pendingRows.has(row.id)}
                showComplete={row.schedule !== undefined && row.schedule.status !== "done"}
                verb={verb}
                onComplete={() => onComplete(row)}
                onDuplicate={() => onDuplicate(row)}
                onTrash={() => onTrash(row)}
              />
            </div>
            <Link
              to={`/s/${spaceId}/o/${row.id}`}
              className="flex h-full flex-col rounded-field border border-line bg-surface transition-colors hover:border-line-strong"
            >
              <span className="flex min-h-24 items-end border-b rule px-3 py-2">
                {coverLabel ? (
                  <span className="truncate text-[15px] text-ink" title={coverLabel}>
                    {coverLabel}
                  </span>
                ) : (
                  <span aria-hidden className="text-[24px] leading-none">
                    {fallback}
                  </span>
                )}
              </span>
              <span className="grid gap-1.5 px-3 py-2.5">
                <span
                  title={row.title}
                  className="line-clamp-2 text-[14px] font-medium text-ink"
                >
                  {row.title}
                </span>
                {cards.length > 0 ? (
                  <dl className="grid gap-0.5">
                    {cards.map((key) => {
                      const property = propertyByKey.get(key);
                      if (!property) {
                        return (
                          <div key={key} className="font-mono text-[10px] text-faint">
                            {key}
                          </div>
                        );
                      }
                      return (
                        <div
                          key={key}
                          className="flex min-w-0 items-baseline gap-1.5 text-[12px]"
                        >
                          <dt className="shrink-0 font-mono text-[10px] text-faint">{key}</dt>
                          <dd className="min-w-0 truncate text-muted">
                            <PropertyValue
                              property={property}
                              value={row.values[key]?.value}
                              label={row.values[key]?.label ?? ""}
                              missing={row.values[key]?.missing}
                              schedule={row.schedule}
                            />
                          </dd>
                        </div>
                      );
                    })}
                  </dl>
                ) : null}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
