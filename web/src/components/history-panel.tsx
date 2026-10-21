import { useState } from "react";

import { useHistory } from "@/api/queries";
import type { PropertyDef, Revision, RevisionAction } from "@/api/types";
import { MarkdownView } from "@/components/markdown-view";
import { Button, FormError } from "@/components/ui/controls";
import { cn } from "@/lib/cn";
import { readError } from "@/lib/display";
import { formatMoment, revisionDiff } from "@/lib/history";
import { valueLabel } from "@/lib/format";

interface HistoryPanelProps {
  spaceId: string;
  objectId: string;
  properties: PropertyDef[];
  /** Resolves a writer's UUID to a name; falls back to the short id. */
  memberName: (userId: string) => string;
}

/** A revision's identity: its number and the moment it was written. */
function keyOf(revision: Revision): string {
  return `${revision.rev}:${revision.at}`;
}

const ACTION_LABELS: Record<RevisionAction, string> = {
  create: "created",
  update: "saved",
  delete: "trashed",
  restore: "restored",
  complete: "completed",
};

/**
 * One record's history: every line, newest first, with the selected write
 * diffed against the snapshot before it. Read-only by design in M1.
 */
export function HistoryPanel({ spaceId, objectId, properties, memberName }: HistoryPanelProps) {
  const history = useHistory(spaceId, objectId);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const revisions = [...(history.data ?? [])].reverse();
  // Anchor a chosen line to its identity, so a later write does not slide the
  // selection onto a different revision. Without a choice, the newest is shown.
  const found = selectedKey === null ? -1 : revisions.findIndex((r) => keyOf(r) === selectedKey);
  const at = found >= 0 ? found : 0;
  const current = revisions[at];
  const previous = revisions[at + 1];
  const propertyByKey = new Map(properties.map((property) => [property.key, property]));
  const rows = current ? revisionDiff(current, previous) : [];

  return (
    <section aria-labelledby="history-heading" className="mt-10 border-t rule pt-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="history-heading" className="label">
          History
        </h2>
        <span className="label tnum">
          {history.data
            ? `${revisions.length} ${revisions.length === 1 ? "revision" : "revisions"}`
            : "reading"}
        </span>
      </div>

      {history.isError ? (
        <div className="mt-3 grid max-w-[52ch] gap-3">
          <FormError message={readError(history.error)} />
          <Button variant="ghost" className="w-fit" onClick={() => void history.refetch()}>
            Retry
          </Button>
        </div>
      ) : history.isPending ? (
        <p className="mt-3 text-[13px] text-muted">Reading the history…</p>
      ) : revisions.length === 0 ? (
        <p className="mt-3 text-[13px] text-muted">No revisions yet.</p>
      ) : current ? (
        <div className="mt-2 grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
          <ol className="max-h-[24rem] overflow-auto border-t rule">
            {revisions.map((revision, index) => {
              const active = index === at;
              return (
                <li key={`${revision.rev}:${revision.at}:${index}`} className="border-b rule">
                  <button
                    type="button"
                    aria-current={active ? "true" : undefined}
                    className={cn(
                      "grid w-full grid-cols-[4.5rem_minmax(0,1fr)] items-baseline gap-2 py-2 pr-1 text-left transition-colors hover:text-accent pointer-coarse:min-h-11",
                      active ? "text-accent" : "text-ink",
                    )}
                    onClick={() => setSelectedKey(keyOf(revision))}
                  >
                    <span className="font-mono text-[11px] tnum">rev {revision.rev}</span>
                    <span className="min-w-0">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="text-[13px]">{ACTION_LABELS[revision.action]}</span>
                        <span className="font-mono text-[10px] text-faint">
                          {formatMoment(revision.at)}
                        </span>
                      </span>
                      <span className="block text-[12px] text-muted">
                        {memberName(revision.by)}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>

          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="label">
                Revision {current.rev} · {ACTION_LABELS[current.action]}
              </span>
              <span className="font-mono text-[10px] text-faint">
                {formatMoment(current.at)} · {memberName(current.by)}
              </span>
            </div>

            <div className="mt-2 border-t rule">
              <div className="hidden gap-4 border-b rule py-1 sm:grid sm:grid-cols-[10rem_minmax(0,1fr)]">
                <span className="label">Property</span>
                <div className="grid grid-cols-2 gap-3">
                  <span className="label">Before</span>
                  <span className="label">After</span>
                </div>
              </div>
              {rows.map((row) => {
                const property = propertyByKey.get(row.key);
                return (
                  <div
                    key={row.key}
                    className="grid gap-1 border-b rule py-2 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4"
                  >
                    <div>
                      <span className="block text-[13px]">
                        {row.key === "title" ? "Title" : (property?.name ?? row.key)}
                      </span>
                      <span className="font-mono text-[10px] text-faint">{row.key}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <DiffValue
                        marker="−"
                        value={row.before}
                        field={row.key}
                        property={property}
                      />
                      <DiffValue
                        marker="+"
                        value={row.after}
                        field={row.key}
                        property={property}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {current.body !== undefined ? (
              <div className="mt-4">
                <span className="label">Body at this revision</span>
                <div className="mt-1 max-h-[18rem] overflow-auto rounded-field border border-line px-3">
                  <MarkdownView text={current.body} />
                </div>
              </div>
            ) : rows.length === 0 ? (
              <p className="mt-3 text-[13px] text-muted">
                No content changed; this line records the {current.action}.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function DiffValue({
  marker,
  value,
  field,
  property,
}: {
  marker: "−" | "+";
  value: unknown;
  field: string;
  property: PropertyDef | undefined;
}) {
  if (value === null || value === undefined) {
    return (
      <span className="flex items-baseline gap-1.5 text-[13px] text-faint">
        <span aria-hidden className="font-mono text-[11px]">
          {marker}
        </span>
        —
      </span>
    );
  }
  const text =
    field === "title" || !property
      ? valueLabel("text", value, undefined)
      : valueLabel(property.format, value, property);
  return (
    <span
      className={cn(
        "flex min-w-0 items-baseline gap-1.5 text-[13px]",
        marker === "+" ? "text-ink" : "text-muted",
        property?.format === "relation" && "font-mono text-[12px]",
        (property?.format === "number" ||
          property?.format === "date" ||
          property?.format === "datetime") &&
          "tnum",
      )}
    >
      <span className="sr-only">{marker === "+" ? "After" : "Before"}: </span>
      <span aria-hidden className="font-mono text-[11px] text-faint">
        {marker}
      </span>
      <span className="truncate" title={text}>
        {text}
      </span>
    </span>
  );
}
