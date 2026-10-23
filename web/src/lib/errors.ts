import { ApiError } from "@/api/client";
import { readError } from "@/lib/display";

export type ApiErrorKind =
  | "unauthenticated"
  | "forbidden"
  | "missing"
  | "retry"
  | "refused";

export interface ClassifiedError {
  kind: ApiErrorKind;
  title: string;
  message: string;
}

/**
 * One classification for every failed read or write.
 *
 * The caller decides where the result renders; this helper only decides what
 * kind of failure it is, so a page never mistakes a session probe failure for
 * a signed-out visitor or a network drop for an empty list.
 */
export function classifyError(error: unknown, subject = "This page"): ClassifiedError {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return {
        kind: "unauthenticated",
        title: "Sign in again",
        message: "Your session ended. Sign in to continue where you left off.",
      };
    }
    if (error.status === 403) {
      return {
        kind: "forbidden",
        title: "You don't have access",
        message: "Ask an owner of this space to give you access.",
      };
    }
    if (error.status === 404) {
      return {
        kind: "missing",
        title: `${subject} not found`,
        message: "It may have been deleted, or the link may be stale.",
      };
    }
    if (error.status === 0 || error.status >= 500) {
      return {
        kind: "retry",
        title: "Could not load right now",
        message: readError(error),
      };
    }
    return {
      kind: "refused",
      title: "The request was refused",
      message: readError(error),
    };
  }

  return {
    kind: "retry",
    title: "Could not load right now",
    message: readError(error),
  };
}
