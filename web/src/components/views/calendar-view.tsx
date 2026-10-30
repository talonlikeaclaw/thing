import { Link } from "react-router";

import type { ObjectSummary, PropertyDef, ViewDef } from "@/api/types";
import { Button } from "@/components/ui/controls";
import { CardActions } from "@/components/views/card-actions";
import { MonthGrid } from "@/components/views/month-grid";
import { dateOfRow, recordsByDate } from "@/lib/views";

interface CalendarViewProps {
  spaceId: string;
  view: ViewDef;
  rows: ObjectSummary[];
  properties: PropertyDef[];
  month: string;
  today: string;
  /** The same type's table view, when one exists. */
  tableHref?: string;
  canEdit: boolean;
  completing: boolean;
  pendingRows: ReadonlySet<string>;
  verb: string;
  onComplete: (row: ObjectSummary) => void;
  onDuplicate: (row: ObjectSummary) => void;
  onTrash: (row: ObjectSummary) => void;
  onOpenSettings: () => void;
  onMonthChange: (month: string) => void;
}

/** A Monday-first month grid placing records on the view's date property. */
export function CalendarView({
  spaceId,
  view,
  rows,
  properties,
  month,
  today,
  tableHref,
  canEdit,
  completing,
  pendingRows,
  verb,
  onComplete,
  onDuplicate,
  onTrash,
  onOpenSettings,
  onMonthChange,
}: CalendarViewProps) {
  const dateProperty = view.date_property
    ? properties.find((property) => property.key === view.date_property)
    : undefined;

  if (!dateProperty) {
    return (
      <div className="mt-6 grid max-w-[52ch] gap-3 border-t rule pt-4">
        <p className="text-muted">
          This calendar needs a date property to place records on a day.
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
            Ask an editor to choose a date property in View settings.
          </p>
        )}
      </div>
    );
  }

  const byDate = recordsByDate(rows, dateProperty.key);
  const datedRows = [...byDate.values()].flat();
  const undated = rows.length - datedRows.length;

  function actions(row: ObjectSummary) {
    return (
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
    );
  }

  return (
    <MonthGrid
      month={month}
      today={today}
      items={datedRows}
      dateOf={dateOfRow(dateProperty.key)}
      keyOf={(row) => row.id}
      hrefOf={(row) => `/s/${spaceId}/o/${row.id}`}
      titleOf={(row) => row.title}
      renderChip={(row) => row.title}
      renderActions={actions}
      above={
        datedRows.length === 0 ? (
          <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t rule pt-3">
            <p className="text-[13px] text-muted">
              No record in this view has a {dateProperty.name} yet, so the month is
              empty. Add a date in the table or choose another date property in view
              settings.
            </p>
            {tableHref ? (
              <Link
                to={tableHref}
                className="text-[13px] text-accent underline decoration-accent/50 underline-offset-2 hover:decoration-accent pointer-coarse:min-h-11 pointer-coarse:content-center"
              >
                Open the table
              </Link>
            ) : null}
          </div>
        ) : null
      }
      onMonthChange={onMonthChange}
      footer={
        <p className="mt-2 text-[12px] text-faint">
          {undated === 0
            ? "Every record in this view has a date."
            : `${undated} ${undated === 1 ? "record has" : "records have"} no ${dateProperty.name}.`}
        </p>
      }
    />
  );
}
