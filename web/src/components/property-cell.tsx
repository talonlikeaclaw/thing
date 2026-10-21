import { Check, TriangleAlert } from "lucide-react";
import { useState } from "react";

import type { PropertyDef, ScheduleState, ValueJson } from "@/api/types";
import { PropertyInput, TitleInput } from "@/components/property-input";
import { formatDateTime } from "@/lib/display";
import { isBlank, isChecked, optionName } from "@/lib/format";
import { dueCellLabel, dueTone } from "@/lib/schedule";
import { cn } from "@/lib/cn";

interface CellCommit {
  value: unknown;
  label: string;
}

interface PropertyCellProps {
  spaceId: string;
  property: PropertyDef;
  cell: ValueJson | undefined;
  schedule: ScheduleState | undefined;
  canEdit: boolean;
  onCommit: (commit: CellCommit) => void;
}

/** A table cell: the label until clicked, then the format's own input. */
export function PropertyCell({
  spaceId,
  property,
  cell,
  schedule,
  canEdit,
  onCommit,
}: PropertyCellProps) {
  const [editing, setEditing] = useState(false);
  const value = cell?.value;
  const label = cell?.label ?? "";

  if (editing && canEdit) {
    return (
      <PropertyInput
        spaceId={spaceId}
        property={property}
        value={value}
        onCommit={(next, nextLabel) => {
          setEditing(false);
          onCommit({ value: next, label: nextLabel });
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <button
      type="button"
      disabled={!canEdit}
      aria-label={`Edit ${property.name}`}
      className={cn(
        "flex min-h-8 w-full items-center gap-1.5 rounded-[3px] px-1.5 py-1 text-left text-[13px] transition-colors",
        canEdit ? "hover:bg-raised" : "cursor-default",
        "pointer-coarse:min-h-11",
      )}
      onClick={() => setEditing(true)}
    >
      <CellValue
        property={property}
        value={value}
        label={label}
        schedule={schedule}
        missing={cell?.missing}
      />
    </button>
  );
}

/** The title column, which is edited as a field of the object rather than a property. */
export function TitleCell({
  title,
  canEdit,
  startEditing = false,
  onCommit,
  onCancel,
}: {
  title: string;
  canEdit: boolean;
  startEditing?: boolean;
  onCommit: (title: string) => void;
  onCancel?: () => void;
}) {
  const [editing, setEditing] = useState(startEditing);

  if (editing && canEdit) {
    return (
      <TitleInput
        title={title}
        onCommit={(next) => {
          setEditing(false);
          onCommit(next);
        }}
        onCancel={() => {
          setEditing(false);
          onCancel?.();
        }}
      />
    );
  }

  return (
    <button
      type="button"
      disabled={!canEdit}
      aria-label="Edit title"
      className={cn(
        "flex min-h-8 w-full items-center rounded-[3px] px-1.5 py-1 text-left text-[14px] font-medium transition-colors",
        canEdit ? "hover:bg-raised" : "cursor-default",
        "pointer-coarse:min-h-11",
      )}
      onClick={() => setEditing(true)}
    >
      <span className="truncate">{title}</span>
    </button>
  );
}

function CellValue({
  property,
  value,
  label,
  schedule,
  missing,
}: {
  property: PropertyDef;
  value: unknown;
  label: string;
  schedule?: ScheduleState;
  missing?: boolean;
}) {
  const due = property.key === "due_date" ? schedule : undefined;

  if (due?.status === "done") {
    return (
      <span className={cn("inline-flex items-center gap-1", dueTone(due.status))}>
        <Check aria-hidden size={12} />
        Done
      </span>
    );
  }

  if (property.format === "checkbox") {
    return isChecked(value) ? (
      <span className="inline-flex items-center gap-1 text-accent">
        <Check aria-hidden size={13} />
        <span className="sr-only">Checked</span>
      </span>
    ) : (
      <span aria-hidden className="text-faint">
        —
      </span>
    );
  }

  if (isBlank(value) || label === "") {
    return (
      <span aria-hidden className="text-faint">
        —
      </span>
    );
  }

  if (property.format === "select" && typeof value === "string") {
    const option = property.options?.find((known) => known.key === value);
    return (
      <span className="inline-flex min-w-0 items-center gap-1.5">
        <span
          aria-hidden
          className="h-2 w-2 shrink-0 rounded-full border border-line-strong"
          style={option ? { backgroundColor: option.color } : undefined}
        />
        <span className="truncate">{optionName(property, value)}</span>
      </span>
    );
  }

  const text =
    property.format === "datetime" && typeof value === "string"
      ? formatDateTime(value)
      : label;
  return (
    <span
      className={cn(
        "truncate",
        (property.format === "number" ||
          property.format === "date" ||
          property.format === "datetime") &&
          "tnum",
        property.format === "relation" && "font-mono text-[12px]",
        property.format === "url" || property.format === "email" ? "text-muted" : "",
        due ? dueTone(due.status) : "",
      )}
      title={label}
    >
      {due ? dueCellLabel(due, value) : text}
      {missing ? (
        <TriangleAlert aria-label="Target missing" className="ml-1 inline text-warning" size={12} />
      ) : null}
    </span>
  );
}
