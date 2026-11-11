import { Search } from "lucide-react";
import { type FormEvent, useState } from "react";

import { useCreateProperty } from "@/api/queries";
import type { PropertyDef, TypeSummary } from "@/api/types";
import { ThumbRow } from "@/components/handedness";
import {
  ComputedFields,
  computedDraftProblem,
  computedPayload,
  emptyComputedDraft,
  type ComputedDraft,
} from "@/components/schema/computed-fields";
import { OptionEditor } from "@/components/schema/option-editor";
import { Button, FormError, SelectField, TextField } from "@/components/ui/controls";
import { EmptyState, FormatChip, SectionRule } from "@/components/ui/page";
import { cn } from "@/lib/cn";
import { readError } from "@/lib/display";
import { searchProperties } from "@/lib/property-search";
import {
  formatLabel,
  hasOptions,
  isComputed,
  optionInputs,
  type OptionDraft,
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
  const [draft, setDraft] = useState<ComputedDraft>(emptyComputedDraft);
  const [targetType, setTargetType] = useState("");
  const [multi, setMulti] = useState(false);
  const [options, setOptions] = useState<OptionDraft[]>([]);
  const [createdKey, setCreatedKey] = useState("");
  const [query, setQuery] = useState("");
  const matches = searchProperties(properties, query);

  function reset() {
    setName("");
    setDraft(emptyComputedDraft());
    setTargetType("");
    setMulti(false);
    setOptions([]);
  }

  function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const computed = computedPayload(draft);
    create.mutate(
      {
        name: name.trim(),
        ...computed,
        ...(hasOptions(computed.format) ? { options: optionInputs(options) } : {}),
        ...(computed.format === "relation" && draft.kind === "stored"
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
      <SectionRule id="schema-properties" title="Properties" count={properties.length} />

      {createdKey ? (
        <p role="status" className="border-b rule py-2 text-[12px] text-muted">
          Created with key <span className="font-mono text-ink">{createdKey}</span>. The display
          name can change; the key cannot.
        </p>
      ) : null}

      {properties.length > 0 ? (
        <div className="flex items-center gap-2 border-b rule px-1 py-2">
          <Search aria-hidden size={13} className="shrink-0 text-faint" />
          <input
            type="search"
            value={query}
            aria-label="Search properties"
            placeholder="Search names and keys."
            onChange={(event) => setQuery(event.target.value)}
            className="h-8 min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-faint pointer-coarse:h-11 pointer-coarse:text-base max-sm:h-11 max-sm:text-base"
          />
          <span className="tnum shrink-0 font-mono text-[11px] text-faint">
            {matches.length} of {properties.length}
          </span>
        </div>
      ) : null}

      {properties.length === 0 ? (
        <EmptyState sentence="No properties yet. A property is a column definition the whole space can use." />
      ) : matches.length === 0 ? (
        <p className="px-2.5 py-4 text-[13px] text-muted">
          No property matches “{query.trim()}”.
        </p>
      ) : (
        <ul>
          {matches.map((property) => {
            const current = property.key === selectedKey;
            return (
            <li key={property.key} className="border-b rule">
              <button
                type="button"
                aria-current={current ? "true" : undefined}
                className="flex w-full items-center justify-between gap-3 rounded-[12px] px-2.5 py-2.5 text-left transition-colors hover:text-accent aria-[current=true]:bg-accent-wash aria-[current=true]:text-accent-on-wash pointer-coarse:min-h-11"
                onClick={() => onSelect(property.key)}
              >
                <span className="grid min-w-0 gap-0.5">
                  <span
                    className={cn(
                      "truncate text-[15px]",
                      current ? "text-accent-on-wash" : "font-medium text-accent",
                    )}
                  >
                    {property.name}
                  </span>
                  <span
                    className={cn(
                      "truncate font-mono text-[11px] leading-4",
                      current ? "text-accent-on-wash" : "text-faint",
                    )}
                  >
                    {property.key}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  {isComputed(property) ? (
                    <span className="label text-faint">Calculated</span>
                  ) : null}
                  <FormatChip
                    className={cn(
                      "border-accent/40 text-accent-on-wash",
                      current ? undefined : "bg-accent-wash",
                    )}
                  >
                    {formatLabel(property.format)}
                  </FormatChip>
                </span>
              </button>
            </li>
            );
          })}
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
              <ComputedFields
                draft={draft}
                onChange={setDraft}
                library={properties}
                idPrefix="new-property"
              />
              {draft.kind === "stored" && draft.format === "relation" ? (
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
              {draft.kind === "stored" && hasOptions(draft.format) ? (
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
              <FormError
                message={create.error ? readError(create.error) : computedDraftProblem(draft)}
              />
              <ThumbRow className="flex-wrap items-center gap-2">
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
                <Button
                  type="submit"
                  className="min-h-9 px-3 text-[13px]"
                  disabled={
                    create.isPending ||
                    !name.trim() ||
                    computedDraftProblem(draft) !== null
                  }
                >
                  {create.isPending ? "Creating…" : "Create property"}
                </Button>
              </ThumbRow>
            </form>
          ) : (
            <ThumbRow>
              <Button
                type="button"
                variant="ghost"
                className="min-h-9 px-3 text-[13px]"
                onClick={() => setShowCreate(true)}
              >
                New property
              </Button>
            </ThumbRow>
          )}
        </div>
      ) : null}
    </section>
  );
}
