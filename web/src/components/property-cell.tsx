import { Dialog } from "@base-ui/react/dialog";
import { Popover } from "@base-ui/react/popover";
import { Check, ChevronDown, FileText, Image as ImageIcon, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { PropertyDef, ScheduleState, ValueJson, WriteResult } from "@/api/types";
import { useThumbHandedness } from "@/components/handedness";
import { PropertyInput, TitleInput } from "@/components/property-input";
import { ThingIcon } from "@/components/thing-icon";
import {
  SheetCloseButton,
  SheetHeader,
  SheetPopup,
  SheetTitle,
  SheetViewport,
} from "@/components/ui/sheet";
import { useCompactWidth } from "@/lib/media";
import { formatDateTime, formatDay } from "@/lib/display";
import { isBlank, isChecked, optionName } from "@/lib/format";
import { imagePaths } from "@/lib/files";
import { dueCellLabel, dueTone } from "@/lib/schedule";
import { isComputed } from "@/lib/schema";
import { cn } from "@/lib/cn";

interface CellCommit {
  value: unknown;
  label: string;
}

interface PropertyCellProps {
  /** The space's calendar zone for timestamp values. */
  timeZone?: string;
  spaceId: string;
  property: PropertyDef;
  cell: ValueJson | undefined;
  schedule: ScheduleState | undefined;
  canEdit: boolean;
  /** The row's title, so the control names its record to a screen reader. */
  rowTitle: string;
  /** How a calculated cell derives its value; its tooltip and read-only reason. */
  description?: string;
  onCommit: (commit: CellCommit) => Promise<WriteResult>;
}

/** A table cell: the label until clicked, then the format's own input. */
export function PropertyCell({
  spaceId,
  timeZone,
  property,
  cell,
  schedule,
  canEdit,
  rowTitle,
  description,
  onCommit,
}: PropertyCellProps) {
  const [editing, setEditing] = useState(false);
  const [writing, setWriting] = useState(false);
  const [failure, setFailure] = useState<WriteResult | null>(null);
  const [attempt, setAttempt] = useState<CellCommit | null>(null);
  const [edition, setEdition] = useState(0);
  const compact = useCompactWidth();
  const handedness = useThumbHandedness();
  const button = useRef<HTMLButtonElement | null>(null);
  /** The chip the floating editor is anchored to while it is open. */
  const anchor = useRef<HTMLSpanElement | null>(null);
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

  /**
   * A format that needs more room than a cell always opens an overlay: a
   * popover anchored to the cell on a fine pointer, the sheet on a phone. The
   * editor never renders inside the cell, so the row keeps its height and the
   * card's scrollport cannot clip it.
   */
  const overlayFormat =
    property.format === "select" ||
    property.format === "multi_select" ||
    property.format === "relation" ||
    property.format === "recurrence" ||
    property.format === "file" ||
    property.format === "image" ||
    property.format === "attachments";

  // A calculated value is derived on every read: there is nothing to edit, so
  // the cell is plain text that announces itself read-only.
  if (isComputed(property)) {
    return (
      <div
        className={cn(
          "flex min-h-8 w-full items-center gap-1.5 rounded-[8px] px-1.5 py-1 text-[length:var(--text-small)]",
          property.format === "number" && "justify-end text-right",
          "pointer-coarse:min-h-11",
        )}
        aria-readonly="true"
        title={description || "Calculated value, read only"}
      >
        <PropertyValue
          property={property}
          value={value}
          label={label}
          schedule={schedule}
          missing={cell?.missing}
          timeZone={timeZone}
        />
      </div>
    );
  }

  if (editing && canEdit) {
    const status = (
      <>
        {writing ? (
          <span role="status" className="text-[11px] text-muted">
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
      </>
    );
    const editor = (
      <PropertyInput
        key={edition}
        spaceId={spaceId}
        property={property}
        value={attempt?.value ?? value}
        onCommit={(next, nextLabel) => void write({ value: next, label: nextLabel })}
        onCancel={finish}
      />
    );
    if (overlayFormat) {
      if (compact) {
        return (
          <Dialog.Root
            open
            onOpenChange={(next) => {
              if (!next) {
                finish();
              }
            }}
          >
            <Dialog.Portal>
              <Dialog.Backdrop className="fixed inset-0 z-40 scrim" />
              <SheetViewport>
                <SheetPopup>
                  <SheetHeader>
                    {handedness === "left" ? (
                      <>
                        <SheetCloseButton label={`Close ${property.name} editor`} />
                        <div className="min-w-0">
                          <SheetTitle className="truncate">{property.name}</SheetTitle>
                          <p className="mt-0.5 truncate text-[12px] text-muted">{rowTitle}</p>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="min-w-0">
                          <SheetTitle className="truncate">{property.name}</SheetTitle>
                          <p className="mt-0.5 truncate text-[12px] text-muted">{rowTitle}</p>
                        </div>
                        <SheetCloseButton label={`Close ${property.name} editor`} />
                      </>
                    )}
                  </SheetHeader>
                  <div className="grid min-h-0 flex-1 gap-2 overflow-y-auto overscroll-contain px-4 py-4">
                    {editor}
                    {status}
                  </div>
                </SheetPopup>
              </SheetViewport>
            </Dialog.Portal>
          </Dialog.Root>
        );
      }
      return (
        <>
          {/* The cell keeps a one-line chip so the row never jumps under the
              pointer while the editor floats above the table. */}
          <span
            ref={anchor}
            className="flex min-h-8 w-full items-center gap-1.5 rounded-[8px] px-1.5 py-1 text-left text-[length:var(--text-small)] pointer-coarse:min-h-11"
          >
            <PropertyValue
              property={property}
              value={value}
              label={label}
              schedule={schedule}
              missing={cell?.missing}
              timeZone={timeZone}
            />
            <ChevronDown aria-hidden size={12} className="ml-auto shrink-0 text-faint" />
          </span>
          <Popover.Root
            open
            onOpenChange={(next) => {
              if (!next) {
                finish();
              }
            }}
          >
            <Popover.Portal>
              <Popover.Positioner
                anchor={anchor}
                sideOffset={4}
                collisionPadding={8}
                className="z-50"
              >
                <Popover.Popup
                  aria-label={`${property.name} editor for “${rowTitle}”`}
                  className={cn(
                    // The recurrence row holds a label, a number and a select;
                    // it needs a little more than the shared minimum. Never
                    // scroll sideways: an editor reads in one column.
                    "glass-strong max-h-[min(22rem,var(--available-height))] max-w-[calc(100vw-1rem)] overflow-x-hidden overflow-y-auto overscroll-contain rounded-card border border-line-strong p-2 text-[13px]",
                    property.format === "recurrence"
                      ? "w-[max(var(--anchor-width),15rem)]"
                      : property.format === "attachments"
                        ? "w-[max(var(--anchor-width),20rem)]"
                        : "w-[max(var(--anchor-width),13rem)]",
                  )}
                >
                  <div className="grid gap-2">
                    {editor}
                    {status}
                  </div>
                </Popover.Popup>
              </Popover.Positioner>
            </Popover.Portal>
          </Popover.Root>
        </>
      );
    }
    return (
      // In-cell editors are narrower than their cell; the lift keeps them above
      // the sticky action column.
      <div className="relative z-10 grid gap-1">
        {editor}
        {status}
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
        "flex min-h-8 w-full items-center gap-1.5 rounded-[8px] px-1.5 py-1 text-left text-[length:var(--text-small)] transition-colors",
        property.format === "number" && "justify-end text-right",
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
        timeZone={timeZone}
      />
    </button>
  );
}

/** The title column, which is edited as a field of the object rather than a property. */
export function TitleCell({
  title,
  icon,
  canEdit,
  onCommit,
}: {
  title: string;
  /** The record's glyph; an absent icon adds no slot. */
  icon?: string;
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
          <span role="status" className="text-[11px] text-muted">
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
        "flex min-h-8 w-full items-center rounded-[8px] px-1.5 py-1 text-left text-[14px] font-medium transition-colors",
        canEdit ? "hover:bg-raised" : "cursor-default",
        "pointer-coarse:min-h-11",
      )}
      onClick={() => setEditing(true)}
    >
      {icon ? <ThingIcon icon={icon} size="sm" className="mr-1.5" /> : null}
      <span className="truncate" title={title}>
        {title}
      </span>
    </button>
  );
}

export function PropertyValue({
  property,
  value,
  label,
  schedule,
  missing,
  timeZone,
}: {
  property: PropertyDef;
  value: unknown;
  label: string;
  schedule?: ScheduleState;
  missing?: boolean;
  timeZone?: string;
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

  if (property.format === "attachments") {
    if (isBlank(value) || label === "") {
      return (
        <span aria-hidden className="text-faint">
          —
        </span>
      );
    }
    const images = imagePaths(value);
    return (
      <span className="inline-flex min-w-0 items-center gap-1.5">
        {images.length > 0 ? (
          <ImageIcon aria-hidden size={13} className="shrink-0 text-muted" />
        ) : (
          <FileText aria-hidden size={13} className="shrink-0 text-muted" />
        )}
        <span className="truncate">{label}</span>
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

  if (property.format === "list") {
    if (isBlank(value) || label === "") {
      return (
        <span aria-hidden className="text-faint">
          —
        </span>
      );
    }
    const items = Array.isArray(value) ? value.map((item) => String(item)) : [];
    return (
      <span className="truncate" title={label}>
        {items.length > 0 ? items.join(", ") : label}
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
      ? formatDateTime(value, timeZone)
      : property.format === "date" && typeof value === "string"
        ? formatDay(value)
        : label;
  // The schedule's own phrase replaces the value only when it says more.
  const dueText = due ? dueCellLabel(due, value) : null;
  const shownDue =
    dueText !== null && dueText !== value ? dueText : text;
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
      {due ? shownDue : text}
      {missing ? (
        <TriangleAlert aria-label="Target missing" className="ml-1 inline text-warning" size={12} />
      ) : null}
    </span>
  );
}
