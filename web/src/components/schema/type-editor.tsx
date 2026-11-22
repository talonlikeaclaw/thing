import { Dialog } from "@base-ui/react/dialog";
import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";

import { ApiError } from "@/api/client";
import { useDeleteType, useTypes, useUpdateType } from "@/api/queries";
import type { Filter, PropertyDef, ScheduleLabels, TypeDef } from "@/api/types";
import { ThumbRow, useThumbHandedness } from "@/components/handedness";
import { IconPicker } from "@/components/icon-picker";
import { ManageProperties } from "@/components/manage-properties";
import {
  Button,
  FormError,
  StickyActionBar,
  TextAreaField,
  TextField,
} from "@/components/ui/controls";
import {
  EmptyState,
  FieldRow,
  FormatChip,
  Group,
  GroupControl,
  SectionRule,
} from "@/components/ui/page";
import {
  SheetCloseButton,
  SheetHeader,
  SheetPopup,
  SheetTitle,
  SheetViewport,
} from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { readError } from "@/lib/display";
import { useDirtyGuard } from "@/lib/use-dirty-guard";
import { filterParam } from "@/lib/filter";
import { labeledScheduleProperties, SCHEDULE_PROPERTY_DEFS } from "@/lib/schedule";
import {
  computeKindLabel,
  effectiveProperties,
  formatLabel,
  sameJson,
} from "@/lib/schema";
import { valueLabel } from "@/lib/format";

interface ConflictRecord {
  id: string;
  title: string;
  trashed: boolean;
}

interface DisableConflict {
  count: number;
  records: ConflictRecord[];
}

/** The records the server named when scheduling could not be turned off. */
function disableConflict(error: unknown): DisableConflict | null {
  if (!(error instanceof ApiError) || error.status !== 409) {
    return null;
  }
  const count = error.details.objects;
  if (typeof count !== "number" || count === 0) {
    return null;
  }
  const raw = error.details.records;
  const records: ConflictRecord[] = Array.isArray(raw)
    ? raw.flatMap((item) => {
        if (
          typeof item !== "object" ||
          item === null ||
          !("id" in item) ||
          typeof item.id !== "string" ||
          !("title" in item) ||
          typeof item.title !== "string"
        ) {
          return [];
        }
        return [
          {
            id: item.id,
            title: item.title,
            trashed: "trashed" in item && item.trashed === true,
          },
        ];
      })
    : [];
  return { count, records };
}

interface TypeEditorFormProps {
  spaceId: string;
  type: TypeDef;
  /** The whole space library, so a member's format and kind resolve. */
  properties: PropertyDef[];
  recordCount: number;
  canEdit: boolean;
  /** The schema page's rule; a sheet already has a title and omits it. */
  headingId?: string;
  /** Where the reader goes once the type and its records are gone. */
  onDeleted: () => void;
}

/**
 * The type form every surface shares: the schema page renders it inline, the
 * type page renders it inside the shared overlay. Its chapters mirror the
 * property sheet, so both sides of the schema read the same way.
 */
export function TypeEditorForm({
  spaceId,
  type,
  properties,
  recordCount,
  canEdit,
  headingId,
  onDeleted,
}: TypeEditorFormProps) {
  const update = useUpdateType(spaceId, type.key);
  const remove = useDeleteType(spaceId, type.key);
  const toast = useToast();
  const [name, setName] = useState(type.name);
  const [plural, setPlural] = useState(type.name_plural);
  const [icon, setIcon] = useState(type.icon ?? "");
  const [description, setDescription] = useState(type.description);
  const [schedule, setSchedule] = useState(type.schedule);
  const [labels, setLabels] = useState<ScheduleLabels>(type.schedule_labels ?? {});
  const [manageOpen, setManageOpen] = useState(false);
  const [confirmKey, setConfirmKey] = useState("");
  const [moveRecords, setMoveRecords] = useState(false);

  // Adopt the saved definition, including any trimming the server applied.
  useEffect(() => {
    if (update.data) {
      setName(update.data.name);
      setPlural(update.data.name_plural);
      setIcon(update.data.icon ?? "");
      setDescription(update.data.description);
      setSchedule(update.data.schedule);
      setLabels(update.data.schedule_labels ?? {});
    }
  }, [update.data]);

  const implicit = schedule
    ? labeledScheduleProperties(
        type.implicit_properties ?? SCHEDULE_PROPERTY_DEFS,
        labels,
      )
    : [];
  const library = effectiveProperties(
    { ...type, schedule, implicit_properties: implicit },
    properties,
  );
  const payload = {
    name: name.trim(),
    name_plural: plural.trim(),
    icon: icon.trim() ? icon.trim() : null,
    description,
    schedule,
    schedule_labels: schedule ? labels : {},
  };
  const initial = {
    name: type.name,
    name_plural: type.name_plural,
    icon: type.icon ?? null,
    description: type.description,
    schedule: type.schedule,
    schedule_labels: type.schedule_labels ?? {},
  };
  const dirty = !sameJson(payload, initial);
  const invalid = !payload.name || !payload.name_plural;

  async function saveDraft(): Promise<boolean> {
    if (!canEdit || invalid) {
      return false;
    }
    try {
      await update.mutateAsync(payload);
      return true;
    } catch {
      return false;
    }
  }

  const guard = useDirtyGuard(dirty && !remove.isSuccess, saveDraft);

  const deleteReady =
    confirmKey.trim().toLowerCase() === type.key.toLowerCase() &&
    (recordCount === 0 || moveRecords) &&
    !remove.isPending;

  const conflict = disableConflict(update.error);
  const scheduleKeyFilter: Filter = {
    op: "or",
    conditions: [
      { property: "due_date", condition: "is_not_empty" },
      { property: "recurrence", condition: "is_not_empty" },
      { property: "last_completed_at", condition: "is_not_empty" },
    ],
  };
  const liveConflictRecords = conflict?.records.filter((record) => !record.trashed) ?? [];
  const propertyOf = (key: string) =>
    library.find((property) => property.key === key);
  const titleProperty = (key: string) => propertyOf(key)?.name ?? key;
  const formatOf = (key: string) => {
    const format = propertyOf(key)?.format;
    return format ? formatLabel(format) : "unknown";
  };
  const kindOf = (key: string) => {
    const property = propertyOf(key);
    return property ? computeKindLabel(property) : null;
  };

  const content = (
    <>
      {headingId ? (
        <SectionRule
          id={headingId}
          title={type.name}
          className="scroll-mt-[calc(var(--shell-header-h)+1rem)]"
          action={
            <span className="flex flex-wrap items-baseline gap-3">
              {!dirty && update.isSuccess ? (
                <span className="label text-accent">saved</span>
              ) : null}
              <span className="font-mono text-[11px] text-faint">
                types/{type.key}.yml
              </span>
            </span>
          }
        />
      ) : null}

      <div
        className={cn(
          "grid divide-y divide-line border-b rule",
          headingId ? "mt-2" : undefined,
        )}
      >
        <Group title="Definition">
          <FieldRow label="Icon" htmlFor={`type-${type.key}-icon`}>
            <div>
              <IconPicker
                variant="glyph"
                label="Icon"
                id={`type-${type.key}-icon`}
                value={icon}
                onChange={setIcon}
                disabled={!canEdit}
              />
            </div>
          </FieldRow>
          <FieldRow label="Name" htmlFor={`type-${type.key}-name`}>
            <TextField
              id={`type-${type.key}-name`}
              name={`type-${type.key}-name`}
              required
              maxLength={200}
              value={name}
              disabled={!canEdit}
              onChange={(event) => setName(event.target.value)}
            />
          </FieldRow>
          <FieldRow label="Plural" htmlFor={`type-${type.key}-plural`}>
            <TextField
              id={`type-${type.key}-plural`}
              name={`type-${type.key}-plural`}
              required
              maxLength={200}
              value={plural}
              disabled={!canEdit}
              onChange={(event) => setPlural(event.target.value)}
            />
          </FieldRow>
          <FieldRow label="Description" htmlFor={`type-${type.key}-description`}>
            <TextAreaField
              id={`type-${type.key}-description`}
              name={`type-${type.key}-description`}
              rows={2}
              maxLength={500}
              value={description}
              disabled={!canEdit}
              onChange={(event) => setDescription(event.target.value)}
            />
          </FieldRow>
        </Group>

        <Group
          id="type-schedule"
          className="scroll-mt-[calc(var(--shell-header-h)+1rem)]"
          title="Scheduling"
          hint="Values live on each record. Complete writes the last completion and advances a recurring due date."
        >
          <GroupControl>
            <label className="flex min-h-10 cursor-pointer items-center gap-2 pointer-coarse:min-h-11">
              <input
                id={`type-${type.key}-schedule`}
                type="checkbox"
                checked={schedule}
                disabled={!canEdit}
                onChange={(event) => setSchedule(event.target.checked)}
              />
              <span className="text-[14px]">Due dates, repeats and Complete</span>
            </label>
          </GroupControl>
        </Group>

        {schedule ? (
          <Group
            title="Scheduling words"
            hint={
              <>
                Display names only. The file keys stay{" "}
                <span className="font-mono">due_date</span>,{" "}
                <span className="font-mono">recurrence</span> and{" "}
                <span className="font-mono">last_completed_at</span>.
              </>
            }
          >
            <GroupControl>
              <div className="grid gap-[var(--space-3)] sm:grid-cols-2">
                <TextField
                  label="Complete button"
                  name={`type-${type.key}-complete-label`}
                  maxLength={80}
                  placeholder="Complete"
                  value={labels.complete ?? ""}
                  disabled={!canEdit}
                  onChange={(event) =>
                    setLabels((current) => ({ ...current, complete: event.target.value }))
                  }
                />
                <TextField
                  label="Due label"
                  name={`type-${type.key}-due-label`}
                  maxLength={80}
                  placeholder="Due"
                  value={labels.due ?? ""}
                  disabled={!canEdit}
                  onChange={(event) =>
                    setLabels((current) => ({ ...current, due: event.target.value }))
                  }
                />
                <TextField
                  label="Repeats label"
                  name={`type-${type.key}-recurrence-label`}
                  maxLength={80}
                  placeholder="Repeats"
                  value={labels.recurrence ?? ""}
                  disabled={!canEdit}
                  onChange={(event) =>
                    setLabels((current) => ({ ...current, recurrence: event.target.value }))
                  }
                />
                <TextField
                  label="Last completed label"
                  name={`type-${type.key}-last-completed-label`}
                  maxLength={80}
                  placeholder="Last completed"
                  value={labels.last_completed ?? ""}
                  disabled={!canEdit}
                  onChange={(event) =>
                    setLabels((current) => ({
                      ...current,
                      last_completed: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="mt-[var(--space-4)]">
                <div className="flex items-baseline justify-between gap-[var(--space-3)]">
                  <h4 className="label">Generated</h4>
                  <span className="label tnum">{implicit.length}</span>
                </div>
                <ul className="mt-1">
                  {implicit.map((property) => (
                    <li
                      key={property.key}
                      className="flex flex-wrap items-baseline justify-between gap-2 border-b rule py-2"
                    >
                      <span className="flex min-w-0 items-baseline gap-2">
                        <span className="truncate text-[15px]">{property.name}</span>
                        <span className="font-mono text-[11px] text-faint">
                          {property.key}
                        </span>
                      </span>
                      <span className="flex flex-wrap items-baseline gap-2">
                        <span className="label">generated · read only</span>
                        <FormatChip>{formatLabel(property.format)}</FormatChip>
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 max-w-[52ch] text-[12px] leading-[1.5] text-muted">
                  Add Repeats to a view's columns on the{" "}
                  <Link
                    to={`/s/${spaceId}/t/${type.key}`}
                    className="text-ink underline decoration-line-strong hover:decoration-accent pointer-coarse:py-3.5"
                  >
                    type page
                  </Link>{" "}
                  to edit the cadence inline.
                </p>
              </div>
            </GroupControl>
          </Group>
        ) : null}
      </div>

      {conflict ? (
        <div
          role="alert"
          className="mt-4 max-w-[62ch] border-l border-warning pl-3 text-[13px] text-warning"
        >
          <p>
            {conflict.count} record{conflict.count === 1 ? " still holds" : "s still hold"}{" "}
            schedule values. Clear them before turning scheduling off.
          </p>
          {conflict.records.length > 0 ? (
            <ul className="mt-1 grid gap-0.5">
              {conflict.records.slice(0, 5).map((record) => (
                <li key={record.id}>
                  {record.trashed ? (
                    <span className="text-muted">
                      {record.title} <span className="text-faint">(in trash)</span>
                    </span>
                  ) : (
                    <Link
                      to={`/s/${spaceId}/o/${record.id}`}
                      className="text-ink underline decoration-line-strong hover:decoration-accent pointer-coarse:py-3.5"
                    >
                      {record.title}
                    </Link>
                  )}
                </li>
              ))}
              {conflict.records.length > 5 ? (
                <li className="text-faint">
                  and {conflict.records.length - 5} more
                </li>
              ) : null}
            </ul>
          ) : null}
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
            {liveConflictRecords.length > 0 ? (
              <Link
                to={`/s/${spaceId}/t/${type.key}?filter=${encodeURIComponent(
                  filterParam(scheduleKeyFilter),
                )}`}
                className="text-ink underline decoration-line-strong hover:decoration-accent pointer-coarse:py-3.5"
              >
                Show live records with schedule values
              </Link>
            ) : null}
            <Link
              to={`/s/${spaceId}/trash`}
              className="text-ink underline decoration-line-strong hover:decoration-accent pointer-coarse:py-3.5"
            >
              Open trash
            </Link>
          </div>
        </div>
      ) : null}

      <div className="mt-8">
        <SectionRule level={3} title="Properties" count={type.properties.length} />
        {type.properties.length === 0 ? (
          <EmptyState sentence="This type has no properties yet. Manage them to add one." />
        ) : (
          <ul>
            {type.properties.map((member) => {
              const property = propertyOf(member.key);
              const rules = [
                member.required ? "required" : null,
                member.default === undefined || member.default === null
                  ? null
                  : `default ${valueLabel(property?.format ?? "text", member.default, property)}`,
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <li
                  key={member.key}
                  className="flex flex-wrap items-baseline justify-between gap-2 border-b rule py-2"
                >
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="truncate text-[15px] font-medium text-accent">
                      {titleProperty(member.key)}
                    </span>
                    <span className="font-mono text-[11px] text-faint">
                      {member.key}
                    </span>
                    <span className="label">{rules || "no rules"}</span>
                  </span>
                  <FormatChip className="border-accent/40 bg-accent-wash text-accent-on-wash">
                    {kindOf(member.key)
                      ? `${kindOf(member.key)} · ${formatOf(member.key)}`
                      : formatOf(member.key)}
                  </FormatChip>
                </li>
              );
            })}
          </ul>
        )}

        <ThumbRow className="mt-3 flex-wrap items-center gap-3">
          {dirty ? (
            <span className="text-[12px] text-faint">Save the type first.</span>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            className="min-h-9 px-3 text-[13px]"
            disabled={dirty}
            title={dirty ? "Save the type before changing its properties." : undefined}
            onClick={() => setManageOpen(true)}
          >
            <Plus aria-hidden size={15} />
            Manage properties
          </Button>
        </ThumbRow>

        <p className="mt-2 max-w-[62ch] text-[13px] text-muted">
          Required, the starting value and the order are edited in the same property sheet.
          The definition itself lives in the space library. Columns, grouping and calendar
          layout are per view on the{" "}
          <Link
            to={`/s/${spaceId}/t/${type.key}`}
            className="text-ink underline decoration-line-strong hover:decoration-accent pointer-coarse:py-3.5"
          >
            type page
          </Link>
          .
        </p>
      </div>

      {canEdit ? (
        dirty ? (
          <StickyActionBar>
            {update.error && !conflict ? (
              <div className="basis-full">
                <FormError message={readError(update.error)} />
              </div>
            ) : null}
            <div className="flex-1" aria-hidden />
            <span className="label flex items-center gap-1.5 text-accent">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
              Unsaved changes
            </span>
            <Button
              type="button"
              className="min-h-9 px-3 text-[13px] pointer-coarse:min-h-11"
              disabled={invalid || update.isPending}
              onClick={() => void saveDraft()}
            >
              {update.isPending ? "Saving…" : "Save type"}
            </Button>
          </StickyActionBar>
        ) : null
      ) : (
        <p className="mt-5 text-[13px] text-muted">
          Viewers can read the schema but not change it.
        </p>
      )}

      {canEdit ? (
        <section
          aria-labelledby={`type-${type.key}-danger`}
          className="mt-10 border-t border-danger/60 pt-4"
        >
          <SectionRule
            id={`type-${type.key}-danger`}
            level={3}
            tone="danger"
            title="Delete type"
          />
          <p className="mt-3 max-w-[62ch] text-[13px] text-muted">
            Deletes <span className="font-mono">types/{type.key}.yml</span>.
            {recordCount > 0 ? (
              <>
                {" "}
                Its {recordCount} live {recordCount === 1 ? "record moves" : "records move"} to
                Trash, not purge, so they can be restored.
              </>
            ) : (
              " It has no live records."
            )}{" "}
            This cannot be undone.
          </p>
          <div className="mt-3 grid max-w-[34rem] gap-3">
            <TextField
              label={
                <>
                  Type <span className="normal-case">{type.key}</span> to confirm
                </>
              }
              name={`type-${type.key}-delete-confirm`}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={confirmKey}
              disabled={remove.isPending}
              onChange={(event) => setConfirmKey(event.target.value)}
            />
            {recordCount > 0 ? (
              <label className="flex min-h-10 items-center gap-2 text-[14px] pointer-coarse:min-h-11">
                <input
                  type="checkbox"
                  checked={moveRecords}
                  disabled={remove.isPending}
                  onChange={(event) => setMoveRecords(event.target.checked)}
                />
                Move these {recordCount} {recordCount === 1 ? "record" : "records"} to trash
              </label>
            ) : null}
            <FormError message={remove.error ? readError(remove.error) : null} />
            <ThumbRow className="flex-wrap items-center gap-3">
              <Button
                variant="destructive"
                className="w-fit"
                disabled={!deleteReady}
                onClick={async () => {
                  try {
                    await remove.mutateAsync(recordCount > 0);
                    toast.showToast(
                      recordCount > 0
                        ? `Deleted “${type.name}”; ${recordCount} ${recordCount === 1 ? "record was" : "records were"} moved to Trash.`
                        : `Deleted “${type.name}”.`,
                    );
                    onDeleted();
                  } catch {
                    // The error state below names the server's refusal.
                  }
                }}
              >
                {remove.isPending ? "Deleting…" : "Delete this type"}
              </Button>
            </ThumbRow>
          </div>
        </section>
      ) : null}

      {manageOpen ? (
        <ManageProperties
          spaceId={spaceId}
          type={type}
          library={properties}
          canEdit={canEdit}
          onClose={() => setManageOpen(false)}
        />
      ) : null}

      {guard}
    </>
  );

  // A page anchors its deep links on the wrapper it already paints; the form
  // only names itself for the surface that owns the rule above it.
  return headingId ? (
    <section aria-labelledby={headingId} className="settle">
      {content}
    </section>
  ) : (
    content
  );
}

interface TypeEditorProps {
  spaceId: string;
  type: TypeDef;
  properties: PropertyDef[];
  recordCount: number;
  canEdit: boolean;
}

/** The schema page's inline editor: the shared form under its file rule. */
export function TypeEditor({
  spaceId,
  type,
  properties,
  recordCount,
  canEdit,
}: TypeEditorProps) {
  const navigate = useNavigate();
  return (
    <TypeEditorForm
      spaceId={spaceId}
      type={type}
      properties={properties}
      recordCount={recordCount}
      canEdit={canEdit}
      headingId="type-editor-heading"
      onDeleted={() => navigate(`/s/${spaceId}/schema`, { replace: true })}
    />
  );
}

interface TypeEditorSheetProps {
  spaceId: string;
  type: TypeDef;
  /** The whole space library; the form resolves members and generated keys. */
  properties: PropertyDef[];
  canEdit: boolean;
  onClose: () => void;
}

/** The same form inside the shared sheet, for the type page's Edit action. */
export function TypeEditorSheet({
  spaceId,
  type,
  properties,
  canEdit,
  onClose,
}: TypeEditorSheetProps) {
  const navigate = useNavigate();
  const types = useTypes(spaceId);
  const handedness = useThumbHandedness();
  // Deleting moves live records to Trash, so the count must be the server's.
  const recordCount =
    types.data?.find((summary) => summary.key === type.key)?.object_count ?? 0;
  /** The type identity: accent name and the file its definition lives in. */
  const identity = (
    <div className="min-w-0 flex-1">
      <SheetTitle className="truncate text-accent">{type.name}</SheetTitle>
      <p className="mt-0.5 truncate font-mono text-[11px] text-faint">
        types/{type.key}.yml
      </p>
    </div>
  );
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 scrim" />
        <SheetViewport>
          <SheetPopup className="sm:w-[38rem]">
            <SheetHeader
              className={cn(
                "gap-[var(--space-3)]",
                handedness === "left" ? "justify-start" : "justify-between",
              )}
            >
              {handedness === "left" ? (
                <>
                  <SheetCloseButton label="Close type editor" />
                  {identity}
                </>
              ) : (
                <>
                  {identity}
                  <SheetCloseButton label="Close type editor" />
                </>
              )}
            </SheetHeader>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-[var(--space-4)] py-[var(--space-3)] pb-[max(1rem,env(safe-area-inset-bottom))]">
              <TypeEditorForm
                spaceId={spaceId}
                type={type}
                properties={properties}
                recordCount={recordCount}
                canEdit={canEdit}
                onDeleted={() => {
                  onClose();
                  navigate(`/s/${spaceId}/schema`, { replace: true });
                }}
              />
            </div>
          </SheetPopup>
        </SheetViewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
