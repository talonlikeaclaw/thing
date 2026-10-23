import { ApiError } from "@/api/client";

/** The tail of a UUID: enough to recognise the entry, short enough to scan. */
export function shortId(id: string): string {
  return id.slice(-6);
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(iso));
}

/** An instant as the reader's browser shows it; a malformed value reads as itself. */
export function formatDateTime(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) {
    return iso;
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(at);
}

/** The server's own sentence for a refusal, or a plain fallback. */
export function readError(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Something went wrong. Retry in a moment.";
}

export interface ApiProblem {
  row?: number;
  field?: string;
  message: string;
}

/**
 * The row- and field-level problems the server put in `details.errors`.
 *
 * A form shows these next to the control they name; `readError` stays the
 * one-sentence summary for headings and toasts.
 */
export function readApiProblems(error: unknown): ApiProblem[] {
  if (!(error instanceof ApiError)) {
    return [];
  }
  const details = error.details;
  const problems: ApiProblem[] = [];
  if (Array.isArray(details.errors)) {
    for (const entry of details.errors) {
      if (typeof entry !== "object" || entry === null) {
        continue;
      }
      const record = entry as Record<string, unknown>;
      const problem: ApiProblem = {
        message: typeof record.message === "string" ? record.message : error.message,
      };
      if (typeof record.row === "number" && Number.isFinite(record.row)) {
        problem.row = record.row;
      }
      if (typeof record.field === "string" && record.field !== "") {
        problem.field = record.field;
      }
      problems.push(problem);
    }
  }
  if (problems.length === 0 && typeof details.field === "string" && details.field !== "") {
    problems.push({ field: details.field, message: error.message });
  }
  return problems;
}

/** How many records a partially failed import wrote before it stopped. */
export function readApiCreated(error: unknown): number | undefined {
  if (!(error instanceof ApiError)) {
    return undefined;
  }
  const created = (error.details as { created?: unknown }).created;
  if (Array.isArray(created)) {
    return created.length;
  }
  if (typeof created === "number" && Number.isFinite(created)) {
    return created;
  }
  return undefined;
}
