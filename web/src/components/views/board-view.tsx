import { Link } from "react-router";

import type { ObjectSummary, PropertyDef, ViewDef } from "@/api/types";
import { PropertyValue } from "@/components/property-cell";
import { groupRows } from "@/lib/views";

interface BoardViewProps {
  spaceId: string;
  view: ViewDef;
  rows: ObjectSummary[];
  properties: PropertyDef[];
}

/** A board: one lane per select option, cards carrying the view's columns. */
export function BoardView({ spaceId, view, rows, properties }: BoardViewProps) {
  const propertyByKey = new Map(properties.map((property) => [property.key, property]));
  const group = view.group_by ? propertyByKey.get(view.group_by) : undefined;
  const cards = view.columns.filter((key) => key !== "title");

  if (!group) {
    return (
      <p className="mt-6 max-w-[52ch] border-t rule pt-4 text-muted">
        This board names no select property to group by. Open View settings or edit the
        type file so the view has a <span className="font-mono text-[12px]">group_by</span>.
      </p>
    );
  }

  const lanes = groupRows(rows, group);

  return (
    <div className="mt-6 overflow-x-auto pb-2">
      <div className="flex items-start gap-3">
        {lanes.map((lane) => (
          <section
            key={lane.key || "no-value"}
            aria-label={lane.label}
            className="w-[17rem] shrink-0 border-t rule pt-2"
          >
            <div className="flex items-baseline justify-between gap-2 px-1">
              <span className="label truncate">{lane.label}</span>
              <span className="label tnum">{lane.rows.length}</span>
            </div>
            {lane.rows.length === 0 ? (
              <p className="mt-2 px-1 text-[12px] text-faint">No records</p>
            ) : (
              <ul className="mt-2 grid gap-1.5">
                {lane.rows.map((row) => (
                  <li key={row.id}>
                    <Link
                      to={`/s/${spaceId}/o/${row.id}`}
                      className="block rounded-field border border-line bg-surface px-2.5 py-2 transition-colors hover:border-line-strong"
                    >
                      <span className="block truncate text-[14px] font-medium text-ink">
                        {row.title}
                      </span>
                      {cards.length > 0 ? (
                        <dl className="mt-1 grid gap-0.5">
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
                                <dt className="shrink-0 font-mono text-[10px] text-faint">
                                  {key}
                                </dt>
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
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
