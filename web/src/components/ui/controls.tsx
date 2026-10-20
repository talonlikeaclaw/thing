import { Field } from "@base-ui/react/field";
import { Button as BaseButton } from "@base-ui/react/button";
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
          "h-10 w-full rounded-field border border-line bg-ground px-3 text-[15px] text-ink transition-colors pointer-coarse:h-11 pointer-coarse:text-[16px]",
          "hover:border-line-strong focus:border-accent",
          error && "border-danger",
        )}
        {...props}
      />
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
