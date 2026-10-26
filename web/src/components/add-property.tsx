import { Dialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import { useState } from "react";

import { useCreateProperty, useUpdateType, useUpdateView } from "@/api/queries";
import { useHandedness } from "@/components/handedness";
import type { PropertyDef, PropertyFormat, TypeDef, ViewDef } from "@/api/types";
import { Button, FormError, SelectField, TextField } from "@/components/ui/controls";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { readError } from "@/lib/display";
import { availableProperties, formatLabel, PROPERTY_FORMATS } from "@/lib/schema";
import { withColumn } from "@/lib/views";

type Stage = "property" | "type" | "view";
type Mode = "existing" | "new";

const STAGE_STORY: Record<Stage, string> = {
  property: "Could not create the property.",
  type: "Could not add the property to the type.",
  view: "Could not add the column to this view.",
};

interface AddPropertyProps {
  spaceId: string;
  type: TypeDef;
  /** The whole space library; the dialog offers what the type does not carry. */
  library: PropertyDef[];
  view: ViewDef;
  onClose: () => void;
}

/**
 * Adds one property to the table: an existing library property or a new one
 * with a name and format. The write is three ordinary calls — create the
 * property, extend the type, extend this view — resumed from wherever it
 * stopped, so a retry never mints a second property or a duplicate member.
 */
export function AddPropertyDialog({
  spaceId,
  type,
  library,
  view,
  onClose,
}: AddPropertyProps) {
  const [available] = useState(() => availableProperties(type, library));
  const [mode, setMode] = useState<Mode>(available.length > 0 ? "existing" : "new");
  const [existingKey, setExistingKey] = useState(available[0]?.key ?? "");
  const [name, setName] = useState("");
  const [format, setFormat] = useState<PropertyFormat>("text");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [memberAdded, setMemberAdded] = useState(false);
  const [columnAdded, setColumnAdded] = useState(false);
  const [error, setError] = useState<{ stage: Stage; message: string } | null>(null);
  const [pending, setPending] = useState(false);

  const createProperty = useCreateProperty(spaceId);
  const updateType = useUpdateType(spaceId, type.key);
  const updateView = useUpdateView(spaceId, type.key, view.key);
  const toast = useToast();

  // A property that already exists in the library is never posted again, and
  // the form freezes so a retry cannot describe a different property.
  const locked = pending || createdKey !== null || memberAdded;
  const existing = available.find((property) => property.key === existingKey);
  const label = mode === "existing" ? (existing?.name ?? "") : name.trim();
  const ready = mode === "existing" ? existing !== undefined : label !== "";

  async function submit() {
    if (pending || !ready) {
      return;
    }
    setPending(true);
    setError(null);
    let key = createdKey ?? (mode === "existing" ? existingKey : null);

    try {
      if (key === null) {
        try {
          const property = await createProperty.mutateAsync({
            name: label,
            format,
          });
          key = property.key;
          setCreatedKey(key);
        } catch (failure) {
          setError({ stage: "property", message: readError(failure) });
          return;
        }
      }

      if (!memberAdded) {
        const members = type.properties.some((member) => member.key === key)
          ? type.properties
          : [...type.properties, { key, required: false, featured: true }];
        try {
          await updateType.mutateAsync({ properties: members });
          setMemberAdded(true);
        } catch (failure) {
          setError({ stage: "type", message: readError(failure) });
          return;
        }
      }

      if (!columnAdded) {
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
      onClose();
    } finally {
      setPending(false);
    }
  }

  const { handedness } = useHandedness();
  const title = (
    <div>
      <Dialog.Title className="text-[17px] font-medium">Add property</Dialog.Title>
      <Dialog.Description className="mt-1 text-[13px] text-muted">
        It joins this type, this view and the record panel. Other views keep their columns.
      </Dialog.Description>
    </div>
  );
  const close = (
    <Dialog.Close
      key="close"
      aria-label="Close add property"
      className={cn(
        "inline-flex min-h-8 min-w-8 shrink-0 items-center justify-center rounded-[3px] text-faint transition-colors hover:bg-raised hover:text-ink pointer-coarse:min-h-11 pointer-coarse:min-w-11",
        handedness === "left" ? "-ml-1" : "-mr-1",
      )}
    >
      <X aria-hidden size={15} />
    </Dialog.Close>
  );
  const actionLabel = pending ? "Adding…" : error ? "Retry" : "Add to table";
  const leftover = error !== null && error.stage !== "property" && createdKey !== null;

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
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-ground/85" />
        <Dialog.Viewport className="fixed inset-0 z-50 flex items-end justify-center sm:items-start sm:px-4 sm:pt-[12vh]">
          <Dialog.Popup className="flex max-h-[85dvh] w-full flex-col overflow-hidden rounded-t-sheet border border-line bg-surface sm:w-[32rem] sm:rounded-sheet">
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
              className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <fieldset className="grid gap-2">
                <legend className="label">Source</legend>
                <label className="flex min-h-8 items-center gap-2 text-[13px] pointer-coarse:min-h-11">
                  <input
                    type="radio"
                    name="add-property-mode"
                    value="existing"
                    checked={mode === "existing"}
                    disabled={locked || available.length === 0}
                    className="h-4 w-4 accent-[var(--color-accent)] pointer-coarse:h-5 pointer-coarse:w-5"
                    onChange={() => setMode("existing")}
                  />
                  Use a property already in this space
                </label>
                <label className="flex min-h-8 items-center gap-2 text-[13px] pointer-coarse:min-h-11">
                  <input
                    type="radio"
                    name="add-property-mode"
                    value="new"
                    checked={mode === "new"}
                    disabled={locked}
                    className="h-4 w-4 accent-[var(--color-accent)] pointer-coarse:h-5 pointer-coarse:w-5"
                    onChange={() => setMode("new")}
                  />
                  Create a new property
                </label>
              </fieldset>

              {mode === "existing" ? (
                available.length > 0 ? (
                  <div className="mt-4">
                    <SelectField
                      label="Library property"
                      id="add-property-existing"
                      value={existingKey}
                      disabled={locked}
                      options={available.map((property) => ({
                        value: property.key,
                        label: `${property.name} · ${formatLabel(property.format)}`,
                      }))}
                      onValueChange={setExistingKey}
                      hint="Only properties this type does not carry yet."
                    />
                  </div>
                ) : (
                  <p className="mt-4 text-[13px] text-muted">
                    Every library property is already on this type. Create one instead.
                  </p>
                )
              ) : (
                <div className="mt-4 grid gap-3">
                  <TextField
                    label="Name"
                    name="add-property-name"
                    required
                    maxLength={80}
                    autoFocus
                    disabled={locked}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Room"
                  />
                  <SelectField
                    label="Format"
                    id="add-property-format"
                    value={format}
                    disabled={locked}
                    options={PROPERTY_FORMATS}
                    onValueChange={(next) => setFormat(next as PropertyFormat)}
                    hint={
                      format === "relation"
                        ? "Any target type, one record each; change that in Schema."
                        : format === "select" || format === "multi_select"
                          ? "Options are added by typing into a cell, or in Schema."
                          : undefined
                    }
                  />
                </div>
              )}

              {error ? (
                <div className="mt-4 grid gap-2">
                  <p className="label text-danger">{STAGE_STORY[error.stage]}</p>
                  <FormError message={error.message} />
                  {leftover ? (
                    <p className="text-[13px] text-muted">
                      “{label}” is in the property library; Retry finishes adding it
                      without creating a second one.
                    </p>
                  ) : null}
                </div>
              ) : null}

              <div className="mt-5 flex flex-wrap items-center gap-2 border-t rule pt-3">
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
              </div>
            </form>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
