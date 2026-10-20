import { Field } from "@base-ui/react/field";
import { Button as BaseButton } from "@base-ui/react/button";
import { Select } from "@base-ui/react/select";
import { ChevronDown } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/cn";

type ButtonVariant = "primary" | "ghost";

const buttonStyles: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-accent-ink hover:brightness-105 active:brightness-95 disabled:hover:brightness-100",
  ghost: "border border-line text-ink hover:border-line-strong hover:bg-raised",
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

interface TextFieldProps extends Omit<ComponentProps<typeof Field.Control>, "className"> {
  label: string;
  error?: string;
  hint?: ReactNode;
}

const controlStyles =
  "w-full rounded-field border border-line bg-ground px-3 text-[15px] text-ink transition-colors pointer-coarse:text-[16px] hover:border-line-strong focus:border-accent";

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
