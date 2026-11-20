import { Dialog } from "@base-ui/react/dialog";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";

import { ApiError } from "@/api/client";
import {
  useDeleteProperty,
  useProperties,
  usePropertyUsage,
  useRenameProperty,
  useSpace,
  useTypeDetails,
  useTypes,
  useUpdateProperty,
  useUpdateType,
} from "@/api/queries";
import type { Filter, PropertyDef, TypeDef, TypeProperty, TypeSummary } from "@/api/types";
import { ThumbRow, useThumbHandedness } from "@/components/handedness";
import { FilterConditions } from "@/components/filter-conditions";
import {
  ComputedFields,
  computedDraft,
  computedDraftProblem,
  computedPatch,
  type ComputedDraft,
} from "@/components/schema/computed-fields";
import {
  DisplayFields,
  displayDraft,
  displayPayload,
  type DisplayDraft,
} from "@/components/schema/display-fields";
import { MembershipDefault } from "@/components/schema/membership-default";
import { OptionEditor } from "@/components/schema/option-editor";
import { PromoteColumnDialog } from "@/components/schema/promote-column";
import {
  ValidationFields,
  validationApplies,
  validationDraft,
  validationPayload,
  type ValidationDraft,
} from "@/components/schema/validation-fields";
import { Button, FormError, StickyActionBar, TextField } from "@/components/ui/controls";
import { FieldRow, SectionRule } from "@/components/ui/page";
import {
  SheetCloseButton,
  SheetHeader,
  SheetPopup,
  SheetTitle,
  SheetViewport,
} from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { readApiProblems, readError } from "@/lib/display";
import { useDirtyGuard } from "@/lib/use-dirty-guard";
import { promotionBlocker } from "@/lib/promotion";
import {
  computeKindLabel,
  effectiveProperties,
  formatLabel,
  hasOptions,
  isComputed,
  optionDrafts,
  optionInputs,
  type OptionDraft,
  sameJson,
} from "@/lib/schema";
import { todayIn } from "@/lib/timezone";

interface PropertyEditorFormProps {
  spaceId: string;
  property: PropertyDef;
  types: TypeSummary[];
  /** The whole library, so a rollup names a relation and its target. */
  library: PropertyDef[];
  canEdit: boolean;
  /** The type whose membership this sheet edits; absent on the space library. */
  type?: TypeDef;
  /** The membership to edit; present exactly when `type` is. */
  member?: TypeProperty;
  /** The schema page's rule; a sheet already has a title and omits it. */
  headingId?: string;
  onRenamed?: (key: string) => void;
  onDeleted?: () => void;
}

/**
 * The property form every surface shares: the schema page renders it inline,
 * the record and manage sheets render it inside the shared overlay. Name and
 * options are writable; format, target and cardinality are fixed once values
 * exist.
 */
export function PropertyEditorForm({
  spaceId,
  property,
  types,
  library,
  canEdit,
  type,
  member,
  headingId,
  onRenamed,
  onDeleted,
}: PropertyEditorFormProps) {
  const update = useUpdateProperty(spaceId, property.key);
  const typeUpdate = useUpdateType(spaceId, type?.key ?? "");
  const remove = useDeleteProperty(spaceId, property.key);
  const rename = useRenameProperty(spaceId, property.key);
  const usage = usePropertyUsage(
    spaceId,
    property.key,
    types.map((type) => type.key),
  );
  const space = useSpace(spaceId);
  const today = todayIn(space.data?.timezone ?? "UTC");
  // A relation's filter is edited against the target type, whose properties the
  // summary list does not carry.
  const targetDetails = useTypeDetails(
    spaceId,
    property.target_type ? [property.target_type] : [],
    property.format === "relation",
  );
  const targetType: TypeDef | undefined = targetDetails.details[0];
  // A relation any rollup reads stays open: that rollup's filter is the one
  // narrowing for it, so the controls below would always be refused.
  const rollupReaders = useMemo(
    () =>
      library.filter(
        (candidate) =>
          candidate.compute?.kind === "rollup" &&
          candidate.compute.relation === property.key,
      ),
    [library, property.key],
  );
  const readByRollups = rollupReaders.length > 0;
  const toast = useToast();
  const [name, setName] = useState(property.name);
  const [draft, setDraft] = useState<ComputedDraft>(() => computedDraft(property));
  const [display, setDisplay] = useState<DisplayDraft>(() => displayDraft(property.display));
  const [validation, setValidation] = useState<ValidationDraft>(() =>
    validationDraft(property.validation),
  );
  const [options, setOptions] = useState<OptionDraft[]>(() => optionDrafts(property.options));
  /** A relation's narrowing, and whether one record may link a target. */
  const [targetFilter, setTargetFilter] = useState<Filter>(
    () => property.target_filter ?? { op: "and", conditions: [] },
  );
  const [oneToOne, setOneToOne] = useState(() => property.one_to_one ?? false);
  const [membership, setMembership] = useState<TypeProperty | null>(member ?? null);
  /** A half-typed default blocks the one Save, exactly as it does on a record. */
  const [defaultInvalid, setDefaultInvalid] = useState(false);
  const [confirmKey, setConfirmKey] = useState("");
  const [renameKey, setRenameKey] = useState("");
  const [promoteOpen, setPromoteOpen] = useState(false);

  // A saved new option comes back with its minted key; adopting the response
  // keeps a later rename from re-deriving the key it already has.
  useEffect(() => {
    if (update.data) {
      setName(update.data.name);
      setDraft(computedDraft(update.data));
      setDisplay(displayDraft(update.data.display));
      setValidation(validationDraft(update.data.validation));
      setOptions(optionDrafts(update.data.options));
      setTargetFilter(update.data.target_filter ?? { op: "and", conditions: [] });
      setOneToOne(update.data.one_to_one ?? false);
    }
  }, [update.data]);

  // The type write answers with the whole definition, so a normalised default
  // (an empty one dropped) shows without a second read.
  useEffect(() => {
    const saved = typeUpdate.data?.properties.find((entry) => entry.key === member?.key);
    if (saved) {
      setMembership(saved);
      setDefaultInvalid(false);
    }
  }, [typeUpdate.data, member?.key]);

  const calculated = isComputed(property);
  const showsOptions = !calculated && hasOptions(property.format);
  const displayValue = displayPayload(display, property.format);
  const initialDisplay = displayPayload(displayDraft(property.display), property.format);
  // A display the reader did not touch stays out of the write, so an unrelated
  // edit cannot rewrite the block; a cleared one is sent as `null`.
  const displayChanged = !sameJson(displayValue, initialDisplay);
  const validationValue = validationPayload(validation, property.format, property.multi);
  const initialValidation = validationPayload(
    validationDraft(property.validation),
    property.format,
    property.multi,
  );
  // The same rule for validation: untouched stays out, cleared sends `null`.
  const validationChanged = !sameJson(validationValue, initialValidation);
  // A relation's rules follow the same tri-state: untouched stays out, an empty
  // filter is sent as `null`, one-to-one only when it moved.
  const filterValue = targetFilter.conditions.length > 0 ? targetFilter : null;
  const filterChanged = !sameJson(filterValue, property.target_filter ?? null);
  const oneToOneChanged = oneToOne !== (property.one_to_one ?? false);
  const payload = {
    name: name.trim(),
    ...(calculated ? computedPatch(draft) : {}),
    ...(showsOptions ? { options: optionInputs(options) } : {}),
    ...(displayChanged ? { display: displayValue } : {}),
    ...(validationChanged ? { validation: validationValue } : {}),
    ...(filterChanged ? { target_filter: filterValue } : {}),
    ...(oneToOneChanged ? { one_to_one: oneToOne } : {}),
  };
  const initial = {
    name: property.name,
    ...(calculated ? computedPatch(computedDraft(property)) : {}),
    ...(showsOptions ? { options: optionInputs(optionDrafts(property.options)) } : {}),
  };
  const dirty = !sameJson(payload, initial);
  const membershipDirty =
    type !== undefined &&
    member !== undefined &&
    membership !== null &&
    !sameJson(membership, member);
  const draftProblem = calculated ? computedDraftProblem(draft) : null;
  const invalid =
    !payload.name ||
    draftProblem !== null ||
    defaultInvalid ||
    (showsOptions && options.some((option) => !option.name.trim()));

  /**
   * One Save, two writes: the definition first, then the membership, each only
   * when it changed. A refusal stops at its stage and leaves the other draft in
   * place, so a retry writes just the rest.
   */
  async function saveDraft(): Promise<boolean> {
    if (!canEdit || invalid) {
      return false;
    }
    try {
      if (dirty) {
        await update.mutateAsync(payload);
      }
      if (membershipDirty && type && membership) {
        await typeUpdate.mutateAsync({
          properties: type.properties.map((entry) =>
            entry.key === membership.key ? membership : entry,
          ),
        });
      }
      return true;
    } catch {
      return false;
    }
  }

  const guard = useDirtyGuard(dirty || membershipDirty, saveDraft);

  // The server counts trashed records; the client cannot see their values, so a
  // refused delete's details replace the read-only estimate.
  const conflictUsage =
    remove.error instanceof ApiError && remove.error.status === 409
      ? {
          types: Number(remove.error.details.types ?? 0) || 0,
          records: Number(remove.error.details.objects ?? 0) || 0,
        }
      : null;
  // A calculated definition names this key; the server refuses even `force`,
  // because it cannot rewrite an expression or a rollup for you.
  const computedHolders =
    remove.error instanceof ApiError &&
    remove.error.status === 409 &&
    remove.error.details.reason === "computed properties use property" &&
    Array.isArray(remove.error.details.properties)
      ? remove.error.details.properties.filter(
          (key): key is string => typeof key === "string",
        )
      : [];
  const usageTypes = conflictUsage ? conflictUsage.types : usage.types.length;
  const usageRecords = conflictUsage ? conflictUsage.records : usage.records;
  const inUse = usageTypes > 0 || usageRecords > 0;
  const blocked = usage.views.length > 0;
  const deleteReady =
    !usage.isPending &&
    !blocked &&
    computedHolders.length === 0 &&
    (!inUse || confirmKey.trim().toLowerCase() === property.key.toLowerCase()) &&
    !remove.isPending;
  const nextKey = renameKey.trim();
  const renameReady =
    nextKey !== "" && nextKey !== property.key && !rename.isPending && !dirty;
  const convertBlocker = promotionBlocker(property, usageTypes);
  const convertible = convertBlocker === null;
  const convertOwner = usage.types[0];

  return (
    <>
      {headingId ? (
        <SectionRule
          id={headingId}
          title={property.name}
          action={
            <span className="flex flex-wrap items-baseline gap-3">
              {!dirty && !membershipDirty && (update.isSuccess || typeUpdate.isSuccess) ? (
                <span className="label text-accent">saved</span>
              ) : null}
              <span className="font-mono text-[11px] text-faint">
                properties/{property.key}.yml
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
        <FieldRow label="Name" htmlFor={`property-${property.key}-name`}>
          <TextField
            id={`property-${property.key}-name`}
            name={`property-${property.key}-name`}
            required
            maxLength={200}
            value={name}
            disabled={!canEdit}
            onChange={(event) => setName(event.target.value)}
          />
        </FieldRow>
        <FieldRow
          label="Format"
          hint={
            calculated
              ? "The result type; fixed once the property exists."
              : "Fixed once values exist."
          }
        >
          <p className="flex min-h-10 items-center font-mono text-[12px] text-muted">
            {formatLabel(property.format)}
          </p>
        </FieldRow>
        <FieldRow
          label="Display"
          hint="How the values read in every table; the stored value never changes."
        >
          <DisplayFields
            draft={display}
            onChange={setDisplay}
            format={property.format}
            disabled={!canEdit}
            idPrefix={`property-${property.key}`}
            disclosure={false}
          />
        </FieldRow>
        {!calculated && validationApplies(property.format, property.multi) ? (
          <FieldRow
            label="Validation"
            hint="What a value must satisfy; a value outside these rules is refused where it is written."
          >
            <ValidationFields
              draft={validation}
              onChange={setValidation}
              format={property.format}
              multi={property.multi}
              disabled={!canEdit}
              idPrefix={`property-${property.key}`}
              disclosure={false}
            />
          </FieldRow>
        ) : null}
        {calculated ? (
          <FieldRow label={computeKindLabel(property) ?? "Calculation"}>
            <ComputedFields
              draft={draft}
              onChange={setDraft}
              library={library}
              spaceId={spaceId}
              existing
              disabled={!canEdit}
              idPrefix={`property-${property.key}`}
              problem={readApiProblems(update.error)[0] ?? null}
            />
          </FieldRow>
        ) : null}
        {property.format === "relation" ? (
          <>
            <FieldRow label="Links to">
              <p className="flex min-h-10 items-center font-mono text-[12px] text-muted">
                {property.target_type ?? "any type"}
              </p>
            </FieldRow>
            <FieldRow
              label="Holds"
              hint="What it links to, and how many records, are fixed when the property is created."
            >
              <p className="flex min-h-10 items-center font-mono text-[12px] text-muted">
                {property.multi ? "several records" : "one record"}
              </p>
            </FieldRow>
            <FieldRow
              label="Only linked records matching"
              hint={
                readByRollups
                  ? "A summary decides which linked records it counts, so its filter lives there."
                  : "The picker offers these records, and a value written anywhere else is refused."
              }
            >
              {readByRollups ? (
                <p className="flex min-h-10 items-center text-[12px] leading-4 text-muted">
                  {rollupReaders.map((reader) => reader.name).join(", ")}{" "}
                  {rollupReaders.length === 1 ? "summarises" : "summarise"} this relation, so its
                  links stay open. Filter the summary instead.
                </p>
              ) : targetType ? (
                <FilterConditions
                  key={targetType.key}
                  spaceId={spaceId}
                  type={targetType}
                  properties={effectiveProperties(targetType, library)}
                  filter={targetFilter}
                  today={today}
                  onChange={setTargetFilter}
                  empty="Every record of the linked type."
                />
              ) : property.target_type ? (
                <p className="flex min-h-10 items-center text-[12px] text-muted">
                  Reading the target type…
                </p>
              ) : (
                <p className="flex min-h-10 items-center text-[12px] text-muted">
                  A filter needs a relation with a target type.
                </p>
              )}
            </FieldRow>
            <FieldRow
              label="Linked once"
              hint="A second record naming the same record is refused, and the message names the first."
            >
              <label className="flex min-h-9 items-center gap-2 text-[13px] text-ink pointer-coarse:min-h-11">
                <input
                  type="checkbox"
                  checked={oneToOne}
                  disabled={!canEdit || property.multi || readByRollups}
                  className="h-4 w-4 accent-[var(--color-accent)] pointer-coarse:h-5 pointer-coarse:w-5"
                  onChange={(event) => setOneToOne(event.target.checked)}
                />
                A target is linked by one record only
              </label>
            </FieldRow>
          </>
        ) : null}
        {showsOptions ? (
          <FieldRow
            label={
              <>
                Options{" "}
                <span className="font-mono text-[length:var(--text-label)] tnum text-faint">
                  {options.length}
                </span>
              </>
            }
          >
            <OptionEditor
              drafts={options}
              onChange={setOptions}
              canEdit={canEdit}
              idPrefix={property.key}
            />
          </FieldRow>
        ) : null}
        {type && membership ? (
          <FieldRow
            label="On this type"
            hint={`Required and the starting value for ${type.name}. The definition above is shared by every type that carries it.`}
          >
            <MembershipDefault
              spaceId={spaceId}
              member={membership}
              property={property}
              canEdit={canEdit}
              onChange={setMembership}
              onInvalid={setDefaultInvalid}
            />
          </FieldRow>
        ) : null}
      </div>

      <section aria-labelledby={`property-${property.key}-used-by`} className="mt-8">
        <SectionRule
          id={`property-${property.key}-used-by`}
          level={3}
          title="Used by"
          count={usage.isPending ? "…" : String(usageTypes)}
        />
        {usage.error ? <FormError message={readError(usage.error)} /> : null}
        {usage.isPending ? (
          <p className="mt-2 text-[13px] text-muted">Counting types and records…</p>
        ) : usage.types.length === 0 ? (
          <p className="mt-2 text-[13px] text-muted">No type carries this property.</p>
        ) : (
          <ul className="mt-2 grid gap-1">
            {usage.types.map((owner) => (
              <li key={owner.key} className="flex items-baseline gap-2 text-[13px]">
                <span className="text-accent">{owner.name}</span>
                <span className="font-mono text-[11px] text-faint">{owner.key}</span>
              </li>
            ))}
            <li className="text-[13px] text-muted">
              {usageRecords} live{" "}
              {usageRecords === 1 ? "record holds" : "records hold"} a value.
            </li>
          </ul>
        )}
      </section>

      {!calculated ? (
        <section aria-labelledby={`property-${property.key}-convert`} className="mt-8">
          <SectionRule
            id={`property-${property.key}-convert`}
            level={3}
            title="Convert"
          />
          <p className="mt-2 max-w-[62ch] text-[13px] text-muted">
            A text, select or multi-select column carried by one type can become a relation whose
            targets are the values it already holds.
          </p>
          <Button
            type="button"
            variant="ghost"
            className="mt-2 min-h-9 px-3 text-[13px]"
            disabled={!convertible || !canEdit}
            title={convertBlocker ?? undefined}
            onClick={() => setPromoteOpen(true)}
          >
            Turn into a relation…
          </Button>
          {convertBlocker && canEdit ? (
            <p className="mt-1 text-[12px] text-faint">{convertBlocker}</p>
          ) : null}
        </section>
      ) : null}

      {promoteOpen && convertOwner ? (
        <PromoteColumnDialog
          spaceId={spaceId}
          typeKey={convertOwner.key}
          property={property}
          onClose={() => setPromoteOpen(false)}
        />
      ) : null}

      {canEdit ? (
        dirty || membershipDirty ? (
          <StickyActionBar>
            <div className="min-w-[12rem] flex-1">
              <FormError
                message={
                  update.error
                    ? readError(update.error)
                    : typeUpdate.error
                      ? readError(typeUpdate.error)
                      : null
                }
              />
            </div>
            <span className="label flex items-center gap-1.5 text-accent">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
              Unsaved changes
            </span>
            <Button
              type="button"
              className="min-h-9 px-3 text-[13px] pointer-coarse:min-h-11"
              disabled={invalid || update.isPending || typeUpdate.isPending}
              onClick={() => void saveDraft()}
            >
              {update.isPending || typeUpdate.isPending
                ? "Saving…"
                : type && membership
                  ? "Save changes"
                  : "Save property"}
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
          aria-labelledby={`property-${property.key}-key`}
          className="mt-10 border-t rule pt-4"
        >
          <SectionRule id={`property-${property.key}-key`} level={3} title="Key" />
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
                dirty || membershipDirty
                  ? "Save the display name first; renaming reloads this editor."
                  : "Lowercase letters, digits and underscores, starting with a letter."
              }
            />
            <FormError message={rename.error ? readError(rename.error) : null} />
            <ThumbRow>
              <Button
                type="button"
                variant="ghost"
                className="w-fit min-h-9 px-3 text-[13px]"
                disabled={!renameReady}
                onClick={async () => {
                  try {
                    const next = await rename.mutateAsync(nextKey);
                    onRenamed?.(next.key);
                    setRenameKey("");
                    toast.showToast(`Key renamed to ${next.key}.`);
                  } catch {
                    // The mutation's error state names the refusal next to the key.
                  }
                }}
              >
                {rename.isPending ? "Renaming…" : "Rename key"}
              </Button>
            </ThumbRow>
          </div>
        </section>
      ) : null}

      {canEdit ? (
        <section
          aria-labelledby={`property-${property.key}-danger`}
          className="mt-10 border-t border-danger/60 pt-4"
        >
          <SectionRule
            id={`property-${property.key}-danger`}
            level={3}
            tone="danger"
            title="Delete property"
          />
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

          {computedHolders.length > 0 ? (
            <div className="mt-3 border-l border-warning pl-3">
              <p className="text-[13px] text-warning">
                {computedHolders.length === 1
                  ? "A calculated property uses this property."
                  : "Calculated properties use this property."}{" "}
                Edit each definition first; deleting this key cannot rewrite them.
              </p>
              <ul className="mt-1 grid gap-0.5 text-[13px]">
                {computedHolders.map((holder) => (
                  <li key={holder}>
                    <Link
                      to={`/s/${spaceId}/schema?property=${holder}`}
                      className="text-ink underline decoration-line-strong hover:decoration-accent pointer-coarse:py-3.5"
                    >
                      {library.find((entry) => entry.key === holder)?.name ?? holder}
                    </Link>{" "}
                    <span className="font-mono text-[11px] text-faint">{holder}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
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
                      className="text-ink underline decoration-line-strong hover:decoration-accent pointer-coarse:py-3.5"
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
              <FormError
                message={
                  remove.error && computedHolders.length === 0
                    ? readError(remove.error)
                    : null
                }
              />
              <ThumbRow className="flex-wrap items-center gap-3">
                <Button
                  variant="destructive"
                  className="w-fit"
                  disabled={!deleteReady}
                  onClick={async () => {
                    try {
                      await remove.mutateAsync(inUse);
                      toast.showToast(`Deleted property “${property.name}”.`);
                      onDeleted?.();
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
    </>
  );
}

interface PropertyEditorProps {
  spaceId: string;
  property: PropertyDef;
  types: TypeSummary[];
  library: PropertyDef[];
  canEdit: boolean;
  onRenamed: (key: string) => void;
}

/** The schema page's inline editor: the shared form under its file rule. */
export function PropertyEditor({
  spaceId,
  property,
  types,
  library,
  canEdit,
  onRenamed,
}: PropertyEditorProps) {
  return (
    <section aria-labelledby="property-editor" className="settle">
      <PropertyEditorForm
        spaceId={spaceId}
        property={property}
        types={types}
        library={library}
        canEdit={canEdit}
        headingId="property-editor"
        onRenamed={onRenamed}
      />
    </section>
  );
}

interface PropertyEditorSheetProps {
  spaceId: string;
  property: PropertyDef;
  canEdit: boolean;
  /** The type whose membership is edited alongside the definition. */
  type?: TypeDef;
  member?: TypeProperty;
  onClose: () => void;
}

/** The same form inside the shared sheet, for a record or the manage list. */
export function PropertyEditorSheet({
  spaceId,
  property,
  canEdit,
  type,
  member,
  onClose,
}: PropertyEditorSheetProps) {
  const types = useTypes(spaceId);
  const properties = useProperties(spaceId);
  const handedness = useThumbHandedness();
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
                  <SheetCloseButton label="Close property editor" />
                  <SheetTitle className="min-w-0 flex-1 truncate">
                    Edit {property.name}
                  </SheetTitle>
                </>
              ) : (
                <>
                  <SheetTitle className="min-w-0 flex-1 truncate">
                    Edit {property.name}
                  </SheetTitle>
                  <SheetCloseButton label="Close property editor" />
                </>
              )}
            </SheetHeader>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-[var(--space-4)] py-[var(--space-3)] pb-[max(1rem,env(safe-area-inset-bottom))]">
              <PropertyEditorForm
                spaceId={spaceId}
                property={property}
                types={types.data ?? []}
                library={properties.data ?? []}
                canEdit={canEdit}
                type={type}
                member={member}
                onRenamed={onClose}
                onDeleted={onClose}
              />
            </div>
          </SheetPopup>
        </SheetViewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
