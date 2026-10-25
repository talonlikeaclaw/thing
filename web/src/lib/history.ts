import type { Revision } from "@/api/types";

/** One property-level line of a revision's diff. */
export interface RevisionDiffRow {
  /** A property key, or `title` / `icon`. */
  key: string;
  /** The value before the write; `null` when the key did not exist. */
  before: unknown | null;
  after: unknown | null;
}

/**
 * What a revision changed, read from the stored snapshots.
 *
 * The server ships the keys each revision touched (`changed`); the previous
 * snapshot supplies the "before" side. The body is not in a snapshot — it is
 * carried whole by the revision that wrote it — so it is shown separately.
 */
export function revisionDiff(
  revision: Revision,
  previous: Revision | undefined,
): RevisionDiffRow[] {
  return revision.changed
    .filter((key) => key !== "body")
    .map((key) => {
      if (key === "title") {
        return {
          key,
          before: previous?.snapshot.title ?? null,
          after: revision.snapshot.title,
        };
      }
      if (key === "icon") {
        return {
          key,
          before: previous?.snapshot.icon ?? null,
          after: revision.snapshot.icon ?? null,
        };
      }
      return {
        key,
        before: previous?.snapshot.properties[key] ?? null,
        after: revision.snapshot.properties[key] ?? null,
      };
    });
}

/** A revision's timestamp with its clock time, in the space's zone. */
export function formatMoment(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    ...(timeZone ? { timeZone } : {}),
  }).format(new Date(iso));
}
