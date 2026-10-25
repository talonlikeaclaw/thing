import { Field } from "@base-ui/react/field";
import { Button as BaseButton } from "@base-ui/react/button";
import { Select } from "@base-ui/react/select";
import { ChevronDown } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import { ThumbRow } from "@/components/handedness";
import { cn } from "@/lib/cn";

type ButtonVariant = "primary" | "ghost" | "danger";

const buttonStyles: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-accent-ink hover:brightness-105 active:brightness-95 disabled:hover:brightness-100",
  ghost: "border border-line-interactive text-ink hover:border-line-strong hover:bg-raised",
  danger: "border border-danger text-danger hover:bg-raised",
};

interface ButtonProps extends ComponentProps<typeof BaseButton> {
  variant?: ButtonVariant;
}

export function Button({ variant = "primary", className, ...props }: ButtonProps) {
  return (
    <BaseButton
      className={cn(
        "inline-flex min-h-10 items-center justify-center gap-2 rounded-field px-4 text-sm font-medium transition-[filter,background-color,border-color] disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:min-h-11",
        buttonStyles[variant],
        className,
      )}
      {...props}
    />
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
        "rounded-[3px] border border-line px-1.5 py-0.5 font-mono text-[10px] text-faint",
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
  "min-h-7 px-2 text-[12px] pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:text-[13px] max-sm:min-h-11 max-sm:min-w-11 max-sm:text-[13px]";

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
 * The save row of a long editor. It floats at the bottom of the viewport while
 * the editor is on screen, clearing the mobile tab bar, so a save is never a
 * scroll away; the translucent surface keeps the content beneath it readable.
 * The primary action follows the thumb edge like every other action row.
 */
export function StickyActionBar({ children }: { children: ReactNode }) {
  return (
    <ThumbRow className="sticky bottom-[calc(3.5rem_+_env(safe-area-inset-bottom))] z-20 mt-8 flex-wrap items-center gap-3 border-t rule bg-ground/95 py-3 backdrop-blur lg:bottom-0">
      {children}
    </ThumbRow>
  );
}

interface TextFieldProps extends Omit<ComponentProps<typeof Field.Control>, "className"> {
  label: ReactNode;
  error?: string;
  hint?: ReactNode;
}

const controlStyles =
  "w-full rounded-field border border-line-interactive bg-ground px-3 text-[15px] text-ink transition-colors pointer-coarse:text-[16px] hover:border-line-strong focus:border-accent";

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
        <p id={hintId} className="text-[13px] text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-[13px] text-danger">
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
      <Field.Label className="label" htmlFor={fieldId}>
        {label}
      </Field.Label>
      <Field.Control
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={cn(hintId, errorId) || undefined}
        className={cn(
          controlStyles,
          "h-10 pointer-coarse:h-11",
          error && "border-danger",
        )}
        {...props}
      />
      <FieldMessages hint={hint} error={error} hintId={hintId} errorId={errorId} />
    </Field.Root>
  );
}

interface TextAreaFieldProps extends Omit<ComponentProps<"textarea">, "className"> {
  label: string;
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
      <Field.Label className="label" htmlFor={fieldId}>
        {label}
      </Field.Label>
      <textarea
        id={fieldId}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={cn(hintId, errorId) || undefined}
        className={cn(controlStyles, "py-2 leading-[1.55]", error && "border-danger")}
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
          className={cn(controlStyles, "flex h-10 items-center justify-between gap-2 text-left pointer-coarse:h-11")}
        >
          <Select.Value />
          <Select.Icon className="text-muted">
            <ChevronDown aria-hidden size={16} />
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Positioner sideOffset={4} className="z-50">
            <Select.Popup className="max-h-64 min-w-[var(--anchor-width)] overflow-auto rounded-field border border-line bg-surface p-1 text-[14px]">
              {options.map((option) => (
                <Select.Item
                  key={option.value}
                  value={option.value}
                  className="cursor-pointer rounded-[4px] px-3 py-2 text-ink data-[highlighted]:bg-raised"
                >
                  <Select.ItemText>{option.label}</Select.ItemText>
                </Select.Item>
              ))}
            </Select.Popup>
          </Select.Positioner>
        </Select.Portal>
      </Select.Root>
      <FieldMessages hint={hint} hintId={hintId} />
    </Field.Root>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) {
    return null;
  }
  return (
    <p role="alert" className="border-l border-danger pl-3 text-[13px] text-danger">
      {message}
    </p>
  );
}
