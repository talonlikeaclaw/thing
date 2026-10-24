import { ChevronDown, ChevronUp, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";

import { ApiError } from "@/api/client";
import { useDeleteType, useUpdateType } from "@/api/queries";
import type {
  Filter,
  PropertyDef,
  ScheduleLabels,
  TypeDef,
  TypeProperty,
} from "@/api/types";
import { IconPicker } from "@/components/icon-picker";
import { SmallButton } from "@/components/schema/small-button";
import {
  Button,
  FormError,
  SelectField,
  StickyActionBar,
  TextAreaField,
  TextField,
} from "@/components/ui/controls";
import { useToast } from "@/components/ui/toast";
import { readError } from "@/lib/display";
import { useDirtyGuard } from "@/lib/use-dirty-guard";
import { filterParam } from "@/lib/filter";
import {
  isScheduleKey,
  labeledScheduleProperties,
  SCHEDULE_PROPERTY_DEFS,
} from "@/lib/schedule";
import {
  addProperty,
  effectiveProperties,
  formatLabel,
  moveProperty,
  removeProperty,
  sameJson,
} from "@/lib/schema";

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

interface TypeEditorProps {
  spaceId: string;
  type: TypeDef;
  properties: PropertyDef[];
  recordCount: number;
  canEdit: boolean;
}

export function TypeEditor({
  spaceId,
  type,
  properties,
  recordCount,
  canEdit,
}: TypeEditorProps) {
  const update = useUpdateType(spaceId, type.key);
  const remove = useDeleteType(spaceId, type.key);
  const navigate = useNavigate();
  const toast = useToast();
  const [name, setName] = useState(type.name);
  const [plural, setPlural] = useState(type.name_plural);
  const [icon, setIcon] = useState(type.icon ?? "");
  const [description, setDescription] = useState(type.description);
  const [schedule, setSchedule] = useState(type.schedule);
  const [labels, setLabels] = useState<ScheduleLabels>(type.schedule_labels ?? {});
  const [members, setMembers] = useState<TypeProperty[]>(type.properties);
  const [pendingKey, setPendingKey] = useState("");
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
      setMembers(update.data.properties);
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
  const available = library.filter(
    (property) =>
      !isScheduleKey(property.key) &&
      !members.some((member) => member.key === property.key),
  );
  const addKey = available.some((property) => property.key === pendingKey)
    ? pendingKey
    : (available[0]?.key ?? "");
  const payload = {
    name: name.trim(),
    name_plural: plural.trim(),
    icon: icon.trim() ? icon.trim() : null,
    description,
    schedule,
    schedule_labels: schedule ? labels : {},
    properties: members,
  };
  const initial = {
    name: type.name,
    name_plural: type.name_plural,
    icon: type.icon ?? null,
    description: type.description,
    schedule: type.schedule,
    schedule_labels: type.schedule_labels ?? {},
    properties: type.properties,
  };
  const dirty = !sameJson(payload, initial);
  const invalid = !payload.name || !payload.name_plural;

  function onAdd() {
    if (!addKey) {
      return;
    }
    setMembers(addProperty(members, addKey));
    setPendingKey("");
  }

  function onRemove(key: string) {
    setMembers(removeProperty(members, key));
  }

  function saveDraft(): Promise<boolean> {
    if (!canEdit || invalid) {
      return Promise.resolve(false);
    }
    return new Promise((resolve) => {
      update.mutate(payload, {
        onSuccess: () => resolve(true),
        onError: () => resolve(false),
      });
    });
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
  const titleProperty = (key: string) =>
    library.find((property) => property.key === key)?.name ?? key;
  const formatOf = (key: string) => {
    const format = library.find((property) => property.key === key)?.format;
    return format ? formatLabel(format) : "unknown";
  };

  return (
    <section aria-labelledby="type-editor" className="settle">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b rule pb-2">
        <h2 id="type-editor" className="text-[17px] font-medium">
          {type.name}
        </h2>
        <span className="font-mono text-[11px] text-faint">types/{type.key}.yml</span>
      </div>

      <div className="mt-4 grid gap-4">
        <div className="grid gap-3 sm:grid-cols-[7rem_minmax(0,1fr)_minmax(0,1fr)]">
          <IconPicker
            label="Icon"
            id={`type-${type.key}-icon`}
            value={icon}
            onChange={setIcon}
            disabled={!canEdit}
          />
          <TextField
            label="Name"
            name={`type-${type.key}-name`}
            required
            maxLength={200}
            value={name}
            disabled={!canEdit}
            onChange={(event) => setName(event.target.value)}
          />
          <TextField
            label="Plural"
            name={`type-${type.key}-plural`}
            required
            maxLength={200}
            value={plural}
            disabled={!canEdit}
            onChange={(event) => setPlural(event.target.value)}
          />
        </div>
        <TextAreaField
          label="Description"
          name={`type-${type.key}-description`}
          rows={2}
          maxLength={500}
          value={description}
          disabled={!canEdit}
          onChange={(event) => setDescription(event.target.value)}
        />

        <div>
          <label className="flex min-h-10 items-center gap-2 text-[14px] pointer-coarse:min-h-11">
            <input
              type="checkbox"
              checked={schedule}
              disabled={!canEdit}
              onChange={(event) => setSchedule(event.target.checked)}
            />
            Schedule
          </label>
          <p className="mt-1 max-w-[62ch] text-[13px] text-muted">
            Records of this type carry a due date and repeat. Values live on each record;
            Complete writes the last completion and advances a recurring due date.
          </p>
        </div>
      </div>

      {schedule ? (
        <div className="mt-6">
          <div className="flex items-baseline justify-between border-b rule pb-2">
            <h3 className="text-[15px] font-medium">From scheduling</h3>
            <span className="label">generated</span>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
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
                setLabels((current) => ({ ...current, last_completed: event.target.value }))
              }
            />
          </div>
          <p className="mt-2 max-w-[62ch] text-[13px] text-muted">
            Display names only. The file keys stay <span className="font-mono">due_date</span>,{" "}
            <span className="font-mono">recurrence</span> and{" "}
            <span className="font-mono">last_completed_at</span>. Add Repeats to a view's
            columns on the type page to edit the cadence inline.
          </p>
          <ul className="mt-1">
            {implicit.map((property) => (
              <li
                key={property.key}
                className="flex flex-wrap items-baseline justify-between gap-2 border-b rule py-2"
              >
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="font-mono text-[11px] text-faint">{property.key}</span>
                  <span className="truncate text-[15px]">{property.name}</span>
                  <span className="label">{formatLabel(property.format)}</span>
                </span>
                <span className="label">read only</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

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
                      className="text-ink underline decoration-line-strong hover:decoration-accent"
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
                className="text-ink underline decoration-line-strong hover:decoration-accent"
              >
                Show live records with schedule values
              </Link>
            ) : null}
            <Link
              to={`/s/${spaceId}/trash`}
              className="text-ink underline decoration-line-strong hover:decoration-accent"
            >
              Open trash
            </Link>
          </div>
        </div>
      ) : null}

      <div className="mt-8">
        <div className="flex items-baseline justify-between border-b rule pb-2">
          <h3 className="text-[15px] font-medium">Properties</h3>
          <span className="label tnum">{members.length}</span>
        </div>
        {members.length === 0 ? (
          <p className="border-b rule py-3 text-[13px] text-muted">
            This type has no properties yet. Add one below.
          </p>
        ) : (
          <ul>
            {members.map((member, index) => (
              <li
                key={member.key}
                className="flex flex-wrap items-center justify-between gap-2 border-b rule py-2"
              >
                <div className="flex min-w-0 items-baseline gap-2">
                  <span className="font-mono text-[11px] text-faint">{member.key}</span>
                  <span className="truncate text-[15px]">{titleProperty(member.key)}</span>
                  <span className="label">{formatOf(member.key)}</span>
                </div>
                <div className="flex items-center gap-1">
                  <SmallButton
                    label={`Move ${member.key} up`}
                    disabled={!canEdit || index === 0}
                    onClick={() => setMembers(moveProperty(members, member.key, -1))}
                  >
                    <ChevronUp aria-hidden size={15} />
                  </SmallButton>
                  <SmallButton
                    label={`Move ${member.key} down`}
                    disabled={!canEdit || index === members.length - 1}
                    onClick={() => setMembers(moveProperty(members, member.key, 1))}
                  >
                    <ChevronDown aria-hidden size={15} />
                  </SmallButton>
                  <SmallButton
                    label={`Remove ${member.key}`}
                    disabled={!canEdit}
                    onClick={() => onRemove(member.key)}
                  >
                    <X aria-hidden size={15} />
                  </SmallButton>
                </div>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-2 max-w-[62ch] text-[13px] text-muted">
          Columns, grouping and calendar layout are per view on the{" "}
          <Link
            to={`/s/${spaceId}/t/${type.key}`}
            className="text-ink underline decoration-line-strong hover:decoration-accent"
          >
            type page
          </Link>
          .
        </p>

        {canEdit && available.length > 0 ? (
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div className="min-w-[12rem] flex-1">
              <SelectField
                label="Add a property"
                value={addKey}
                options={available.map((property) => ({
                  value: property.key,
                  label: `${property.name} (${formatLabel(property.format)})`,
                }))}
                onValueChange={setPendingKey}
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              className="min-h-9 px-3 text-[13px]"
              onClick={onAdd}
            >
              <Plus aria-hidden size={15} />
              Add property
            </Button>
          </div>
        ) : null}
        {library.length === 0 ? (
          <p className="mt-2 text-[13px] text-muted">
            No properties exist in this space yet. Create one below, then add it here.
          </p>
        ) : available.length === 0 ? (
          <p className="mt-2 text-[13px] text-muted">
            Every property in the space is already on this type.
          </p>
        ) : null}
      </div>

      {canEdit ? (
        <StickyActionBar>
          <Button
            type="button"
            className="min-h-9 px-3 text-[13px] pointer-coarse:min-h-11"
            disabled={!dirty || invalid || update.isPending}
            onClick={() => void saveDraft()}
          >
            {update.isPending ? "Saving…" : "Save type"}
          </Button>
          {dirty ? (
            <span className="label flex items-center gap-1.5 text-accent">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
              Unsaved changes
            </span>
          ) : update.isSuccess ? (
            <span className="label">Saved</span>
          ) : null}
          <div className="min-w-[12rem] flex-1">
            <FormError
              message={update.error && !conflict ? readError(update.error) : null}
            />
          </div>
        </StickyActionBar>
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
          <h3
            id={`type-${type.key}-danger`}
            className="border-b border-danger/40 pb-2 text-[15px] font-medium text-danger"
          >
            Delete type
          </h3>
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
            <Button
              variant="danger"
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
                  navigate(`/s/${spaceId}/schema`, { replace: true });
                } catch {
                  // The error state below names the server's refusal.
                }
              }}
            >
              {remove.isPending ? "Deleting…" : "Delete this type"}
            </Button>
          </div>
        </section>
      ) : null}

      {guard}
    </section>
  );
}
