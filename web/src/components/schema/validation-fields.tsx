import { useState } from "react";

import type { PropertyFormat, PropertyValidation } from "@/api/types";
import { TextField } from "@/components/ui/controls";
import { cn } from "@/lib/cn";

/**
 * The unauthorised form of a validation block: every rule as the control holds
 * it. The stored block is [validationPayload], so an empty rule is never
 * written.
 */
export interface ValidationDraft {
  /** The lower bound as the control holds it, or `""` for none. */
  min: string;
  /** The upper bound as the control holds it, or `""` for none. */
  max: string;
  /** The pattern as written, or `""` for none. */
  pattern: string;
  unique: boolean;
}

/** Whether a format carries a lower and an upper bound. */
function bounded(format: PropertyFormat): boolean {
  return format === "number" || format === "date";
}

/** Whether a format carries a pattern. */
function patterned(format: PropertyFormat): boolean {
  return format === "text" || format === "url" || format === "email";
}

/** Whether a format stores one value, so uniqueness has a meaning. */
function uniqueApplies(format: PropertyFormat, multi: boolean): boolean {
  return (
    !multi &&
    format !== "multi_select" &&
    format !== "attachments" &&
    format !== "recurrence" &&
    format !== "list"
  );
}

/**
 * Whether a property has any rule to state: a bound, a pattern or uniqueness.
 * A multi-value format has none, so its editor offers no validation at all.
 */
export function validationApplies(format: PropertyFormat, multi = false): boolean {
  return bounded(format) || patterned(format) || uniqueApplies(format, multi);
}

/** The draft a property with no validation starts from. */
export function emptyValidationDraft(): ValidationDraft {
  return { min: "", max: "", pattern: "", unique: false };
}

/** The draft a stored block describes. */
export function validationDraft(
  validation: PropertyValidation | undefined,
): ValidationDraft {
  const draft = emptyValidationDraft();
  if (!validation) {
    return draft;
  }
  return {
    min: validation.min === undefined ? "" : String(validation.min),
    max: validation.max === undefined ? "" : String(validation.max),
    pattern: validation.pattern ?? "",
    unique: validation.unique ?? false,
  };
}

/**
 * One bound as the write carries it: a number for a number, the date text
 * otherwise, and nothing when the control is empty or holds no number.
 */
function boundValue(
  format: PropertyFormat,
  raw: string,
): number | string | undefined {
  const text = raw.trim();
  if (text === "") {
    return undefined;
  }
  if (format !== "number") {
    return text;
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * The block a write carries: absent when it would state no rule, and limited
 * to the fields the format can honour. `null` is the clear a PATCH sends; a
 * create leaves the field out.
 */
export function validationPayload(
  draft: ValidationDraft,
  format: PropertyFormat,
  multi = false,
): PropertyValidation | null {
  const validation: PropertyValidation = {};
  if (bounded(format)) {
    const min = boundValue(format, draft.min);
    if (min !== undefined) {
      validation.min = min;
    }
    const max = boundValue(format, draft.max);
    if (max !== undefined) {
      validation.max = max;
    }
  }

  if (patterned(format)) {
    const pattern = draft.pattern.trim();
    if (pattern !== "") {
      validation.pattern = pattern;
    }
  }
  if (draft.unique && uniqueApplies(format, multi)) {
    validation.unique = true;
  }
  return Object.keys(validation).length === 0 ? null : validation;
}

interface ValidationFieldsProps {
  draft: ValidationDraft;
  onChange: (draft: ValidationDraft) => void;
  /** The value's format: only a number or date carries a bound. */
  format: PropertyFormat;
  /** Whether the property holds several values, so uniqueness has no meaning. */
  multi?: boolean;
  disabled?: boolean;
  idPrefix: string;
  /** Open the disclosure on a property that already states a rule. */
  initialOpen?: boolean;
  /**
   * A disclosure in a capture form; the property page shows the fields bare,
   * under its own Validation row, so the section is never folded there.
   */
  disclosure?: boolean;
}

/**
 * The one authoring form for a property's validation. It is a disclosure
 * because most properties state no rule; a bound is offered for a number or a
 * date, a pattern for text, a URL or an email, and uniqueness for every format
 * that stores one value.
 */
export function ValidationFields({
  draft,
  onChange,
  format,
  multi = false,
  disabled,
  idPrefix,
  initialOpen = false,
  disclosure = true,
}: ValidationFieldsProps) {
  const [open, setOpen] = useState(initialOpen);
  if (!validationApplies(format, multi)) {
    return null;
  }
  const showsBounds = bounded(format);
  const showsPattern = patterned(format);
  const showsUnique = uniqueApplies(format, multi);

  function set<K extends keyof ValidationDraft>(key: K, value: ValidationDraft[K]) {
    onChange({ ...draft, [key]: value });
  }

  const body = (
    <div className={cn("grid gap-4", disclosure && "mt-2")}>
      {showsBounds ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label="Minimum"
            name={`${idPrefix}-validation-min`}
            type={format === "date" ? "date" : "number"}
            step={format === "number" ? "any" : undefined}
            value={draft.min}
            disabled={disabled}
            onChange={(event) => set("min", event.target.value)}
          />
          <TextField
            label="Maximum"
            name={`${idPrefix}-validation-max`}
            type={format === "date" ? "date" : "number"}
            step={format === "number" ? "any" : undefined}
            value={draft.max}
            disabled={disabled}
            onChange={(event) => set("max", event.target.value)}
          />
        </div>
      ) : null}

      {showsPattern ? (
        <TextField
          label="Pattern"
          name={`${idPrefix}-validation-pattern`}
          maxLength={200}
          value={draft.pattern}
          disabled={disabled}
          onChange={(event) => set("pattern", event.target.value)}
          placeholder="[A-Z]{2}-\\d{4}"
          hint="A regular expression matched in full, so the start and end are implied."
        />
      ) : null}

      {showsUnique ? (
        <label className="flex min-h-9 items-center gap-2 text-[13px] text-ink pointer-coarse:min-h-11">
          <input
            type="checkbox"
            checked={draft.unique}
            disabled={disabled}
            className="h-4 w-4 accent-[var(--color-accent)] pointer-coarse:h-5 pointer-coarse:w-5"
            onChange={(event) => set("unique", event.target.checked)}
          />
          One record per value
        </label>
      ) : null}

      <p className="text-[12px] leading-[1.5] text-muted">
        A value outside these rules is refused where it is written, in the cell and on
        the record.
      </p>
    </div>
  );

  if (!disclosure) {
    return body;
  }

  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="rounded-[12px] border border-line/70 bg-raised/30 px-3 py-2"
    >
      <summary className="label cursor-pointer py-1 select-none pointer-coarse:min-h-11">
        Validation
      </summary>
      {body}
    </details>
  );
}
