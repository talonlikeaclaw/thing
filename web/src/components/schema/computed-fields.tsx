import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import type {
  Aggregate,
  ComputeDef,
  PropertyDef,
  PropertyFormat,
  TypeDef,
} from "@/api/types";
import { SelectField, TextAreaField } from "@/components/ui/controls";
import { cn } from "@/lib/cn";
import {
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

const FORMULA_EXAMPLES = [
  "days(last_completed_at, today())",
  "price * quantity",
  'if(stock > 0, "In stock", "Out")',
];

const KIND_CHOICES: { value: AuthoringKind; label: string }[] = [
  { value: "stored", label: "Stored" },
  { value: "formula", label: "Formula" },
  { value: "rollup", label: "Rollup" },
];

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
  if (draft.kind === "rollup" && draft.relation === "") {
    return "Choose a relation.";
  }
  return null;
}

interface ComputedFieldsProps {
  draft: ComputedDraft;
  onChange: (draft: ComputedDraft) => void;
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
  idPrefix,
  renderStoredFormat,
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

  const targetType = useMemo(() => {
    const key = relation?.target_type;
    if (!key) {
      return undefined;
    }
    return [type, ...(types ?? [])].find((candidate) => candidate?.key === key);
  }, [relation, type, types]);

  const targetProperties = useMemo(() => {
    const candidates = targetType
      ? effectiveProperties(targetType, library)
      : library;
    return writableProperties(candidates);
  }, [targetType, library]);

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
        .map((property) => ({ key: property.key, name: property.name })),
      { key: TITLE_COLUMN, name: "Title" },
    ];
  }, [type, library]);

  const expressionRef = useRef<HTMLTextAreaElement | null>(null);
  const [caret, setCaret] = useState(0);
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
    const nextTarget = [type, ...(types ?? [])].find(
      (candidate) => candidate?.key === nextRelation?.target_type,
    );
    const property = draft.property || TITLE_COLUMN;
    const candidates = nextTarget
      ? effectiveProperties(nextTarget, library)
      : library;
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
    const nextRelation = relations.find((property) => property.key === key);
    const nextTarget = [type, ...(types ?? [])].find(
      (candidate) => candidate?.key === nextRelation?.target_type,
    );
    const candidates = writableProperties(
      nextTarget ? effectiveProperties(nextTarget, library) : library,
    );
    const property = candidates.some(
      (candidate) => candidate.key === draft.property,
    )
      ? draft.property
      : TITLE_COLUMN;
    onChange({ ...draft, relation: key, property });
  }

  const formatSelect =
    draft.kind === "formula"
      ? FORMULA_RESULTS
      : derivedFormat
        ? [derivedFormat]
        : RANGE_RESULTS;

  return (
    <div className="grid gap-3">
      {existing ? null : (
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
                disabled={frozen}
                onClick={() => changeKind(choice.value)}
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
                <summary className="cursor-pointer text-muted">Formula help</summary>
                <p className="mt-2 max-w-[62ch] text-[12px] leading-5 text-muted">
                  Reference keys like <span className="font-mono">price</span> or{" "}
                  <span className="font-mono">title</span>. Use{" "}
                  <span className="font-mono">+ - * / %</span>, comparisons,{" "}
                  <span className="font-mono">and</span>,{" "}
                  <span className="font-mono">or</span> and{" "}
                  <span className="font-mono">not</span>. Functions:{" "}
                  <span className="font-mono">
                    if, round, abs, min, max, length, lower, upper, days, today
                  </span>
                  .
                </p>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {FORMULA_EXAMPLES.map((example) => (
                    <li key={example}>
                      <button
                        type="button"
                        disabled={disabled}
                        className="rounded-full border border-line-interactive/70 px-2 py-1 font-mono text-[11px] text-muted transition-colors hover:border-line-strong hover:text-ink pointer-coarse:min-h-11"
                        onClick={() =>
                          onChange({ ...draft, expression: example })
                        }
                      >
                        {example}
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            </>
          ) : (
            <>
              <p className="max-w-[62ch] rounded-[12px] bg-raised/30 px-3 py-2 text-[12px] leading-5 text-muted">
                A rollup summarises the records this row links to. Choose the
                relation that holds those links, then what to do with each
                linked record: how many there are, the highest price, or their
                titles as one list.
              </p>
              <SelectField
                label="Relation"
                id={`${idPrefix}-relation`}
                value={draft.relation}
                disabled={disabled}
                options={
                  relations.length > 0
                    ? relations.map((property) => ({
                        value: property.key,
                        label: property.name,
                      }))
                    : [{ value: "", label: "No relation properties" }]
                }
                onValueChange={changeRelation}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <SelectField
                  label="Aggregate"
                  id={`${idPrefix}-aggregate`}
                  value={draft.aggregate}
                  disabled={disabled}
                  options={AGGREGATES.map(({ value, label }) => ({
                    value,
                    label,
                  }))}
                  hint={ROLLUP_STORY[draft.aggregate]}
                  onValueChange={(value) =>
                    onChange({ ...draft, aggregate: value as Aggregate })
                  }
                />
                <SelectField
                  label="Target property"
                  id={`${idPrefix}-target`}
                  value={draft.property}
                  disabled={disabled || draft.aggregate === "count"}
                  options={[
                    { value: TITLE_COLUMN, label: "Title" },
                    ...targetProperties.map((property) => ({
                      value: property.key,
                      label: property.name,
                    })),
                  ]}
                  onValueChange={(value) =>
                    onChange({ ...draft, property: value })
                  }
                  hint={
                    draft.aggregate === "count"
                      ? "Count needs no target property."
                      : undefined
                  }
                />
              </div>
            </>
          )}

          {existing ? null : (
            <SelectField
              label="Result type"
              id={`${idPrefix}-result`}
              value={draft.format}
              disabled={disabled || derivedFormat !== undefined}
              options={formatSelect.map((format) => ({
                value: format,
                label: formatLabel(format),
              }))}
              onValueChange={(value) =>
                onChange({ ...draft, format: value as PropertyFormat })
              }
              hint={
                derivedFormat
                  ? "Follows the aggregate and its target."
                  : undefined
              }
            />
          )}
        </>
      )}
    </div>
  );
}
