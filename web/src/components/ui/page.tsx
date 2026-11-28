import type { ReactNode } from "react";

import { ThumbRow } from "@/components/handedness";
import { cn } from "@/lib/cn";
import { useCompactWidth } from "@/lib/media";

interface PageHeaderProps {
  title: string;
  /** The title's mark, when the page has one. */
  icon?: ReactNode;
  /** One factual sentence; not a description of the page's own layout. */
  sentence?: ReactNode;
  /** A mono annotation at the title's trailing edge: a role, a count, a key. */
  meta?: ReactNode;
  /** The title row's trailing cluster: the page's chips and its main button; the chips first, the button at the edge. */
  titleActions?: ReactNode | ReactNode[];
  /** The row beneath the title: the filter, the page's buttons, or a day rail. Give it the full row to reach the thumb edge. */
  controls?: ReactNode;
  /** A page action below the sentence; canonical order with the primary at the thumb edge. */
  actions?: ReactNode | ReactNode[];
  /** The header's closing mono line: a count, a zone, a date. */
  line?: ReactNode;
  /** The line is a read in progress rather than the page's own fact. */
  settling?: boolean;
  /** Float under the shell while the page scrolls. Dates use it; forms and hashes do not. */
  sticky?: boolean;
  className?: string;
  controlsClassName?: string;
  actionsClassName?: string;
}

/**
 * The one page header: a glass card with the page's name, chips and main
 * button on the title row, its filter beneath at the thumb edge, and one
 * closing factual line. The Calendar, the Schedule and every quiet surface
 * read the same way; the type page keeps its own identity card because its
 * controls are a second surface.
 */
export function PageHeader({
  title,
  icon,
  sentence,
  meta,
  titleActions,
  controls,
  actions,
  line,
  settling = false,
  sticky = false,
  className,
  controlsClassName,
  actionsClassName,
}: PageHeaderProps) {
  const compact = useCompactWidth();
  const titleActionItems = Array.isArray(titleActions)
    ? titleActions
    : titleActions
      ? [titleActions]
      : [];
  const actionItems = Array.isArray(actions) ? actions : actions ? [actions] : [];

  return (
    <header
      className={cn(
        "glass rounded-[22px] px-4 py-3 sm:px-5 sm:py-4",
        sticky && "lg:sticky lg:top-[calc(var(--shell-header-h)+0.5rem)] lg:z-20",
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-[var(--space-4)] gap-y-[var(--space-2)]">
        <div className="flex min-w-0 flex-1 items-center gap-[var(--space-3)]">
          {icon}
          <h1 className="display text-display break-words">{title}</h1>
        </div>
        {meta || titleActionItems.length > 0 ? (
          <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-[var(--space-3)] max-sm:w-full">
            {meta ? <span className="label tnum shrink-0">{meta}</span> : null}
            {titleActionItems.length > 0 ? (
              <ThumbRow
                className={cn(
                  "flex-wrap items-center gap-[var(--space-2)]",
                  compact && "w-full",
                )}
              >
                {titleActionItems}
              </ThumbRow>
            ) : null}
          </div>
        ) : null}
      </div>
      {sentence ? (
        <p className="mt-[var(--space-2)] max-w-[62ch] text-[length:var(--text-small)] leading-[var(--text-small--line-height)] text-muted">
          {sentence}
        </p>
      ) : null}
      {controls || actionItems.length > 0 ? (
        <div className="mt-[var(--space-3)] flex flex-wrap items-center justify-between gap-[var(--space-2)]">
          {controls ? (
            <ThumbRow
              className={cn(
                "flex-wrap items-center gap-[var(--space-2)]",
                controlsClassName,
              )}
            >
              {controls}
            </ThumbRow>
          ) : null}
          {actionItems.length > 0 ? (
            <ThumbRow
              className={cn(
                "flex-wrap items-center gap-[var(--space-2)]",
                compact && "w-full",
                actionsClassName,
              )}
            >
              {actionItems}
            </ThumbRow>
          ) : null}
        </div>
      ) : null}
      {line ? (
        <p
          className="mt-2.5 flex flex-wrap items-baseline gap-x-[var(--space-2)] gap-y-[var(--space-1)] font-mono text-[12px] text-faint"
          aria-live={settling ? undefined : "polite"}
        >
          {line}
        </p>
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

interface GroupProps {
  /** The chapter's eyebrow; the controls answer it. */
  title: string;
  hint?: ReactNode;
  /** An anchor a deep link can scroll to. */
  id?: string;
  children: ReactNode;
  className?: string;
}

/**
 * One named group of a long schema form: the reader's decision first, then the
 * controls that answer it. A form stacks these under one hairline each, so the
 * body reads as chapters rather than one flat list.
 */
export function Group({ title, hint, id, children, className }: GroupProps) {
  return (
    <section id={id} className={cn("pt-4 pb-1", className)}>
      <h3 className="label">{title}</h3>
      {hint ? (
        <p className="mt-1 max-w-[52ch] text-[12px] leading-[1.5] text-muted">{hint}</p>
      ) : null}
      <div className="mt-1 grid">{children}</div>
    </section>
  );
}

/**
 * A group's controls that name themselves — a segment, a checkbox, a grid of
 * labelled fields. They sit flush with the section's eyebrow: a label gutter
 * with nothing in it reads as a hole, and these controls already carry their
 * own labels.
 */
export function GroupControl({ children }: { children: ReactNode }) {
  return <div className="py-3">{children}</div>;
}

/**
 * A property format or role marker: mono and pill-shaped. Quiet by default;
 * a caller tints it with the accent wash when it sits beside an accent property
 * name in the property-identity motif.
 */
export function FormatChip({
  children,
  className,
  title,
}: {
  children: ReactNode;
  className?: string;
  /** The full spelling, when the chip itself had to shorten it. */
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border border-line px-[var(--space-2)] py-0.5 font-mono text-[length:var(--text-label)] leading-[var(--text-label--line-height)] tracking-[0.09em] text-muted uppercase",
        className,
      )}
    >
      {children}
    </span>
  );
}
