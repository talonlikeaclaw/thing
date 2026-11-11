import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { useTypeDetails } from "@/api/queries";
import type {
  Aggregate,
  ComputeDef,
  PropertyDef,
  PropertyFormat,
  TypeDef,
} from "@/api/types";
import { PropertyPicker } from "@/components/property-picker";
import { FormError, SelectField, TextAreaField } from "@/components/ui/controls";
import { cn } from "@/lib/cn";
import type { ApiProblem } from "@/lib/display";
import { radioTargetIndex } from "@/lib/radio-keys";
import {
  FORMULA_FUNCTIONS,
  formulaHints,
  type FormulaHint,
  insertHint,
} from "@/lib/formula-hints";
import {
  effectiveProperties,
  formatLabel,
  isComputed,
  RESULT_FORMATS,
  rollupResultFormat,
  STORED_FORMATS,
  TITLE_COLUMN,
  writableProperties,
} from "@/lib/schema";

/** The three things a property's value can be: written, or derived two ways. */
export type AuthoringKind = "stored" | "formula" | "rollup";

/** The authoring draft one property form owns; the server sees only its payload. */
export interface ComputedDraft {
  kind: AuthoringKind;
  /** The result format; a stored property's own format when `kind` is stored. */
  format: PropertyFormat;
  expression: string;
  relation: string;
  aggregate: Aggregate;
  /** A target property key, or `title`. */
  property: string;
}

/** The server's expression limit, in characters. */
export const MAX_FORMULA_LEN = 500;

/** Every result a formula may produce; `list` is a rollup's shape alone. */
const FORMULA_RESULTS = RESULT_FORMATS.filter((format) => format !== "list");

/** Whether a format may be stored; `list` is a calculated result alone. */
function isStoredFormat(format: PropertyFormat): boolean {
  return format !== "list";
}

/** The results a `min`/`max` rollup may take when the target is not yet known. */
const RANGE_RESULTS: PropertyFormat[] = ["number", "date", "datetime"];

const AGGREGATES: { value: Aggregate; label: string }[] = [
  { value: "count", label: "Count" },
  { value: "sum", label: "Sum" },
  { value: "min", label: "Minimum" },
  { value: "max", label: "Maximum" },
  { value: "list", label: "List" },
];

/** What each aggregate does to the linked records, in plain words. */
const ROLLUP_STORY: Record<Aggregate, string> = {
  count: "Counts the linked records this row has.",
  sum: "Adds one number from every linked record.",
  min: "The smallest number, or earliest date, among the linked records.",
  max: "The largest number, or latest date, among the linked records.",
  list: "Joins one label from every linked record into a text list.",
};

/** The formats one `list` rollup may copy a label from. */
const LIST_LABEL_FORMATS: ReadonlySet<PropertyFormat> = new Set([
  "text",
  "number",
  "checkbox",
  "date",
  "datetime",
  "select",
  "url",
  "email",
  "file",
  "image",
  "relation",
]);

/** Whether one target format can feed an aggregate; the engine refuses the rest. */
function allowsTarget(aggregate: Aggregate, format: PropertyFormat): boolean {
  switch (aggregate) {
    case "sum":
      return format === "number";
    case "min":
    case "max":
      return format === "number" || format === "date" || format === "datetime";
    case "list":
      return LIST_LABEL_FORMATS.has(format);
    default:
      return true;
  }
}

/** The stored formats a formula may read; multi-value ones are refused. */
const REFERENCE_FORMATS: ReadonlySet<PropertyFormat> = new Set([
  "text",
  "number",
  "checkbox",
  "date",
  "datetime",
  "select",
  "url",
  "email",
  "file",
  "image",
]);

/** One example carries the result type it produces, so a click never mismatches. */
const FORMULA_EXAMPLES: { expression: string; format: PropertyFormat }[] = [
  { expression: "days(last_completed_at, today())", format: "number" },
  { expression: "price * quantity", format: "number" },
  {
    expression: 'if(stock > 0, "In stock", "Out")',
    format: "text",
  },
];

const KIND_CHOICES: { value: AuthoringKind; label: string }[] = [
  { value: "stored", label: "Stored" },
  { value: "formula", label: "Formula" },
  { value: "rollup", label: "Rollup" },
];

/** One sentence per kind, shown under the choice so the words carry meaning. */
const KIND_STORY: Record<AuthoringKind, string> = {
  stored: "A value someone types into each record.",
  formula: "Calculates one read-only value per record from its own fields.",
  rollup: "Summarises the records a relation points at; read-only.",
};

/** The signature and the job of every function the language offers. */
const FUNCTION_HELP: Record<
  (typeof FORMULA_FUNCTIONS)[number],
  { signature: string; story: string }
> = {
  if: { signature: "if(condition, a, b)", story: "One value when true, another when false." },
  round: { signature: "round(number, digits)", story: "Nearest whole number, or to digits." },
  abs: { signature: "abs(number)", story: "Distance from zero, without a sign." },
  min: { signature: "min(a, b, …)", story: "The smallest of its arguments." },
  max: { signature: "max(a, b, …)", story: "The largest of its arguments." },
  length: { signature: "length(text)", story: "How many characters the text has." },
  lower: { signature: "lower(text)", story: "The same text in lowercase." },
  upper: { signature: "upper(text)", story: "The same text in uppercase." },
  days: { signature: "days(from, to)", story: "Whole calendar days between two dates." },
  today: { signature: "today()", story: "This record's current calendar day." },
};

/** A draft with no derivation: the starting point for a new property. */
export function emptyComputedDraft(): ComputedDraft {
  return {
    kind: "stored",
    format: "text",
    expression: "",
    relation: "",
    aggregate: "count",
    property: TITLE_COLUMN,
  };
}

/** The draft a saved property describes; a stored one keeps its format. */
export function computedDraft(property: PropertyDef | undefined): ComputedDraft {
  const draft = emptyComputedDraft();
  if (!property) {
    return draft;
  }
  const compute = property.compute;
  if (compute?.kind === "formula") {
    return {
      ...draft,
      kind: "formula",
      format: property.format,
      expression: compute.expression ?? "",
    };
  }
  if (compute?.kind === "rollup") {
    return {
      ...draft,
      kind: "rollup",
      format: property.format,
      relation: compute.relation ?? "",
      aggregate: compute.aggregate ?? "count",
      property: compute.property ?? TITLE_COLUMN,
    };
  }
  return { ...draft, format: property.format };
}

/**
 * The create payload's shape: `format` always, `compute` only when the value is
 * derived. The result type is what a table, filter, sort and CSV already read.
 */
export function computedPayload(draft: ComputedDraft): {
  format: PropertyFormat;
  compute?: ComputeDef;
} {
  if (draft.kind === "stored") {
    return { format: draft.format };
  }
  if (draft.kind === "formula") {
    return {
      format: draft.format,
      compute: { kind: "formula", expression: draft.expression.trim() },
    };
  }
  return {
    format: draft.format,
    compute: {
      kind: "rollup",
      relation: draft.relation,
      aggregate: draft.aggregate,
      ...(draft.aggregate === "count"
        ? {}
        : { property: draft.property || TITLE_COLUMN }),
    },
  };
}

/** The part of a PATCH that edits a derivation; a stored property sends none. */
export function computedPatch(draft: ComputedDraft): { compute?: ComputeDef } {
  const { compute } = computedPayload(draft);
  return compute ? { compute } : {};
}

/** What the client refuses on its own: an empty required field or long text. */
export function computedDraftProblem(draft: ComputedDraft): string | null {
  if (draft.kind === "formula") {
    if (draft.expression.trim() === "") {
      return "Write an expression.";
    }
    if (draft.expression.length > MAX_FORMULA_LEN) {
      return `The expression is ${draft.expression.length} characters; the limit is ${MAX_FORMULA_LEN}.`;
    }
  }
  if (draft.kind === "rollup") {
    if (draft.relation === "") {
      return "Choose a relation.";
    }
    if (draft.aggregate !== "count" && draft.property === "") {
      return "Choose a target property.";
    }
  }
  return null;
}

interface ComputedFieldsProps {
  draft: ComputedDraft;
  onChange: (draft: ComputedDraft) => void;
  /** The space, used to resolve a relation's target type when it is not loaded. */
  spaceId?: string;
  /** The space's whole property library, so a rollup can name its targets. */
  library: PropertyDef[];
  /** The type the property joins, when the caller knows it. */
  type?: TypeDef;
  /** Detailed types the caller already loaded; enables target narrowing. */
  types?: TypeDef[];
  /** An existing calculated property: its kind and result type are fixed. */
  existing?: boolean;
  disabled?: boolean;
  idPrefix: string;
  /** The stored-format control a caller already has, for example its card grid. */
  renderStoredFormat?: (disabled: boolean) => ReactNode;
  /** The server's field-level refusal, shown beside the control it names. */
  problem?: ApiProblem | null;
}

/**
 * The one place a calculated column is described: the kind choice, the result
 * type and either a formula or a rollup. Syntax, references and type
 * compatibility stay the server's; this form checks only what it can see.
 */
export function ComputedFields({
  draft,
  onChange,
  library,
  type,
  types,
  existing = false,
  disabled = false,
  spaceId,
  idPrefix,
  renderStoredFormat,
  problem,
}: ComputedFieldsProps) {
  const frozen = disabled || existing;

  const relations = useMemo(() => {
    const candidates = type
      ? effectiveProperties(type, library)
      : library;
    return candidates.filter(
      (property) => property.format === "relation" && !isComputed(property),
    );
  }, [type, library]);

  const relation = relations.find((property) => property.key === draft.relation);

  // A relation may point at a type the caller has not loaded. Fetch just that
  // one so a rollup's target choices are the target type's members, never the
  // whole library with an incompatible format among them.
  const targetKey = relation?.target_type;
  const knownTypes = useMemo(
    () =>
      [type, ...(types ?? [])].filter(
        (candidate): candidate is TypeDef => candidate !== undefined,
      ),
    [type, types],
  );
  const missingTarget =
    targetKey !== undefined && !knownTypes.some((candidate) => candidate.key === targetKey);
  const fetchedTarget = useTypeDetails(
    spaceId ?? "",
    targetKey && missingTarget ? [targetKey] : [],
    Boolean(spaceId && missingTarget),
  );
  const targetType = useMemo(() => {
    if (!targetKey) {
      return undefined;
    }
    return (
      knownTypes.find((candidate) => candidate.key === targetKey) ??
      fetchedTarget.details[0]
    );
  }, [targetKey, knownTypes, fetchedTarget.details]);

  const targetCandidates = useMemo(
    () =>
      writableProperties(
        targetType ? effectiveProperties(targetType, library) : library,
      ),
    [targetType, library],
  );
  // An existing definition keeps its saved property even if it no longer fits;
  // the server's sentence explains that. A new one only offers what can work.
  const targetProperties = useMemo(
    () =>
      existing
        ? targetCandidates
        : targetCandidates.filter((property) =>
            allowsTarget(draft.aggregate, property.format),
          ),
    [existing, targetCandidates, draft.aggregate],
  );

  const target = targetProperties.find(
    (property) => property.key === draft.property,
  );
  const targetFormat =
    draft.property === TITLE_COLUMN ? "text" : target?.format;

  // A formula reads only stored single-value members; `title` is always there.
  const references = useMemo(() => {
    const candidates = type ? effectiveProperties(type, library) : library;
    return [
      ...candidates
        .filter(
          (property) =>
            !isComputed(property) && REFERENCE_FORMATS.has(property.format),
        )
        .map((property) => ({
          key: property.key,
          name: property.name,
          format: property.format,
        })),
      { key: TITLE_COLUMN, name: "Title", format: "text" as PropertyFormat },
    ];
  }, [type, library]);

  const expressionRef = useRef<HTMLTextAreaElement | null>(null);
  // Start at the end of a saved expression, so the suggestions describe the
  // next token the reader would type rather than the first one already there.
  const [caret, setCaret] = useState(() => draft.expression.length);
  const hints =
    draft.kind === "formula"
      ? formulaHints(references, draft.expression, caret)
      : [];

  function applyHint(hint: FormulaHint) {
    const inserted = insertHint(draft.expression, caret, hint);
    onChange({ ...draft, expression: inserted.expression });
    setCaret(inserted.caret);
    const field = expressionRef.current;
    if (field) {
      field.focus();
      field.setSelectionRange(inserted.caret, inserted.caret);
    }
  }
  const derivedFormat =
    draft.kind === "rollup"
      ? rollupResultFormat(draft.aggregate, targetFormat)
      : undefined;

  // A rollup's result follows its aggregate and target: a count and a sum are
  // numbers, a list is a list, and a minimum or maximum keeps the target's type.
  useEffect(() => {
    if (existing || !derivedFormat || derivedFormat === draft.format) {
      return;
    }
    onChange({ ...draft, format: derivedFormat });
  }, [existing, derivedFormat, draft, onChange]);

  function firstTarget(aggregate: Aggregate, candidates: PropertyDef[]): string {
    if (allowsTarget(aggregate, "text")) {
      return TITLE_COLUMN;
    }
    return candidates.find((property) => allowsTarget(aggregate, property.format))?.key ?? "";
  }

  function changeKind(kind: AuthoringKind) {
    if (kind === draft.kind) {
      return;
    }
    if (kind === "stored") {
      const format = isStoredFormat(draft.format) ? draft.format : "text";
      onChange({ ...draft, kind, format });
      return;
    }
    if (kind === "formula") {
      const format = isStoredFormat(draft.format) ? draft.format : "text";
      onChange({ ...draft, kind, format });
      return;
    }
    const relationKey = draft.relation || relations[0]?.key || "";
    const nextRelation = relations.find(
      (property) => property.key === relationKey,
    );
    const nextTarget = knownTypes.find(
      (candidate) => candidate.key === nextRelation?.target_type,
    );
    const candidates = writableProperties(
      nextTarget ? effectiveProperties(nextTarget, library) : library,
    );
    const property =
      draft.property !== TITLE_COLUMN &&
      candidates.some(
        (candidate) =>
          candidate.key === draft.property &&
          allowsTarget(draft.aggregate, candidate.format),
      )
        ? draft.property
        : firstTarget(draft.aggregate, candidates);
    const nextTargetFormat =
      property === TITLE_COLUMN
        ? "text"
        : candidates.find((candidate) => candidate.key === property)?.format;
    onChange({
      ...draft,
      kind,
      relation: relationKey,
      property,
      format:
        rollupResultFormat(draft.aggregate, nextTargetFormat) ?? "number",
    });
  }

  function changeRelation(key: string) {
    const candidates = writableProperties(library);
    const property =
      draft.property !== TITLE_COLUMN &&
      candidates.some(
        (candidate) =>
          candidate.key === draft.property &&
          allowsTarget(draft.aggregate, candidate.format),
      )
        ? draft.property
        : firstTarget(draft.aggregate, candidates);
    onChange({ ...draft, relation: key, property });
  }

  function changeAggregate(aggregate: Aggregate) {
    const keep =
      draft.property === TITLE_COLUMN
        ? allowsTarget(aggregate, "text")
          ? TITLE_COLUMN
          : ""
        : target && allowsTarget(aggregate, target.format)
          ? draft.property
          : "";
    const property = keep || firstTarget(aggregate, targetCandidates);
    const nextTargetFormat =
      property === TITLE_COLUMN
        ? "text"
        : targetCandidates.find((candidate) => candidate.key === property)?.format;
    onChange({
      ...draft,
      aggregate,
      property,
      format: rollupResultFormat(aggregate, nextTargetFormat) ?? draft.format,
    });
  }

  const formatSelect =
    draft.kind === "formula"
      ? FORMULA_RESULTS
      : derivedFormat
        ? [derivedFormat]
        : RANGE_RESULTS;
  const problemField = problem?.field ?? "";
  const expressionProblem =
    problemField === "compute.expression" ? (problem?.message ?? null) : null;
  const relationProblem =
    problemField === "compute.relation" ? (problem?.message ?? null) : null;
  const aggregateProblem =
    problemField === "compute.aggregate" ? (problem?.message ?? null) : null;
  const targetProblem =
    problemField === "compute.property" ? (problem?.message ?? null) : null;
  const formatProblem = problemField === "format" ? (problem?.message ?? null) : null;
  const kindProblem =
    problemField === "compute" || problemField === "compute.kind"
      ? (problem?.message ?? null)
      : null;
  const otherProblem =
    problem &&
    ![
      "compute",
      "compute.kind",
      "compute.expression",
      "compute.relation",
      "compute.aggregate",
      "compute.property",
      "format",
    ].includes(problemField)
      ? problem.message
      : null;

  return (
    <div className="grid gap-3">
      {existing ? null : (
        <div className="grid gap-1.5">
          <div
            role="radiogroup"
            aria-label="Value kind"
            className="grid grid-cols-3 gap-1.5"
          >
            {KIND_CHOICES.map((choice) => {
              const selected = draft.kind === choice.value;
              return (
                <button
                  key={choice.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  tabIndex={selected ? 0 : -1}
                  disabled={frozen}
                  onClick={() => changeKind(choice.value)}
                  onKeyDown={(event) => {
                    const next = radioTargetIndex(
                      event.key,
                      KIND_CHOICES.indexOf(choice),
                      KIND_CHOICES.length,
                    );
                    if (next === null) {
                      return;
                    }
                    event.preventDefault();
                    const buttons = Array.from(
                      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                        '[role="radio"]',
                      ) ?? [],
                    );
                    buttons[next]?.focus();
                    changeKind(KIND_CHOICES[next]!.value);
                  }}
                  className={cn(
                    "min-h-9 rounded-[12px] border px-2.5 text-[13px] transition-colors pointer-coarse:min-h-11",
                    selected
                      ? "border-accent/60 bg-accent-wash text-accent-on-wash"
                      : "border-line-interactive/70 bg-raised/30 text-ink hover:border-line-strong",
                  )}
                >
                  {choice.label}
                </button>
              );
            })}
          </div>
          <p aria-live="polite" className="text-[12px] leading-4 text-muted">
            {KIND_STORY[draft.kind]}
          </p>
        </div>
      )}

      {draft.kind === "stored" ? (
        renderStoredFormat ? (
          renderStoredFormat(frozen)
        ) : (
          <SelectField
            label="Format"
            id={`${idPrefix}-format`}
            value={draft.format}
            disabled={frozen}
            options={STORED_FORMATS.map(({ value, label }) => ({ value, label }))}
            onValueChange={(value) =>
              onChange({ ...draft, format: value as PropertyFormat })
            }
          />
        )
      ) : (
        <>
          {draft.kind === "formula" ? (
            <>
              <div className="[&_textarea]:font-mono [&_textarea]:text-[12px]">
                <TextAreaField
                  label="Expression"
                  name={`${idPrefix}-expression`}
                  rows={4}
                  maxLength={MAX_FORMULA_LEN}
                  spellCheck={false}
                  autoCapitalize="none"
                  autoComplete="off"
                  disabled={disabled}
                  ref={expressionRef}
                  value={draft.expression}
                  placeholder="days(last_completed_at, today())"
                  error={expressionProblem ?? undefined}
                  hint={`${draft.expression.length} of ${MAX_FORMULA_LEN} characters.`}
                  onChange={(event) => {
                    setCaret(event.target.selectionStart ?? event.target.value.length);
                    onChange({ ...draft, expression: event.target.value });
                  }}
                  onSelect={(event) =>
                    setCaret(event.currentTarget.selectionStart ?? 0)
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Tab" && !event.shiftKey && hints[0]) {
                      event.preventDefault();
                      applyHint(hints[0]);
                    }
                  }}
                />
              </div>
              {!disabled && hints.length > 0 ? (
                <div
                  aria-label="Formula suggestions"
                  className="flex flex-wrap items-center gap-1.5"
                >
                  <span className="label text-faint">Insert</span>
                  {hints.map((hint) => (
                    <button
                      key={`${hint.kind}:${hint.value}`}
                      type="button"
                      title={
                        hint.kind === "property"
                          ? `${hint.label} (${hint.value})`
                          : hint.kind === "function"
                            ? `Function ${hint.value}`
                            : `Keyword ${hint.value}`
                      }
                      className="rounded-full border border-line-interactive/70 px-2 py-1 font-mono text-[11px] text-muted transition-colors hover:border-line-strong hover:text-ink pointer-coarse:min-h-11"
                      onClick={() => applyHint(hint)}
                    >
                      {hint.value}
                      {hint.kind === "function" ? "()" : ""}
                    </button>
                  ))}
                </div>
              ) : null}
              <details className="rounded-[12px] border border-line/80 bg-raised/30 px-3 py-2 text-[12px]">
                <summary className="cursor-pointer text-muted pointer-coarse:flex pointer-coarse:min-h-11 pointer-coarse:items-center">
                  Formula help
                </summary>
                <p className="mt-2 max-w-[62ch] text-[12px] leading-5 text-muted">
                  Name a field by its key, or write a number, quoted text,{" "}
                  <span className="font-mono">true</span> or{" "}
                  <span className="font-mono">false</span>. Operators:{" "}
                  <span className="font-mono">+ - * / %</span>,{" "}
                  <span className="font-mono">= != &lt; &lt;= &gt; &gt;=</span>,{" "}
                  <span className="font-mono">and</span>,{" "}
                  <span className="font-mono">or</span>,{" "}
                  <span className="font-mono">not</span>.
                </p>
                <p className="mt-3 label text-faint">Fields this type can read</p>
                <ul className="mt-1 flex flex-wrap gap-1.5">
                  {references.map((reference) => (
                    <li key={reference.key}>
                      <button
                        type="button"
                        disabled={disabled}
                        title={`Insert ${reference.name} (${reference.key})`}
                        className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-line-interactive/70 px-2 py-1 text-[11px] text-muted transition-colors hover:border-line-strong hover:text-ink pointer-coarse:min-h-11"
                        onClick={() =>
                          applyHint({
                            value: reference.key,
                            label: reference.name,
                            kind: "property",
                          })
                        }
                      >
                        <span className="font-mono text-ink">{reference.key}</span>
                        <span className="text-faint">
                          {formatLabel(reference.format)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 label text-faint">Functions</p>
                <ul className="mt-1 grid gap-0.5">
                  {FORMULA_FUNCTIONS.map((name) => {
                    const help = FUNCTION_HELP[name];
                    return (
                      <li key={name}>
                        <button
                          type="button"
                          disabled={disabled}
                          title={`Insert ${help.signature}`}
                          className="flex w-full flex-wrap items-baseline gap-x-2 rounded-[8px] px-1 py-1 text-left text-[12px] text-muted transition-colors hover:bg-raised hover:text-ink pointer-coarse:min-h-11"
                          onClick={() =>
                            applyHint({
                              value: name,
                              label: name,
                              kind: "function",
                            })
                          }
                        >
                          <span className="font-mono text-ink">{help.signature}</span>
                          <span>{help.story}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-3 label text-faint">Examples</p>
                <ul className="mt-1 flex flex-wrap gap-1.5">
                  {FORMULA_EXAMPLES.map((example) => (
                    <li key={example.expression}>
                      <button
                        type="button"
                        disabled={disabled}
                        className="rounded-full border border-line-interactive/70 px-2 py-1 font-mono text-[11px] text-muted transition-colors hover:border-line-strong hover:text-ink pointer-coarse:min-h-11"
                        onClick={() =>
                          onChange({
                            ...draft,
                            expression: example.expression,
                            format: example.format,
                          })
                        }
                      >
                        {example.expression}
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            </>
          ) : (
            <>
              {relations.length === 0 ? (
                <p className="max-w-[62ch] rounded-[12px] bg-raised/30 px-3 py-2 text-[12px] leading-5 text-muted">
                  This type has no relation column, so there are no linked records to summarise.
                  Add a relation property to this type first — choose{" "}
                  <span className="text-ink">Stored</span> and the Relation format — then
                  create the rollup.
                </p>
              ) : (
                <>
                  {existing ? (
                    <p className="max-w-[62ch] rounded-[12px] bg-raised/30 px-3 py-2 text-[12px] leading-5 text-muted">
                      A rollup reads the records one relation points at and returns one value
                      per record. It is read-only.
                    </p>
                  ) : null}
                  <div className="grid gap-1.5">
                    <PropertyPicker
                      label="Relation"
                      title="Choose a relation"
                      placeholder="Choose a relation"
                      properties={relations}
                      value={draft.relation || null}
                      onChange={changeRelation}
                      disabled={disabled}
                    />
                    {relationProblem ? <FormError message={relationProblem} /> : null}
                  </div>
                  <div
                    className={cn(
                      "grid gap-3",
                      draft.aggregate === "count" ? undefined : "sm:grid-cols-2",
                    )}
                  >
                    <SelectField
                      label="Aggregate"
                      id={`${idPrefix}-aggregate`}
                      value={draft.aggregate}
                      disabled={disabled}
                      error={aggregateProblem}
                      options={AGGREGATES.map(({ value, label }) => ({
                        value,
                        label,
                      }))}
                      hint={ROLLUP_STORY[draft.aggregate]}
                      onValueChange={(value) => changeAggregate(value as Aggregate)}
                    />
                    {draft.aggregate === "count" ? null : (
                      <div className="grid gap-1.5">
                        <PropertyPicker
                          label="Target property"
                          title="Choose a target property"
                          placeholder="Choose a target property"
                          properties={[
                            ...(allowsTarget(draft.aggregate, "text")
                              ? [
                                  {
                                    key: TITLE_COLUMN,
                                    name: "Title",
                                    format: "text" as PropertyFormat,
                                  },
                                ]
                              : []),
                            ...targetProperties,
                          ]}
                          value={draft.property || null}
                          onChange={(key) => onChange({ ...draft, property: key })}
                          disabled={disabled}
                          meta={(property) => property.key}
                        />
                        {targetProblem ? <FormError message={targetProblem} /> : null}
                      </div>
                    )}
                  </div>
                  {draft.aggregate !== "count" &&
                  !allowsTarget(draft.aggregate, "text") &&
                  targetProperties.length === 0 ? (
                    <p className="text-[12px] leading-4 text-muted">
                      The linked type has no stored{" "}
                      {draft.aggregate === "sum"
                        ? "number"
                        : "number, date or date-time"}{" "}
                      property to use. Add one to that type first.
                    </p>
                  ) : null}
                </>
              )}
            </>
          )}

          {existing || (draft.kind === "rollup" && relations.length === 0) ? null : derivedFormat ? (
            <div className="grid gap-1.5">
              <span className="label">Result type</span>
              <p className="flex min-h-[var(--field-fine)] items-center rounded-[10px] border border-line/80 bg-raised/20 px-[var(--space-3)] font-mono text-[12px] text-muted">
                {formatLabel(derivedFormat)}
              </p>
              <p className="text-[12px] leading-4 text-muted">
                Follows the aggregate and its target.
              </p>
              {formatProblem ? <FormError message={formatProblem} /> : null}
            </div>
          ) : (
            <SelectField
              label="Result type"
              id={`${idPrefix}-result`}
              value={draft.format}
              disabled={disabled}
              error={formatProblem}
              options={formatSelect.map((format) => ({
                value: format,
                label: formatLabel(format),
              }))}
              onValueChange={(value) =>
                onChange({ ...draft, format: value as PropertyFormat })
              }
              hint={
                draft.kind === "formula"
                  ? "What the expression returns; the server checks it matches."
                  : undefined
              }
            />
          )}
        </>
      )}

      {kindProblem || otherProblem ? (
        <FormError message={kindProblem ?? otherProblem} />
      ) : null}
    </div>
  );
}
