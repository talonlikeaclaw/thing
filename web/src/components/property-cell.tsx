import { Check, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { PropertyDef, ScheduleState, ValueJson, WriteResult } from "@/api/types";
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
  /** The row's title, so the control names its record to a screen reader. */
  rowTitle: string;
  onCommit: (commit: CellCommit) => Promise<WriteResult>;
}

/** A table cell: the label until clicked, then the format's own input. */
export function PropertyCell({
  spaceId,
  property,
  cell,
  schedule,
  canEdit,
  rowTitle,
  onCommit,
}: PropertyCellProps) {
  const [editing, setEditing] = useState(false);
  const [writing, setWriting] = useState(false);
  const [failure, setFailure] = useState<WriteResult | null>(null);
  const [attempt, setAttempt] = useState<CellCommit | null>(null);
  const [edition, setEdition] = useState(0);
  const button = useRef<HTMLButtonElement | null>(null);
  const returnFocus = useRef(false);
  const value = cell?.value;
  const label = cell?.label ?? "";

  useEffect(() => {
    if (!editing && returnFocus.current) {
      returnFocus.current = false;
      button.current?.focus();
    }
  }, [editing]);

  function finish() {
    returnFocus.current = true;
    setEditing(false);
    setAttempt(null);
    setFailure(null);
  }

  async function write(next: CellCommit) {
    setAttempt(next);
    setWriting(true);
    setFailure(null);
    const outcome = await onCommit(next);
    setWriting(false);
    if (outcome.ok) {
      finish();
    } else {
      setFailure(outcome);
    }
  }

  if (editing && canEdit) {
    return (
      <div className="grid gap-1">
        <PropertyInput
          key={edition}
          spaceId={spaceId}
          property={property}
          value={attempt?.value ?? value}
          onCommit={(next, nextLabel) => void write({ value: next, label: nextLabel })}
          onCancel={finish}
        />
        {writing ? (
          <span role="status" className="text-[10px] text-muted">
            Saving…
          </span>
        ) : null}
        {failure && !failure.ok ? (
          <div role="alert" className="flex flex-wrap items-center gap-2 text-[11px] text-danger">
            <span>{failure.message ?? "The write was refused."}</span>
            <button
              type="button"
              className="underline decoration-danger/50 hover:decoration-danger pointer-coarse:min-h-11"
              onClick={() => {
                if (attempt) {
                  void write(attempt);
                } else {
                  setFailure(null);
                  setEdition((current) => current + 1);
                }
              }}
            >
              Retry
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <button
      ref={button}
      type="button"
      disabled={!canEdit}
      aria-label={`Edit ${property.name} for “${rowTitle}”, currently “${label || "empty"}”`}
      className={cn(
        "flex min-h-8 w-full items-center gap-1.5 rounded-[3px] px-1.5 py-1 text-left text-[13px] transition-colors",
        canEdit ? "hover:bg-raised" : "cursor-default",
        "pointer-coarse:min-h-11",
      )}
      onClick={() => setEditing(true)}
    >
      <PropertyValue
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
  onCommit,
}: {
  title: string;
  canEdit: boolean;
  onCommit: (title: string) => Promise<WriteResult>;
}) {
  const [editing, setEditing] = useState(false);
  const [writing, setWriting] = useState(false);
  const [failure, setFailure] = useState<WriteResult | null>(null);
  const [attempt, setAttempt] = useState(title);
  const [edition, setEdition] = useState(0);
  const button = useRef<HTMLButtonElement | null>(null);
  const returnFocus = useRef(false);

  useEffect(() => {
    if (!editing && returnFocus.current) {
      returnFocus.current = false;
      button.current?.focus();
    }
  }, [editing]);

  function finish() {
    returnFocus.current = true;
    setEditing(false);
    setFailure(null);
  }

  async function write(next: string) {
    setAttempt(next);
    setWriting(true);
    setFailure(null);
    const outcome = await onCommit(next);
    setWriting(false);
    if (outcome.ok) {
      finish();
    } else {
      setFailure(outcome);
    }
  }

  if (editing && canEdit) {
    return (
      <div className="grid gap-1">
        <TitleInput
          key={edition}
          title={attempt}
          onCommit={(next) => void write(next)}
          onCancel={finish}
        />
        {writing ? (
          <span role="status" className="text-[10px] text-muted">
            Saving…
          </span>
        ) : null}
        {failure && !failure.ok ? (
          <div role="alert" className="flex flex-wrap items-center gap-2 text-[11px] text-danger">
            <span>{failure.message ?? "The write was refused."}</span>
            <button
              type="button"
              className="underline decoration-danger/50 hover:decoration-danger pointer-coarse:min-h-11"
              onClick={() => {
                if (attempt) {
                  void write(attempt);
                } else {
                  setFailure(null);
                  setEdition((current) => current + 1);
                }
              }}
            >
              Retry
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <button
      ref={button}
      type="button"
      disabled={!canEdit}
      aria-label={`Edit title for “${title}”, currently “${title}”`}
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

export function PropertyValue({
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
