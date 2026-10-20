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
