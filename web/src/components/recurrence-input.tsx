import { useState } from "react";

import type { RecurrenceKind, RecurrenceValue } from "@/api/types";
import { useHandedness } from "@/components/handedness";
import { Button, InlineActions, inlineAction } from "@/components/ui/controls";
import { cn } from "@/lib/cn";
import {
  normalizeRecurrence,
  recurrenceDraft,
  weekdayName,
} from "@/lib/schedule";

interface RecurrenceInputProps {
  value: unknown;
  /** `null` clears the property; anything else is a validated mapping. */
  onApply: (value: RecurrenceValue | null) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
  /** Explain the early/late rule where the cadence is chosen, not in a filter. */
  showHint?: boolean;
}

const control =
  "h-8 rounded-[4px] border border-line-interactive bg-ground px-2 text-[13px] text-ink outline-none transition-colors hover:border-line-strong focus:border-accent pointer-coarse:h-11 pointer-coarse:text-[16px]";

const KIND_LABELS: Record<RecurrenceKind, string> = {
  days: "Days",
  weekly: "Weeks",
  monthly: "Months",
};

/** Repeats: a kind, an interval, and the one field that kind needs. */
export function RecurrenceInput({
  value,
  onApply,
  onCancel,
  autoFocus = false,
  showHint = true,
}: RecurrenceInputProps) {
  const { handedness } = useHandedness();
  const [draft, setDraft] = useState(() => recurrenceDraft(value));
  const [error, setError] = useState<string | null>(null);
  // Labels stay on the left; only the controls move to the thumb edge.
  const row = cn("flex items-center gap-2", handedness === "right" && "justify-between");

  function apply() {
    const result = normalizeRecurrence(draft);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    onApply(result.value);
  }

  function changeKind(kind: RecurrenceKind) {
    setError(null);
    setDraft((current) => ({
      ...current,
      kind,
      weekday: kind === "weekly" && current.weekday === "" ? "1" : current.weekday,
      day: kind === "monthly" && current.day === "" ? "1" : current.day,
    }));
  }

  return (
    <div className="grid min-w-[13rem] gap-1.5 rounded-field border border-line bg-surface p-2">
      <div className={row}>
        <span className="text-[12px] text-muted">Every</span>
        <div className="flex items-center gap-1.5">
        <input
          aria-label="Recurrence interval"
          autoFocus={autoFocus}
          className={cn(control, "w-16 tnum")}
          inputMode="numeric"
          min={1}
          max={1000}
          step={1}
          type="number"
          value={draft.every}
          onChange={(event) => {
            setError(null);
            setDraft((current) => ({ ...current, every: event.target.value }));
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              apply();
            }
            if (event.key === "Escape" && onCancel) {
              event.preventDefault();
              onCancel();
            }
          }}
        />
        <select
          aria-label="Recurrence unit"
          className={cn(control, "min-w-[6rem]")}
          value={draft.kind}
          onChange={(event) => changeKind(event.target.value as RecurrenceKind)}
        >
          {(Object.keys(KIND_LABELS) as RecurrenceKind[]).map((kind) => (
            <option key={kind} value={kind}>
              {KIND_LABELS[kind]}
            </option>
          ))}
        </select>
        </div>
      </div>

      {draft.kind === "weekly" ? (
        <label className={cn(row, "text-[12px] text-muted")}>
          on
          <select
            aria-label="Recurrence weekday"
            className={cn(control, "min-w-0 flex-1")}
            value={draft.weekday}
            onChange={(event) => {
              setError(null);
              setDraft((current) => ({ ...current, weekday: event.target.value }));
            }}
          >
            {Array.from({ length: 7 }, (_, index) => (
              <option key={index} value={String(index)}>
                {weekdayName(index)}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {draft.kind === "monthly" ? (
        <label className={cn(row, "text-[12px] text-muted")}>
          on day
          <input
            aria-label="Recurrence day of month"
            className={cn(control, "w-16 tnum")}
            inputMode="numeric"
            min={1}
            max={31}
            step={1}
            type="number"
            value={draft.day}
            onChange={(event) => {
              setError(null);
              setDraft((current) => ({ ...current, day: event.target.value }));
            }}
          />
        </label>
      ) : null}

      {error ? (
        <p role="alert" className="text-[12px] text-danger">
          {error}
        </p>
      ) : null}

      {showHint ? (
        <p className="max-w-[26rem] text-[12px] leading-snug text-faint">
          Completed late? The next date counts from today. Early completion keeps the planned
          date.
        </p>
      ) : null}

      <InlineActions>
        {value !== null && value !== undefined ? (
          <Button
            type="button"
            variant="ghost"
            className={inlineAction}
            onClick={() => onApply(null)}
          >
            Clear
          </Button>
        ) : null}
        {onCancel ? (
          <Button type="button" variant="ghost" className={inlineAction} onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button type="button" className={inlineAction} onClick={apply}>
          Apply
        </Button>
      </InlineActions>
    </div>
  );
}
