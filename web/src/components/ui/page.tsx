import type { ReactNode } from "react";

import { ThumbRow } from "@/components/handedness";
import { cn } from "@/lib/cn";

interface PageHeaderProps {
  title: string;
  /** One factual sentence; not a description of the page's own layout. */
  sentence?: ReactNode;
  /** A mono annotation at the title's trailing edge: a role, a count, a key. */
  meta?: ReactNode;
  /** At most one primary action. It follows the thumb edge. */
  actions?: ReactNode;
  className?: string;
}

/** The one page header every quiet surface shares. */
export function PageHeader({ title, sentence, meta, actions, className }: PageHeaderProps) {
  return (
    <header className={cn("border-b rule pb-[var(--space-4)]", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-[var(--space-4)] gap-y-[var(--space-1)]">
        <h1 className="display text-display break-words">{title}</h1>
        {meta ? <span className="label tnum shrink-0">{meta}</span> : null}
      </div>
      {sentence || actions ? (
        <div className="mt-[var(--space-2)] flex flex-wrap items-end justify-between gap-x-[var(--space-5)] gap-y-[var(--space-3)]">
          {sentence ? (
            <p className="max-w-[62ch] text-[length:var(--text-small)] leading-[var(--text-small--line-height)] text-muted">
              {sentence}
            </p>
          ) : null}
          {actions ? (
            <ThumbRow className="shrink-0 flex-wrap items-center gap-[var(--space-2)]">
              {actions}
            </ThumbRow>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}

interface SectionRuleProps {
  id?: string;
  title: ReactNode;
  /** h2 for a page section, h3 for a group inside one. */
  level?: 2 | 3;
  /** A mono count or annotation at the trailing edge. */
  count?: ReactNode;
  action?: ReactNode;
  tone?: "default" | "danger";
  className?: string;
}

/** The one hairline section rule: heading, optional count, optional action. */
export function SectionRule({
  id,
  title,
  level = 2,
  count,
  action,
  tone = "default",
  className,
}: SectionRuleProps) {
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <div
      className={cn(
        "flex flex-wrap items-baseline justify-between gap-x-[var(--space-3)] gap-y-[var(--space-1)] border-b pb-[var(--space-2)]",
        tone === "danger" ? "border-danger/60" : "rule",
        className,
      )}
    >
      <Heading
        id={id}
        className={cn(
          level === 2 ? "text-heading font-medium" : "text-[15px] font-medium",
          tone === "danger" && "text-danger",
        )}
      >
        {title}
      </Heading>
      {count !== undefined || action ? (
        <span className="flex items-baseline gap-[var(--space-3)]">
          {count !== undefined ? <span className="label tnum">{count}</span> : null}
          {action}
        </span>
      ) : null}
    </div>
  );
}

interface EmptyStateProps {
  /** Names what is missing and the next action. */
  sentence: ReactNode;
  action?: ReactNode;
  className?: string;
}

/** The one empty state: a sentence and, when there is one, the way forward. */
export function EmptyState({ sentence, action, className }: EmptyStateProps) {
  return (
    <div className={cn("py-[var(--space-4)]", className)}>
      <p className="max-w-[52ch] text-[length:var(--text-small)] leading-[var(--text-small--line-height)] text-muted">
        {sentence}
      </p>
      {action ? <div className="mt-[var(--space-3)]">{action}</div> : null}
    </div>
  );
}

interface FieldRowProps {
  /** The value column's label; `htmlFor` ties it to the control's id. */
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * One label/value row in a long editor: label in a fixed leading column, the
 * control beside it from `sm` up, stacked on a phone.
 */
export function FieldRow({ label, htmlFor, hint, children, className }: FieldRowProps) {
  const labelClass = "label sm:pt-[10px]";
  return (
    <div
      className={cn(
        "grid gap-[var(--space-1)] py-[var(--space-3)] sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-start sm:gap-[var(--space-6)]",
        className,
      )}
    >
      {htmlFor ? (
        <label className={labelClass} htmlFor={htmlFor}>
          {label}
        </label>
      ) : (
        <span className={labelClass}>{label}</span>
      )}
      <div className="grid min-w-0 gap-[var(--space-2)]">
        {children}
        {hint ? (
          <p className="text-[length:var(--text-small)] leading-[var(--text-small--line-height)] text-muted">
            {hint}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A property format or role marker: mono and pill-shaped. Quiet by default;
 * a caller tints it with the accent wash when it sits beside an accent property
 * name in the property-identity motif.
 */
export function FormatChip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border border-line px-[var(--space-2)] py-0.5 font-mono text-[length:var(--text-label)] leading-[var(--text-label--line-height)] tracking-[0.09em] text-muted uppercase",
        className,
      )}
    >
      {children}
    </span>
  );
}
