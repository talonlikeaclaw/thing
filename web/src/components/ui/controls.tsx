import { Field } from "@base-ui/react/field";
import { Button as BaseButton } from "@base-ui/react/button";
import { Select } from "@base-ui/react/select";
import { ChevronDown } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import { ThumbRow } from "@/components/handedness";
import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "ghost" | "quiet" | "destructive";

const buttonStyles: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-accent-ink shadow-[0_8px_18px_-12px_rgba(0,0,0,0.55)] hover:brightness-105 active:brightness-95 aria-pressed:brightness-95 disabled:hover:brightness-100",
  ghost:
    "border border-line-interactive/70 bg-raised/40 text-ink hover:border-line-strong hover:bg-raised active:bg-raised aria-pressed:border-accent/60 aria-pressed:bg-accent-wash aria-pressed:text-accent-on-wash",
  quiet:
    "border border-transparent text-muted hover:bg-raised hover:text-ink active:bg-raised aria-pressed:bg-accent-wash aria-pressed:text-accent-on-wash",
  destructive:
    "border border-danger/70 text-danger hover:border-danger hover:bg-raised active:bg-raised",
};

/** The one focus treatment every control in the app inherits. */
export const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-accent";

interface ButtonProps extends ComponentProps<typeof BaseButton> {
  variant?: ButtonVariant;
  /** Blocks a second submit and exposes a busy state to assistive tech. */
  loading?: boolean;
}

export function Button({
  variant = "primary",
  loading = false,
  disabled,
  className,
  ...props
}: ButtonProps) {
  return (
    <BaseButton
      aria-busy={loading || undefined}
      data-loading={loading ? "" : undefined}
      disabled={disabled || loading}
      className={cn(
        "inline-flex min-h-[var(--control-standard)] items-center justify-center gap-[var(--space-2)] rounded-full px-[var(--space-4)] text-[length:var(--text-small)] leading-[var(--text-small--line-height)] font-medium transition-[filter,background-color,border-color,color,box-shadow] duration-[var(--duration-fast)] ease-[var(--ease-out)] disabled:cursor-not-allowed disabled:opacity-50 data-loading:cursor-wait pointer-coarse:min-h-[var(--control-coarse)]",
        focusRing,
        buttonStyles[variant],
        className,
      )}
      {...props}
    />
  );
}

/**
 * A circular action. The chrome's icon actions are circles — header utilities,
 * the dock, the command palette's close. `glass` is the resting material,
 * `quiet` a bare glyph on the parent surface, `accent` the one filled action.
 */
export function IconButton({
  label,
  size = 40,
  variant = "glass",
  active = false,
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof BaseButton>, "aria-label"> & {
  label: string;
  size?: number;
  variant?: "glass" | "quiet" | "accent";
  active?: boolean;
}) {
  const look =
    variant === "accent"
      ? "action-circle"
      : variant === "quiet"
        ? "text-muted hover:bg-raised hover:text-ink active:bg-raised"
        : "border border-glass-edge bg-glass text-ink shadow-[0_8px_22px_-16px_rgba(0,0,0,0.8)] backdrop-blur-xl backdrop-saturate-150 hover:bg-raised/70";
  return (
    <BaseButton
      aria-label={label}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full transition-[background-color,border-color,color,transform] duration-[var(--duration-fast)] ease-[var(--ease-out)] active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-40 pointer-coarse:min-h-11 pointer-coarse:min-w-11",
        look,
        active && "bg-accent-wash text-accent-on-wash",
        focusRing,
        className,
      )}
      style={{ width: size, height: size }}
      {...props}
    >
      {children}
    </BaseButton>
  );
}

/**
 * A shortcut cap beside a header action. The keys come from `SHORTCUTS`, so a
 * cap cannot advertise a binding the app does not register.
 */
export function Keycap({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "rounded-[6px] border border-line px-1.5 py-0.5 font-mono text-[length:var(--text-label)] leading-[var(--text-label--line-height)] text-faint",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/**
 * One button in a compact inline editor (a table cell, the cadence field, a
 * filter value). Dense for a mouse; a full-height target under a finger, even
 * when a narrow window reports a fine pointer.
 */
export const inlineAction =
  "min-h-[var(--control-fine)] px-[var(--space-2)] text-[12px] pointer-coarse:min-h-[var(--control-coarse)] pointer-coarse:min-w-11 pointer-coarse:text-[length:var(--text-small)] max-sm:min-h-[var(--control-coarse)] max-sm:min-w-11 max-sm:text-[length:var(--text-small)]";

/**
 * The action row of a compact editor. The primary action sits at the thumb
 * edge: call sites put dismissive actions first and the primary last, and
 * `ThumbRow` reverses the DOM in left-handed mode.
 */
export function InlineActions({ children }: { children: ReactNode }) {
  return (
    <ThumbRow className="flex-wrap items-center gap-1.5 border-t rule pt-1.5">
      {children}
    </ThumbRow>
  );
}

/**
 * The save row of a long editor. It is pinned above the tab bar so a save is
 * never a scroll away; from `lg` the record carries the same status and action
 * in its header, so this row is hidden there and never covers the links,
 * history or trash. The primary action follows the thumb edge.
 */
export function StickyActionBar({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <ThumbRow
      className={cn(
        "record-save-bar sticky z-20 mt-8 flex-wrap items-center gap-[var(--space-3)] py-[var(--space-3)]",
        className,
      )}
    >
      {children}
    </ThumbRow>
  );
}

interface TextFieldProps extends Omit<ComponentProps<typeof Field.Control>, "className"> {
  /** Omitted when a `FieldRow` supplies the visible label and ties it by `id`. */
  label?: ReactNode;
  error?: string;
  hint?: ReactNode;
}

/** The one field frame; every text, textarea and select control consumes it. */
export const fieldFrame = `w-full rounded-[10px] border border-line-interactive/70 bg-raised/40/70 bg-raised/40 px-[var(--space-3)] text-[length:var(--text-body)] leading-[var(--text-body--line-height)] text-ink transition-[border-color,background-color,color,box-shadow] duration-[var(--duration-fast)] ease-[var(--ease-out)] placeholder:text-faint hover:border-line-strong focus:border-accent aria-invalid:border-danger aria-invalid:focus:border-danger disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-line-interactive/70 read-only:text-muted pointer-coarse:text-[16px] ${focusRing}`;

function FieldMessages({
  hint,
  error,
  hintId,
  errorId,
}: {
  hint?: ReactNode;
  error?: string;
  hintId?: string;
  errorId?: string;
}) {
  return (
    <>
      {hint ? (
        <p id={hintId} className="text-[length:var(--text-small)] leading-[var(--text-small--line-height)] text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-[length:var(--text-small)] leading-[var(--text-small--line-height)] text-danger">
          {error}
        </p>
      ) : null}
    </>
  );
}

export function TextField({ label, error, hint, id, ...props }: TextFieldProps) {
  const fieldId = id ?? props.name;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;
  return (
    <Field.Root className="grid gap-1.5">
      {label ? (
        <Field.Label className="label" htmlFor={fieldId}>
          {label}
        </Field.Label>
      ) : null}
      <Field.Control
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={cn(hintId, errorId) || undefined}
        className={cn(
          fieldFrame,
          "h-[var(--field-fine)] pointer-coarse:h-[var(--field-coarse)]",
          error && "border-danger",
        )}
        {...props}
      />
      <FieldMessages hint={hint} error={error} hintId={hintId} errorId={errorId} />
    </Field.Root>
  );
}

interface TextAreaFieldProps extends Omit<ComponentProps<"textarea">, "className"> {
  /** Omitted when a `FieldRow` supplies the visible label and ties it by `id`. */
  label?: string;
  error?: string;
  hint?: ReactNode;
  rows?: number;
}

export function TextAreaField({
  label,
  error,
  hint,
  id,
  rows = 3,
  ...props
}: TextAreaFieldProps) {
  const fieldId = id ?? props.name;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;
  return (
    <Field.Root className="grid gap-1.5">
      {label ? (
        <Field.Label className="label" htmlFor={fieldId}>
          {label}
        </Field.Label>
      ) : null}
      <textarea
        id={fieldId}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={cn(hintId, errorId) || undefined}
        className={cn(
          fieldFrame,
          "min-h-[var(--field-fine)] py-[var(--space-2)] leading-[var(--text-body--line-height)] pointer-coarse:min-h-[var(--field-coarse)]",
          error && "border-danger",
        )}
        {...props}
      />
      <FieldMessages hint={hint} error={error} hintId={hintId} errorId={errorId} />
    </Field.Root>
  );
}

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectFieldProps {
  label: string;
  value: string;
  options: SelectOption[];
  onValueChange: (value: string) => void;
  id?: string;
  disabled?: boolean;
  hint?: ReactNode;
  /** The server's field-level refusal, named under the control it blocks. */
  error?: string | null;
}

/** A Base UI select with the same field frame as a text input. */
export function SelectField({
  label,
  value,
  options,
  onValueChange,
  id,
  disabled,
  hint,
  error,
}: SelectFieldProps) {
  const fieldId = id ?? label.toLowerCase().replaceAll(" ", "-");
  const hintId = hint ? `${fieldId}-hint` : undefined;
  return (
    <Field.Root className="grid gap-1.5">
      <Field.Label className="label" htmlFor={fieldId}>
        {label}
      </Field.Label>
      <Select.Root
        items={options}
        value={value}
        onValueChange={(next) => {
          if (next !== null) {
            onValueChange(next as string);
          }
        }}
        disabled={disabled}
      >
        <Select.Trigger
          id={fieldId}
          aria-invalid={error ? true : undefined}
          className={cn(
            fieldFrame,
            "flex h-[var(--field-fine)] items-center justify-between gap-[var(--space-2)] text-left pointer-coarse:h-[var(--field-coarse)]",
            error && "border-danger",
          )}
        >
          <Select.Value className="min-w-0 truncate" />
          <Select.Icon className="shrink-0 text-muted">
            <ChevronDown aria-hidden size={16} />
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Positioner sideOffset={4} className="z-50">
            <Select.Popup className="glass-strong max-h-64 min-w-[var(--anchor-width)] overflow-auto overscroll-contain rounded-card p-[var(--space-1)] text-[length:var(--text-small)] leading-[var(--text-small--line-height)]">
              {options.map((option) => (
                <Select.Item
                  key={option.value}
                  value={option.value}
                  className="cursor-pointer rounded-[10px] px-[var(--space-3)] py-[var(--space-2)] text-ink data-[highlighted]:bg-accent-wash data-[highlighted]:text-accent-on-wash"
                >
                  <Select.ItemText>{option.label}</Select.ItemText>
                </Select.Item>
              ))}
            </Select.Popup>
          </Select.Positioner>
        </Select.Portal>
      </Select.Root>
      <FieldMessages hint={hint} hintId={hintId} error={error ?? undefined} />
    </Field.Root>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) {
    return null;
  }
  return (
    <p role="alert" className="border-l border-danger pl-[var(--space-3)] text-[length:var(--text-small)] leading-[var(--text-small--line-height)] text-danger">
      {message}
    </p>
  );
}
