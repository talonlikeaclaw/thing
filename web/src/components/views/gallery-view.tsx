import { Link } from "react-router";

import type { ObjectSummary, PropertyDef, TypeDef, ViewDef } from "@/api/types";
import { PropertyValue } from "@/components/property-cell";
import { ThingIcon } from "@/components/thing-icon";
import { CardActions } from "@/components/views/card-actions";

interface GalleryViewProps {
  spaceId: string;
  /** The space's calendar zone for timestamp values. */
  timeZone?: string;
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
  timeZone,
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

  return (
    <ul className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
      {rows.map((row) => {
        const coverLabel = cover ? row.values[cover.key]?.label.trim() : "";
        const coverValue = cover ? row.values[cover.key]?.value : undefined;
        const coverOption =
          cover?.format === "select" && typeof coverValue === "string"
            ? cover.options?.find((option) => option.key === coverValue)
            : undefined;
        // Option colours are user data: the editor stores hex, an older space
        // may name a CSS colour. `color-mix` accepts both; an unreadable colour
        // drops the declaration and the band keeps its `bg-raised`.
        const tint = coverOption
          ? `color-mix(in srgb, ${coverOption.color} 18%, transparent)`
          : undefined;
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
              <span
                className="flex min-h-24 items-end justify-between gap-2 border-b rule bg-raised px-3 py-2"
                style={tint ? { backgroundColor: tint } : undefined}
              >
                {coverLabel ? (
                  <span className="truncate text-[15px] text-ink" title={coverLabel}>
                    {coverLabel}
                  </span>
                ) : (
                  <span />
                )}
                {tint ? null : <ThingIcon icon={type.icon} size="lg" />}
              </span>
              <span className="grid gap-1.5 px-3 py-2.5">
                <span className="flex items-start gap-1.5">
                  {row.icon ? (
                    <ThingIcon icon={row.icon} size="sm" className="mt-0.5" />
                  ) : null}
                  <span
                    title={row.title}
                    className="line-clamp-2 min-w-0 text-[14px] font-medium text-ink"
                  >
                    {row.title}
                  </span>
                </span>
                {cards.length > 0 ? (
                  <dl className="grid gap-0.5">
                    {cards.map((key) => {
                      const property = propertyByKey.get(key);
                      if (!property) {
                        return (
                          <div key={key} className="font-mono text-[11px] text-faint">
                            {key}
                          </div>
                        );
                      }
                      return (
                        <div
                          key={key}
                          className="flex min-w-0 items-baseline gap-1.5 text-[12px]"
                        >
                          <dt className="shrink-0 text-[11px] text-faint">{property.name}</dt>
                          <dd className="min-w-0 truncate text-muted">
                            <PropertyValue
                              property={property}
                              value={row.values[key]?.value}
                              label={row.values[key]?.label ?? ""}
                              missing={row.values[key]?.missing}
                              schedule={row.schedule}
                              timeZone={timeZone}
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
