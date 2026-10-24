import { Link } from "react-router";

import type { ObjectSummary, PropertyDef, ViewDef } from "@/api/types";
import { PropertyValue } from "@/components/property-cell";
import { Button } from "@/components/ui/controls";
import { CardActions } from "@/components/views/card-actions";
import { groupRows } from "@/lib/views";

interface BoardViewProps {
  spaceId: string;
  view: ViewDef;
  rows: ObjectSummary[];
  properties: PropertyDef[];
  canEdit: boolean;
  completing: boolean;
  pendingRows: ReadonlySet<string>;
  verb: string;
  onOpenSettings: () => void;
  onComplete: (row: ObjectSummary) => void;
  onDuplicate: (row: ObjectSummary) => void;
  onTrash: (row: ObjectSummary) => void;
}

/** A board: one lane per select option, cards carrying the view's columns. */
export function BoardView({
  spaceId,
  view,
  rows,
  properties,
  canEdit,
  completing,
  pendingRows,
  verb,
  onOpenSettings,
  onComplete,
  onDuplicate,
  onTrash,
}: BoardViewProps) {
  const propertyByKey = new Map(properties.map((property) => [property.key, property]));
  const group = view.group_by ? propertyByKey.get(view.group_by) : undefined;
  const cards = view.columns.filter((key) => key !== "title");

  if (!group) {
    return (
      <div className="mt-6 grid max-w-[52ch] gap-3 border-t rule pt-4">
        <p className="text-muted">
          This board needs a select property to group by.
        </p>
        {canEdit ? (
          <Button
            type="button"
            variant="ghost"
            className="min-h-8 w-fit px-3 text-[12px] pointer-coarse:min-h-11"
            onClick={onOpenSettings}
          >
            Open view settings
          </Button>
        ) : (
          <p className="text-[13px] text-faint">
            Ask an editor to choose a select property in View settings.
          </p>
        )}
      </div>
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
                  <li key={row.id} className="relative">
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
                      className="block rounded-field border border-line bg-surface px-2.5 py-2 pr-16 transition-colors hover:border-line-strong"
                    >
                      <span
                        title={row.title}
                        className="line-clamp-2 text-[14px] font-medium text-ink"
                      >
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
