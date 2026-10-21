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
