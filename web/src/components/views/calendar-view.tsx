import { Link } from "react-router";

import type { ObjectSummary, PropertyDef, ViewDef } from "@/api/types";
import { ThumbRow } from "@/components/handedness";
import { Button } from "@/components/ui/controls";
import { CardActions } from "@/components/views/card-actions";
import { MonthGrid } from "@/components/views/month-grid";
import { cn } from "@/lib/cn";
import { formatDay } from "@/lib/display";
import { duePhrase, dueTone } from "@/lib/schedule";
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

  const dateOf = dateOfRow(dateProperty.key);
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
      dateOf={dateOf}
      keyOf={(row) => row.id}
      hrefOf={(row) => `/s/${spaceId}/o/${row.id}`}
      titleOf={(row) => row.title}
      renderChip={(row) => (
        <>
          {row.icon ? (
            <span aria-hidden className="mr-1">
              {row.icon}
            </span>
          ) : null}
          {row.title}
        </>
      )}
      renderRow={(row) => {
        const day = dateOf(row);
        const phrase = row.schedule
          ? duePhrase(row.schedule.status, row.schedule.days_until_due)
          : "";
        return (
          <ThumbRow className="min-w-0 flex-1 items-center gap-1">
            <Link
              to={`/s/${spaceId}/o/${row.id}`}
              title={row.title}
              className="min-w-0 flex-1 px-1 py-1 hover:bg-raised pointer-coarse:min-h-11"
            >
              <span className="flex items-baseline gap-1.5">
                {row.icon ? (
                  <span aria-hidden className="shrink-0 text-[13px]">
                    {row.icon}
                  </span>
                ) : null}
                <span className="min-w-0 truncate text-[13px] text-ink">{row.title}</span>
              </span>
              <span className="mt-0.5 flex flex-wrap items-baseline gap-x-2 font-mono text-[11px]">
                <span className="tnum text-muted">{day ? formatDay(day) : ""}</span>
                {phrase ? (
                  <span className={cn("tnum", dueTone(row.schedule?.status ?? "upcoming"))}>
                    {phrase}
                  </span>
                ) : null}
              </span>
            </Link>
            {actions(row)}
          </ThumbRow>
        );
      }}
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
