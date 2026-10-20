import { useEffect, useState } from "react";

import { useUpdateProperty } from "@/api/queries";
import type { PropertyDef } from "@/api/types";
import { OptionEditor } from "@/components/schema/option-editor";
import { Button, FormError, TextField } from "@/components/ui/controls";
import { readError } from "@/lib/display";
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
  canEdit: boolean;
}

export function PropertyEditor({ spaceId, property, canEdit }: PropertyEditorProps) {
  const update = useUpdateProperty(spaceId, property.key);
  const [name, setName] = useState(property.name);
  const [options, setOptions] = useState<OptionDraft[]>(() => optionDrafts(property.options));

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
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button
            type="button"
            className="min-h-9 px-3 text-[13px]"
            disabled={!dirty || invalid || update.isPending}
            onClick={() => update.mutate(payload)}
          >
            {update.isPending ? "Saving…" : "Save property"}
          </Button>
          {update.isSuccess && !dirty ? (
            <span className="label text-accent">Saved</span>
          ) : null}
          <div className="min-w-[12rem] flex-1">
            <FormError message={update.error ? readError(update.error) : null} />
          </div>
        </div>
      ) : (
        <p className="mt-5 text-[13px] text-muted">
          Viewers can read the schema but not change it.
        </p>
      )}
    </section>
  );
}
