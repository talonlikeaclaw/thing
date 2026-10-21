import type {
  PropertyDef,
  RecurrenceKind,
  RecurrenceValue,
  ScheduleLabels,
  ScheduleState,
  ScheduleStatus,
} from "@/api/types";

/** The generated property keys every scheduled type exposes. Never declared. */
export const SCHEDULE_KEYS = ["due_date", "recurrence", "last_completed_at"] as const;

/** The generated definitions, for a type whose flag was flipped before saving. */
export const SCHEDULE_PROPERTY_DEFS: PropertyDef[] = [
  { key: "due_date", name: "Due", format: "date" },
  { key: "recurrence", name: "Repeats", format: "recurrence" },
  { key: "last_completed_at", name: "Last completed", format: "datetime" },
];

export function isScheduleKey(key: string): boolean {
  return (SCHEDULE_KEYS as readonly string[]).includes(key);
}

function labelField(key: string): keyof ScheduleLabels | undefined {
  switch (key) {
    case "due_date":
      return "due";
    case "recurrence":
      return "recurrence";
    case "last_completed_at":
      return "last_completed";
    default:
      return undefined;
  }
}

/** A generated property's display name, preferring the type's own label. */
export function scheduleLabel(
  labels: ScheduleLabels | undefined,
  key: string,
  fallback: string,
): string {
  const field = labelField(key);
  const label = field === undefined ? undefined : labels?.[field];
  return label && label.trim() !== "" ? label : fallback;
}

/** Applies a type's labels to generated definitions, leaving keys untouched. */
export function labeledScheduleProperties(
  defs: PropertyDef[],
  labels: ScheduleLabels | undefined,
): PropertyDef[] {
  return defs.map((property) => ({
    ...property,
    name: scheduleLabel(labels, property.key, property.name),
  }));
}

export function completeLabel(labels: ScheduleLabels | undefined): string {
  return labels?.complete?.trim() || "Complete";
}

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export function weekdayName(index: number): string {
  return WEEKDAYS[index] ?? "";
}

/** Whether a JSON-shaped value is a recurrence the server would accept. */
export function isRecurrenceValue(value: unknown): value is RecurrenceValue {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const draft = value as Partial<RecurrenceValue>;
  return (
    (draft.kind === "days" || draft.kind === "weekly" || draft.kind === "monthly") &&
    typeof draft.every === "number"
  );
}

/** The same sentence the server renders, so a cell and a label never disagree. */
export function recurrenceSummary(value: unknown): string {
  if (!isRecurrenceValue(value)) {
    return "";
  }
  switch (value.kind) {
    case "days":
      return value.every === 1 ? "Every day" : `Every ${value.every} days`;
    case "weekly": {
      const name = value.weekday === undefined ? "" : weekdayName(value.weekday);
      const on = name ? ` on ${name}` : "";
      return value.every === 1 ? `Every week${on}` : `Every ${value.every} weeks${on}`;
    }
    case "monthly": {
      const on = value.day === undefined ? "" : ` on day ${value.day}`;
      return value.every === 1 ? `Every month${on}` : `Every ${value.every} months${on}`;
    }
  }
}

/** The editor's controls: numbers stay text so a half-typed value is not lost. */
export interface RecurrenceDraft {
  kind: RecurrenceKind;
  every: string;
  weekday: string;
  day: string;
}

export function recurrenceDraft(value: unknown): RecurrenceDraft {
  if (!isRecurrenceValue(value)) {
    return { kind: "days", every: "1", weekday: "", day: "" };
  }
  return {
    kind: value.kind,
    every: String(value.every),
    weekday: value.weekday === undefined ? "" : String(value.weekday),
    day: value.day === undefined ? "" : String(value.day),
  };
}

export type RecurrenceResult =
  | { ok: true; value: RecurrenceValue }
  | { ok: false; error: string };

function wholeInRange(text: string, low: number, high: number): number | undefined {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) {
    return undefined;
  }
  const number = Number(trimmed);
  return Number.isSafeInteger(number) && number >= low && number <= high ? number : undefined;
}

/** Applies the recurrence rules; invalid drafts keep the controls on screen. */
export function normalizeRecurrence(draft: RecurrenceDraft): RecurrenceResult {
  const every = wholeInRange(draft.every, 1, 1000);
  if (every === undefined) {
    return { ok: false, error: "The interval must be a whole number between 1 and 1000." };
  }
  switch (draft.kind) {
    case "days":
      return { ok: true, value: { kind: "days", every } };
    case "weekly": {
      const weekday = wholeInRange(draft.weekday, 0, 6);
      if (weekday === undefined) {
        return { ok: false, error: "Choose the weekday this repeat lands on." };
      }
      return { ok: true, value: { kind: "weekly", every, weekday } };
    }
    case "monthly": {
      const day = wholeInRange(draft.day, 1, 31);
      if (day === undefined) {
        return { ok: false, error: "The day of month must be between 1 and 31." };
      }
      return { ok: true, value: { kind: "monthly", every, day } };
    }
  }
}

export function recurrenceEquals(left: unknown, right: unknown): boolean {
  if (!isRecurrenceValue(left) || !isRecurrenceValue(right)) {
    return false;
  }
  return (
    left.kind === right.kind &&
    left.every === right.every &&
    left.weekday === right.weekday &&
    left.day === right.day
  );
}

/** The tone one due state carries; the only state colour on the page. */
export function dueTone(status: ScheduleStatus | undefined): string {
  switch (status) {
    case "overdue":
      return "text-danger";
    case "today":
      return "text-warning";
    case "upcoming":
      return "text-muted";
    case "done":
      return "text-muted";
    case "unscheduled":
      return "text-faint";
    default:
      return "";
  }
}

/** A due date's table label: relative while it matters, the date otherwise. */
export function dueCellLabel(schedule: ScheduleState | undefined, dueDate: unknown): string {
  if (typeof dueDate !== "string" || !schedule) {
    return typeof dueDate === "string" ? dueDate : "";
  }
  const days = schedule.days_until_due;
  if (schedule.status === "overdue" && days !== undefined) {
    return `Overdue ${Math.abs(days)}d`;
  }
  if (schedule.status === "today") {
    return "Today";
  }
  return dueDate;
}
