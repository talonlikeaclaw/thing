import { Dialog } from "@base-ui/react/dialog";
import {
  Calendar,
  CalendarClock,
  Check,
  CheckSquare,
  CircleDot,
  File,
  Hash,
  Image,
  Link,
  Link2,
  ListChecks,
  Mail,
  Paperclip,
  Repeat,
  Type,
  X,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState } from "react";

import {
  useCreateProperty,
  useCreateType,
  useTypes,
  useUpdateType,
  useUpdateView,
} from "@/api/queries";
import type { PropertyDef, PropertyFormat, TypeDef, ViewDef } from "@/api/types";
import { useThumbHandedness } from "@/components/handedness";
import { IconPicker } from "@/components/icon-picker";
import { PropertyPicker } from "@/components/property-picker";
import { Button, FormError, SelectField, TextField } from "@/components/ui/controls";
import { FormatChip } from "@/components/ui/page";
import {
  SheetFooter,
  SheetPopup,
  SheetViewport,
} from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { readError } from "@/lib/display";
import { availableProperties, formatLabel } from "@/lib/schema";
import { withColumn } from "@/lib/views";

type Stage = "type" | "property" | "member" | "view";
type Mode = "existing" | "new";

/** The sentinel a target-type select uses for "create one in this flow". */
const NEW_TARGET = "__new_type";

const STAGE_STORY: Record<Stage, string> = {
  type: "Could not create the type.",
  property: "Could not create the property.",
  member: "Could not add the property to this type.",
  view: "Could not add the column to this view.",
};

interface FormatCard {
  format: PropertyFormat;
  description: string;
  Icon: LucideIcon;
}

/** One card per format: the glyph, the label and what the column is for. */
const FORMAT_CARDS: FormatCard[] = [
  { format: "text", description: "Names, notes and short written values.", Icon: Type },
  { format: "number", description: "Amounts and measurements, sorted as numbers.", Icon: Hash },
  { format: "checkbox", description: "A single yes or no.", Icon: CheckSquare },
  { format: "date", description: "One calendar day.", Icon: Calendar },
  { format: "datetime", description: "A day and a time.", Icon: CalendarClock },
  { format: "select", description: "One option from a coloured list.", Icon: CircleDot },
  { format: "multi_select", description: "Several options from one list.", Icon: ListChecks },
  { format: "url", description: "A web address that opens.", Icon: Link2 },
  { format: "email", description: "An address that opens mail.", Icon: Mail },
  { format: "relation", description: "Records of another type.", Icon: Link },
  { format: "recurrence", description: "A repeat cadence.", Icon: Repeat },
  { format: "file", description: "One attachment of any kind.", Icon: File },
  { format: "image", description: "One picture with a preview.", Icon: Image },
  { format: "attachments", description: "An ordered set of files and pictures.", Icon: Paperclip },
];

interface AddPropertyProps {
  spaceId: string;
  type: TypeDef;
  /** The whole space library; the sheet offers what the type does not carry. */
  library: PropertyDef[];
  /** The table view a new column joins; a record page omits it. */
  view?: ViewDef;
  /** Called once every stage succeeded, so an inline editor can adopt the member. */
  onAdded?: (property: PropertyDef) => void;
  onClose: () => void;
}

/**
 * Adds one property to a type from the table or from a record: an existing
 * library property or a new one with a name and a format. A relation can point
 * at an existing type or create one inside this flow.
 *
 * The write is ordinary calls in order — the target type, the property, the
 * type member, the view column — resumed from wherever it stopped. A retry
 * reuses every stage that already succeeded, so it never mints a second type,
 * property or member.
 */
export function AddPropertyDialog({
  spaceId,
  type,
  library,
  view,
  onAdded,
  onClose,
}: AddPropertyProps) {
  const [available] = useState(() => availableProperties(type, library));
  const [mode, setMode] = useState<Mode>(available.length > 0 ? "existing" : "new");
  const [existingKey, setExistingKey] = useState(available[0]?.key ?? "");
  const [name, setName] = useState("");
  const [format, setFormat] = useState<PropertyFormat>("text");
  const [targetType, setTargetType] = useState(NEW_TARGET);
  const [targetName, setTargetName] = useState("");
  const [targetPlural, setTargetPlural] = useState("");
  const [targetIcon, setTargetIcon] = useState("");
  const [multi, setMulti] = useState(true);
  const [createdType, setCreatedType] = useState<TypeDef | null>(null);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [memberAdded, setMemberAdded] = useState(false);
  const [columnAdded, setColumnAdded] = useState(false);
  const [error, setError] = useState<{ stage: Stage; message: string } | null>(null);
  const [running, setRunning] = useState<Stage | null>(null);
  const [locked, setLocked] = useState(false);
  const [pending, setPending] = useState(false);

  const types = useTypes(spaceId);
  const createType = useCreateType(spaceId);
  const createProperty = useCreateProperty(spaceId);
  const updateType = useUpdateType(spaceId, type.key);
  const updateView = useUpdateView(spaceId, type.key, view?.key ?? "");
  const toast = useToast();

  const existing = available.find((property) => property.key === existingKey);
  const label = mode === "existing" ? (existing?.name ?? "") : name.trim();
  const relation = mode === "new" && format === "relation";
  const createsType = relation && targetType === NEW_TARGET;
  const targetTypes = useMemo(
    () => types.data ?? [],
    [types.data],
  );
  const chosenTarget = createsType
    ? (createdType?.key ?? null)
    : targetType === NEW_TARGET
      ? null
      : targetType;
  const ready =
    mode === "existing"
      ? existing !== undefined
      : label !== "" && (!relation || chosenTarget !== null || targetName.trim() !== "");
  const frozen = locked || pending;
  const actionLabel = pending
    ? "Adding…"
    : error
      ? "Retry"
      : view
        ? "Add to table"
        : "Add property";

  const stages: Stage[] = [
    ...(createsType ? (["type"] as Stage[]) : []),
    ...(mode === "new" ? (["property"] as Stage[]) : []),
    "member",
    ...(view ? (["view"] as Stage[]) : []),
  ];

  function done(stage: Stage): boolean {
    if (stage === "type") {
      return createdType !== null;
    }
    if (stage === "property") {
      return createdKey !== null;
    }
    if (stage === "member") {
      return memberAdded;
    }
    return columnAdded;
  }

  function stageLabel(stage: Stage): string {
    if (stage === "type") {
      return `Create the ${targetName.trim() || "new"} type`;
    }
    if (stage === "property") {
      return `Create the ${label || "new"} property`;
    }
    if (stage === "member") {
      return `Add ${label || "it"} to ${type.name}`;
    }
    return "Add the column to this view";
  }

  function runningLabel(stage: Stage): string {
    return `${stageLabel(stage)}…`;
  }

  async function submit() {
    if (pending || !ready) {
      return;
    }
    setLocked(true);
    setPending(true);
    setError(null);
    try {
      let targetKey = chosenTarget;
      let added: PropertyDef | undefined = existing;
      if (createsType && createdType === null) {
        setRunning("type");
        try {
          const created = await createType.mutateAsync({
            name: targetName.trim(),
            ...(targetPlural.trim() === "" ? {} : { name_plural: targetPlural.trim() }),
            ...(targetIcon.trim() === "" ? {} : { icon: targetIcon.trim() }),
          });
          setCreatedType(created);
          targetKey = created.key;
        } catch (failure) {
          setError({ stage: "type", message: readError(failure) });
          return;
        }
      }

      let key = createdKey ?? (mode === "existing" ? existingKey : null);
      if (mode === "new" && key === null) {
        setRunning("property");
        try {
          const property = await createProperty.mutateAsync({
            name: label,
            format,
            ...(format === "relation" && targetKey !== null
              ? { target_type: targetKey, multi }
              : {}),
          });
          key = property.key;
          added = property;
          setCreatedKey(key);
        } catch (failure) {
          setError({ stage: "property", message: readError(failure) });
          return;
        }
      }
      if (key === null) {
        return;
      }

      if (!memberAdded) {
        setRunning("member");
        const members = type.properties.some((member) => member.key === key)
          ? type.properties
          : [...type.properties, { key, required: false, featured: true }];
        try {
          await updateType.mutateAsync({ properties: members });
          setMemberAdded(true);
        } catch (failure) {
          setError({ stage: "member", message: readError(failure) });
          return;
        }
      }

      if (view && !columnAdded) {
        setRunning("view");
        const next = withColumn(view, key, true);
        try {
          await updateView.mutateAsync({
            columns: next.columns,
            widths: next.widths,
          });
          setColumnAdded(true);
        } catch (failure) {
          setError({ stage: "view", message: readError(failure) });
          return;
        }
      }

      toast.showToast(`Added “${label}”.`);
      if (added) {
        onAdded?.(added);
      }
      onClose();
    } finally {
      setPending(false);
      setRunning(null);
    }
  }

  const handedness = useThumbHandedness();
  const title = (
    <div>
      <Dialog.Title className="text-[17px] font-medium">Add property</Dialog.Title>
      <Dialog.Description className="mt-1 text-[13px] text-muted">
        {view
          ? "It joins this type, this view and the record panel. Other views keep their columns."
          : "It joins this type and the record panel. The table column is added when you open a table."}
      </Dialog.Description>
    </div>
  );
  const close = (
    <Dialog.Close
      key="close"
      aria-label="Close add property"
      className={cn(
        "inline-flex min-h-8 min-w-8 shrink-0 items-center justify-center rounded-full text-faint transition-colors hover:bg-raised hover:text-ink pointer-coarse:min-h-11 pointer-coarse:min-w-11",
        handedness === "left" ? "-ml-1" : "-mr-1",
      )}
    >
      <X aria-hidden size={15} />
    </Dialog.Close>
  );
  const leftover =
    error !== null && (createdType !== null || createdKey !== null || memberAdded);

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !pending) {
          onClose();
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 scrim" />
        <SheetViewport>
          <SheetPopup className="sm:w-[36rem]">
            <div
              className={cn(
                "flex items-baseline gap-4 border-b rule px-4 py-3",
                handedness === "left" ? "justify-start" : "justify-between",
              )}
            >
              {handedness === "left" ? (
                <>
                  {close}
                  {title}
                </>
              ) : (
                <>
                  {title}
                  {close}
                </>
              )}
            </div>

            <form
              aria-label="Add property"
              className="flex min-h-0 flex-1 flex-col"
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-4">
              <div role="tablist" aria-label="Property source" className="flex gap-1 border-b rule pb-2">
                <TabButton
                  selected={mode === "existing"}
                  disabled={frozen || available.length === 0}
                  onClick={() => setMode("existing")}
                >
                  Existing
                </TabButton>
                <TabButton
                  selected={mode === "new"}
                  disabled={frozen}
                  onClick={() => setMode("new")}
                >
                  New
                </TabButton>
              </div>

              {mode === "existing" ? (
                available.length > 0 ? (
                  <div className="mt-3">
                    <p className="mb-2 text-[13px] text-muted">
                      Only properties this type does not carry yet.
                    </p>
                    <PropertyPicker
                      variant="list"
                      autoFocus
                      title="Choose a library property"
                      properties={available}
                      value={existingKey === "" ? null : existingKey}
                      onChange={setExistingKey}
                      className={frozen ? "pointer-events-none opacity-60" : undefined}
                    />
                  </div>
                ) : (
                  <p className="mt-4 text-[13px] text-muted">
                    Every library property is already on this type. Create one instead.
                  </p>
                )
              ) : (
                <div className="mt-3 grid gap-4">
                  <TextField
                    label="Name"
                    name="add-property-name"
                    required
                    maxLength={80}
                    autoFocus
                    disabled={frozen}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Artist"
                  />

                  <fieldset>
                    <legend className="label mb-2">Format</legend>
                    <div
                      role="radiogroup"
                      aria-label="Format"
                      className="grid grid-cols-2 gap-1.5 sm:grid-cols-3"
                    >
                      {FORMAT_CARDS.map(({ format: value, description, Icon }) => {
                        const selected = format === value;
                        return (
                          <button
                            key={value}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            aria-label={formatLabel(value)}
                            disabled={frozen}
                            onClick={() => setFormat(value)}
                            className={cn(
                              "grid min-h-16 grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2 rounded-[12px] border px-2.5 py-2 text-left transition-colors pointer-coarse:min-h-20",
                              selected
                                ? "border-accent/60 bg-accent-wash text-accent-on-wash"
                                : "border-line-interactive/70 bg-raised/30 text-ink hover:border-line-strong",
                            )}
                          >
                            <Icon aria-hidden size={15} className="mt-0.5 text-muted" />
                            <span className="min-w-0">
                              <span className="block text-[13px] font-medium">
                                {formatLabel(value)}
                              </span>
                              <span className="block text-[11px] leading-4 text-muted">
                                {description}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </fieldset>

                  {relation ? (
                    <div className="grid gap-3">
                      <SelectField
                        label="Target type"
                        id="add-property-target"
                        value={targetType}
                        disabled={frozen || createdType !== null}
                        options={[
                          ...targetTypes.map((target) => ({
                            value: target.key,
                            label: target.name,
                          })),
                          { value: NEW_TARGET, label: "New type…" },
                        ]}
                        onValueChange={setTargetType}
                        hint="The type whose records this column links to."
                      />

                      {createsType ? (
                        <div className="grid gap-3 border-l border-accent/40 pl-3">
                          <TextField
                            label="Type name"
                            name="add-property-target-name"
                            required
                            maxLength={200}
                            disabled={frozen || createdType !== null}
                            value={targetName}
                            onChange={(event) => setTargetName(event.target.value)}
                            placeholder="Artist"
                          />
                          <TextField
                            label="Plural"
                            name="add-property-target-plural"
                            maxLength={200}
                            disabled={frozen || createdType !== null}
                            value={targetPlural}
                            onChange={(event) => setTargetPlural(event.target.value)}
                            placeholder={
                              targetName.trim() === "" ? "Artists" : `${targetName.trim()}s`
                            }
                            hint="Left empty, the server appends s."
                          />
                          <div>
                            <span className="label mb-1.5 block">Icon</span>
                            <IconPicker
                              variant="glyph"
                              label="Type icon"
                              value={targetIcon}
                              onChange={setTargetIcon}
                              disabled={frozen || createdType !== null}
                            />
                          </div>
                        </div>
                      ) : null}

                      <label className="flex min-h-10 items-center gap-2 text-[13px] pointer-coarse:min-h-11">
                        <input
                          type="checkbox"
                          checked={multi}
                          disabled={frozen}
                          onChange={(event) => setMulti(event.target.checked)}
                        />
                        Several targets
                      </label>
                    </div>
                  ) : null}
                </div>
              )}

              {stages.length > 1 || error ? (
                <ol aria-label="Progress" className="mt-4 grid gap-1 border-t rule pt-3">
                  {stages.map((stage) => {
                    const failed = error?.stage === stage;
                    const complete = done(stage);
                    const active = pending && running === stage;
                    return (
                      <li
                        key={stage}
                        data-status={
                          failed ? "error" : complete ? "done" : active ? "running" : "pending"
                        }
                        className={cn(
                          "flex items-baseline gap-2 text-[12px]",
                          failed
                            ? "text-danger"
                            : complete
                              ? "text-muted"
                              : "text-faint",
                        )}
                      >
                        <span aria-hidden className="flex h-4 w-4 shrink-0 justify-center">
                          {complete ? (
                            <Check size={13} className="text-accent" />
                          ) : (
                            <span
                              className={cn(
                                "mt-1 h-1.5 w-1.5 rounded-full",
                                failed ? "bg-danger" : active ? "bg-accent" : "bg-line-strong",
                              )}
                            />
                          )}
                        </span>
                        <span>
                          {active
                            ? runningLabel(stage)
                            : stageLabel(stage)}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              ) : null}

              {error ? (
                <div className="mt-4 grid gap-2">
                  <p className="label text-danger">{STAGE_STORY[error.stage]}</p>
                  <FormError message={error.message} />
                  {leftover ? (
                    <p className="text-[13px] text-muted">
                      What already succeeded is kept; Retry finishes without creating a second
                      type, property or member.
                    </p>
                  ) : null}
                </div>
              ) : null}

              </div>

              <SheetFooter className="flex flex-wrap items-center gap-2">
                <Button type="submit" disabled={pending || !ready}>
                  {actionLabel}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={pending}
                  onClick={onClose}
                >
                  Cancel
                </Button>
                {existing ? (
                  <span className="ml-auto flex items-center gap-2">
                    <FormatChip>{formatLabel(existing.format)}</FormatChip>
                  </span>
                ) : null}
              </SheetFooter>
            </form>
          </SheetPopup>
        </SheetViewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function TabButton({
  selected,
  disabled,
  onClick,
  children,
}: {
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "min-h-8 rounded-full px-3 text-[13px] transition-colors pointer-coarse:min-h-11",
        selected
          ? "bg-accent-wash text-accent-on-wash"
          : "text-muted hover:bg-raised hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}
