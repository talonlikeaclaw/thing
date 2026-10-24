import { type FormEvent, useState } from "react";

import { useCreateProperty } from "@/api/queries";
import type { PropertyDef, PropertyFormat, TypeSummary } from "@/api/types";
import { OptionEditor } from "@/components/schema/option-editor";
import { Button, FormError, SelectField, TextField } from "@/components/ui/controls";
import { readError } from "@/lib/display";
import {
  formatLabel,
  hasOptions,
  optionInputs,
  type OptionDraft,
  PROPERTY_FORMATS,
} from "@/lib/schema";

interface PropertyListProps {
  spaceId: string;
  properties: PropertyDef[];
  types: TypeSummary[];
  selectedKey: string | undefined;
  canEdit: boolean;
  onSelect: (key: string) => void;
  onCreated: (key: string) => void;
}

export function PropertyList({
  spaceId,
  properties,
  types,
  selectedKey,
  canEdit,
  onSelect,
  onCreated,
}: PropertyListProps) {
  const create = useCreateProperty(spaceId);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [format, setFormat] = useState<PropertyFormat>("text");
  const [targetType, setTargetType] = useState("");
  const [multi, setMulti] = useState(false);
  const [options, setOptions] = useState<OptionDraft[]>([]);
  const [createdKey, setCreatedKey] = useState("");

  function reset() {
    setName("");
    setFormat("text");
    setTargetType("");
    setMulti(false);
    setOptions([]);
  }

  function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    create.mutate(
      {
        name: name.trim(),
        format,
        ...(hasOptions(format) ? { options: optionInputs(options) } : {}),
        ...(format === "relation"
          ? { multi, ...(targetType ? { target_type: targetType } : {}) }
          : {}),
      },
      {
        onSuccess: (created) => {
          reset();
          setShowCreate(false);
          setCreatedKey(created.key);
          onCreated(created.key);
        },
      },
    );
  }

  return (
    <section aria-labelledby="schema-properties">
      <div className="flex items-baseline justify-between border-b rule pb-2">
        <h2 id="schema-properties" className="text-[17px] font-medium">
          Properties
        </h2>
        <span className="label tnum">{properties.length}</span>
      </div>

      {createdKey ? (
        <p role="status" className="border-b rule py-2 text-[12px] text-muted">
          Created with key <span className="font-mono text-ink">{createdKey}</span>. The display
          name can change; the key cannot.
        </p>
      ) : null}

      {properties.length === 0 ? (
        <p className="border-b rule py-4 text-[13px] text-muted">
          No properties yet. A property is a column definition the whole space can use.
        </p>
      ) : (
        <ul>
          {properties.map((property) => (
            <li key={property.key} className="border-b rule">
              <button
                type="button"
                aria-current={property.key === selectedKey ? "true" : undefined}
                className="flex w-full items-baseline justify-between gap-3 py-2.5 text-left transition-colors hover:text-accent aria-[current=true]:text-accent pointer-coarse:min-h-11"
                onClick={() => onSelect(property.key)}
              >
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="truncate text-[15px]">{property.name}</span>
                  <span className="font-mono text-[11px] text-faint">{property.key}</span>
                </span>
                <span className="label shrink-0">{formatLabel(property.format)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {canEdit ? (
        <div className="mt-3">
          {showCreate ? (
            <form className="grid gap-3" onSubmit={onCreate}>
              <p className="border-l border-line-interactive pl-3 text-[12px] text-muted">
                The key is derived from the name, permanent, and used in file paths and CSV
                headers.
              </p>
              <TextField
                label="Name"
                name="property-name"
                required
                maxLength={200}
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
              <SelectField
                label="Format"
                value={format}
                options={PROPERTY_FORMATS.map(({ value, label }) => ({ value, label }))}
                onValueChange={(value) => setFormat(value as PropertyFormat)}
              />
              {format === "relation" ? (
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                  <SelectField
                    label="Target type"
                    value={targetType}
                    options={[
                      { value: "", label: "Any type" },
                      ...types.map((type) => ({ value: type.key, label: type.name })),
                    ]}
                    onValueChange={setTargetType}
                  />
                  <label className="label flex min-h-10 items-center gap-2">
                    <input
                      type="checkbox"
                      checked={multi}
                      onChange={(event) => setMulti(event.target.checked)}
                    />
                    Several targets
                  </label>
                </div>
              ) : null}
              {hasOptions(format) ? (
                <div>
                  <p className="label mb-1">Options</p>
                  <OptionEditor
                    drafts={options}
                    onChange={setOptions}
                    canEdit={canEdit}
                    idPrefix="new-property"
                  />
                </div>
              ) : null}
              <FormError message={create.error ? readError(create.error) : null} />
              <div className="flex gap-2">
                <Button
                  type="submit"
                  className="min-h-9 px-3 text-[13px]"
                  disabled={create.isPending || !name.trim()}
                >
                  {create.isPending ? "Creating…" : "Create property"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-9 px-3 text-[13px]"
                  onClick={() => {
                    reset();
                    setShowCreate(false);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <Button
              type="button"
              variant="ghost"
              className="min-h-9 px-3 text-[13px]"
              onClick={() => setShowCreate(true)}
            >
              New property
            </Button>
          )}
        </div>
      ) : null}
    </section>
  );
}
