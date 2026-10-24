import { useEffect, useState } from "react";
import { Link } from "react-router";

import { ApiError } from "@/api/client";
import {
  useDeleteProperty,
  usePropertyUsage,
  useRenameProperty,
  useUpdateProperty,
} from "@/api/queries";
import type { PropertyDef, TypeSummary } from "@/api/types";
import { ThumbRow } from "@/components/handedness";
import { OptionEditor } from "@/components/schema/option-editor";
import { Button, FormError, StickyActionBar, TextField } from "@/components/ui/controls";
import { useToast } from "@/components/ui/toast";
import { readError } from "@/lib/display";
import { useDirtyGuard } from "@/lib/use-dirty-guard";
import {
  formatLabel,
  hasOptions,
  optionDrafts,
  optionInputs,
  type OptionDraft,
  sameJson,
} from "@/lib/schema";

interface PropertyEditorProps {
  spaceId: string;
  property: PropertyDef;
  types: TypeSummary[];
  canEdit: boolean;
  onRenamed: (key: string) => void;
}

export function PropertyEditor({
  spaceId,
  property,
  types,
  canEdit,
  onRenamed,
}: PropertyEditorProps) {
  const update = useUpdateProperty(spaceId, property.key);
  const remove = useDeleteProperty(spaceId, property.key);
  const rename = useRenameProperty(spaceId, property.key);
  const usage = usePropertyUsage(
    spaceId,
    property.key,
    types.map((type) => type.key),
  );
  const toast = useToast();
  const [name, setName] = useState(property.name);
  const [options, setOptions] = useState<OptionDraft[]>(() => optionDrafts(property.options));
  const [confirmKey, setConfirmKey] = useState("");
  const [renameKey, setRenameKey] = useState("");

  // A saved new option comes back with its minted key; adopting the response
  // keeps a later rename from re-deriving the key it already has.
  useEffect(() => {
    if (update.data) {
      setName(update.data.name);
      setOptions(optionDrafts(update.data.options));
    }
  }, [update.data]);

  const showsOptions = hasOptions(property.format);
  const payload = {
    name: name.trim(),
    ...(showsOptions ? { options: optionInputs(options) } : {}),
  };
  const initial = {
    name: property.name,
    ...(showsOptions ? { options: optionInputs(optionDrafts(property.options)) } : {}),
  };
  const dirty = !sameJson(payload, initial);
  const invalid =
    !payload.name || (showsOptions && options.some((option) => !option.name.trim()));

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

  const guard = useDirtyGuard(dirty, saveDraft);

  // The server counts trashed records; the client cannot see their values, so a
  // refused delete's details replace the read-only estimate.
  const conflictUsage =
    remove.error instanceof ApiError && remove.error.status === 409
      ? {
          types: Number(remove.error.details.types ?? 0) || 0,
          records: Number(remove.error.details.objects ?? 0) || 0,
        }
      : null;
  const usageTypes = conflictUsage ? conflictUsage.types : usage.types.length;
  const usageRecords = conflictUsage ? conflictUsage.records : usage.records;
  const inUse = usageTypes > 0 || usageRecords > 0;
  const blocked = usage.views.length > 0;
  const deleteReady =
    !usage.isPending &&
    !blocked &&
    (!inUse || confirmKey.trim().toLowerCase() === property.key.toLowerCase()) &&
    !remove.isPending;
  const nextKey = renameKey.trim();
  const renameReady =
    nextKey !== "" && nextKey !== property.key && !rename.isPending && !dirty;

  return (
    <section aria-labelledby="property-editor" className="settle">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b rule pb-2">
        <h2 id="property-editor" className="text-[17px] font-medium">
          {property.name}
        </h2>
        <span className="font-mono text-[11px] text-faint">
          properties/{property.key}.yml
        </span>
      </div>

      <div className="mt-4 grid gap-4">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
          <TextField
            label="Name"
            name={`property-${property.key}-name`}
            required
            maxLength={200}
            value={name}
            disabled={!canEdit}
            onChange={(event) => setName(event.target.value)}
          />
          <div className="grid content-start gap-1.5">
            <span className="label">Format</span>
            <p className="flex h-10 items-center font-mono text-[12px] text-muted">
              {formatLabel(property.format)}
            </p>
            <p className="text-[12px] text-faint">Fixed once values exist.</p>
          </div>
        </div>

        {property.format === "relation" ? (
          <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-[13px]">
            <dt className="label">Target</dt>
            <dd className="font-mono text-[12px] text-muted">
              {property.target_type ?? "any type"}
            </dd>
            <dt className="label">Holds</dt>
            <dd className="font-mono text-[12px] text-muted">
              {property.multi ? "several targets" : "one target"}
            </dd>
          </dl>
        ) : null}

        {showsOptions ? (
          <div>
            <div className="flex items-baseline justify-between border-b rule pb-1">
              <span className="label">Options</span>
              <span className="label tnum">{options.length}</span>
            </div>
            <div className="mt-2">
              <OptionEditor
                drafts={options}
                onChange={setOptions}
                canEdit={canEdit}
                idPrefix={property.key}
              />
            </div>
          </div>
        ) : null}
      </div>

      {canEdit ? (
        <StickyActionBar>
          <div className="min-w-[12rem] flex-1">
            <FormError message={update.error ? readError(update.error) : null} />
          </div>
          {dirty ? (
            <span className="label flex items-center gap-1.5 text-accent">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
              Unsaved changes
            </span>
          ) : update.isSuccess ? (
            <span className="label">Saved</span>
          ) : null}
          <Button
            type="button"
            className="min-h-9 px-3 text-[13px] pointer-coarse:min-h-11"
            disabled={!dirty || invalid || update.isPending}
            onClick={() => void saveDraft()}
          >
            {update.isPending ? "Saving…" : "Save property"}
          </Button>
        </StickyActionBar>
      ) : (
        <p className="mt-5 text-[13px] text-muted">
          Viewers can read the schema but not change it.
        </p>
      )}

      {canEdit ? (
        <section
          aria-labelledby={`property-${property.key}-key`}
          className="mt-10 border-t rule pt-4"
        >
          <h3
            id={`property-${property.key}-key`}
            className="border-b rule pb-2 text-[15px] font-medium"
          >
            Key
          </h3>
          <p className="mt-3 max-w-[62ch] text-[13px] text-muted">
            The current key is <span className="font-mono">{property.key}</span>. Renaming it
            rewrites every file that names it; keys appear in file paths and CSV headers.
          </p>
          <div className="mt-3 grid max-w-[34rem] gap-3">
            <TextField
              label="New key"
              name={`property-${property.key}-new-key`}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={renameKey}
              disabled={rename.isPending}
              onChange={(event) => setRenameKey(event.target.value)}
              hint={
                dirty
                  ? "Save the display name first; renaming reloads this editor."
                  : "Lowercase letters, digits and underscores, starting with a letter."
              }
            />
            <FormError message={rename.error ? readError(rename.error) : null} />
            <Button
              type="button"
              variant="ghost"
              className="w-fit min-h-9 px-3 text-[13px]"
              disabled={!renameReady}
              onClick={async () => {
                try {
                  const next = await rename.mutateAsync(nextKey);
                  onRenamed(next.key);
                  setRenameKey("");
                  toast.showToast(`Key renamed to ${next.key}.`);
                } catch {
                  // The mutation's error state names the refusal next to the key.
                }
              }}
            >
              {rename.isPending ? "Renaming…" : "Rename key"}
            </Button>
          </div>
        </section>
      ) : null}

      {canEdit ? (
        <section
          aria-labelledby={`property-${property.key}-danger`}
          className="mt-10 border-t border-danger/60 pt-4"
        >
          <h3
            id={`property-${property.key}-danger`}
            className="border-b border-danger/40 pb-2 text-[15px] font-medium text-danger"
          >
            Delete property
          </h3>
          <p className="mt-3 text-[13px] text-muted">
            Used by{" "}
            <span className="font-mono tnum">
              {usage.isPending && !conflictUsage
                ? "…"
                : `${usageTypes} ${usageTypes === 1 ? "type" : "types"} · ${usageRecords} ${
                    usageRecords === 1 ? "record" : "records"
                  }`}
            </span>
            .
          </p>
          {conflictUsage ? (
            <p className="mt-1 text-[13px] text-muted">
              The records in Trash still hold this key, so the server counted them too.
              Deleting removes the value there as well.
            </p>
          ) : null}
          {usage.error ? <FormError message={readError(usage.error)} /> : null}

          {blocked ? (
            <div className="mt-3 border-l border-warning pl-3">
              <p className="text-[13px] text-warning">
                A view uses this property for grouping or its calendar date. Clear that field in
                these views before deleting it.
              </p>
              <ul className="mt-1 grid gap-0.5 text-[13px]">
                {usage.views.map((view) => (
                  <li key={`${view.type}:${view.view}:${view.field}`}>
                    <Link
                      to={`/s/${spaceId}/t/${view.type}?view=${view.view}&settings=1`}
                      className="text-ink underline decoration-line-strong hover:decoration-accent"
                    >
                      {view.typeName} › {view.viewName}
                    </Link>{" "}
                    <span className="font-mono text-[11px] text-faint">
                      {view.field === "group_by" ? "group by" : "calendar date"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="mt-3 grid max-w-[34rem] gap-3">
              {!usage.isPending && inUse ? (
                <>
                  <p className="text-[13px] text-muted">
                    Deleting removes this value from every record and records the drop in each
                    record's history.
                  </p>
                  <TextField
                    label={
                      <>
                        Type <span className="normal-case">{property.key}</span> to confirm
                      </>
                    }
                    name={`property-${property.key}-delete-confirm`}
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={confirmKey}
                    disabled={remove.isPending}
                    onChange={(event) => setConfirmKey(event.target.value)}
                  />
                </>
              ) : null}
              {!usage.isPending && !inUse ? (
                <p className="text-[13px] text-muted">
                  No live type or record uses this property. Trashed records may still hold it.
                </p>
              ) : null}
              <FormError message={remove.error ? readError(remove.error) : null} />
              <ThumbRow className="flex-wrap items-center gap-3">
                <Button
                  variant="danger"
                  className="w-fit"
                  disabled={!deleteReady}
                  onClick={async () => {
                    try {
                      await remove.mutateAsync(inUse);
                      toast.showToast(`Deleted property “${property.name}”.`);
                    } catch {
                      // The error state renders the server's refusal in this section.
                    }
                  }}
                >
                  {remove.isPending ? "Deleting…" : "Delete this property"}
                </Button>
              </ThumbRow>
            </div>
          )}
        </section>
      ) : null}

      {guard}
    </section>
  );
}
