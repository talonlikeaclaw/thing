import { Copy, Trash2 } from "lucide-react";
import { useRef, useState } from "react";

import {
  useBulkDuplicateObjects,
  useBulkTrashObjects,
  useBulkUpdateObjects,
  type BulkResult,
} from "@/api/queries";
import type { ObjectSummary, PropertyDef, Uuid } from "@/api/types";
import { PropertyInput } from "@/components/property-input";
import { Button, FormError } from "@/components/ui/controls";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { readError } from "@/lib/display";

interface BulkBarProps {
  spaceId: string;
  /** Every member a table column may name, generated schedule keys included. */
  properties: PropertyDef[];
  /** The first property the current view shows, so step 1 starts on it. */
  initialPropertyKey: string;
  /** Members the type refuses to store empty; removing one would fail on every row. */
  requiredKeys: ReadonlySet<string>;
  /** The selected rows of the loaded page, with the revision they were read at. */
  rows: ObjectSummary[];
  /** The ids that failed stay selected for retry. */
  onResult: (failed: Uuid[]) => void;
  onClear: () => void;
  /** The open panel is taller than the bar; the table adds matching room. */
  onPanelChange: (open: boolean) => void;
  /**
   * Undo runs from the page, not this bar: the bar unmounts as soon as the
   * selection empties, and a mutation callback on an unmounted component never
   * fires its toast.
   */
  onUndoTrash: (ids: Uuid[]) => void;
  onUndoDuplicate: (ids: Uuid[]) => void;
}

const field =
  "h-8 rounded-[4px] border border-line-interactive bg-ground px-1.5 text-[12px] text-ink pointer-coarse:h-11 pointer-coarse:text-[16px]";

/**
 * The selection band. Bulk actions fan out over the per-object endpoints, so
 * every record keeps its own revision and a stale row fails alone.
 */
export function BulkBar({
  spaceId,
  properties,
  initialPropertyKey,
  requiredKeys,
  rows,
  onResult,
  onClear,
  onPanelChange,
  onUndoTrash,
  onUndoDuplicate,
}: BulkBarProps) {
  const toast = useToast();
  const update = useBulkUpdateObjects(spaceId);
  const duplicate = useBulkDuplicateObjects(spaceId);
  const trash = useBulkTrashObjects(spaceId);

  const [panelOpen, setPanelOpen] = useState(false);
  const [propertyKey, setPropertyKey] = useState(
    initialPropertyKey || properties[0]?.key || "",
  );
  const [draft, setDraft] = useState<{ value: unknown; label: string } | null>(null);
  // A held draft replaces the live editor with a summary, so moving focus to
  // Apply can't blur-cancel a select or relation before the click lands.
  const [editing, setEditing] = useState(true);
  // `PropertyInput` commits on blur, which can run just before the Apply click;
  // the ref makes that click see the value without a second press.
  const committed = useRef<{ value: unknown; label: string } | null>(null);
  const valueRef = useRef<HTMLDivElement | null>(null);
  const applyRef = useRef<HTMLButtonElement | null>(null);
  // An Enter or Space commit should land focus on Apply, not on the page body.
  const keyboardCommit = useRef(false);
  const [nonce, setNonce] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const chosen = properties.find((property) => property.key === propertyKey);
  const required = chosen !== undefined && requiredKeys.has(chosen.key);
  const targets = rows.map((row) => ({ id: row.id, rev: row.rev }));
  const busy = update.isPending || duplicate.isPending || trash.isPending;
  const count = rows.length;
  const status = !draft
    ? "Choose a value in step 2, then Apply."
    : draft.value === null
      ? required
        ? `${chosen?.name ?? "This property"} is required; choose a value instead.`
        : `Ready to remove ${chosen?.name ?? "the property"} from ${count} ${plural(count)}.`
      : `Ready to set ${chosen?.name ?? "the property"} to ${draft.label || "—"} on ${count} ${plural(count)}.`;

  function plural(n: number): string {
    return n === 1 ? "record" : "records";
  }

  function focusValue() {
    valueRef.current?.querySelector<HTMLElement>("input, button[role='checkbox']")?.focus();
  }

  function closePanel() {
    setPanelOpen(false);
    onPanelChange(false);
    setDraft(null);
    setEditing(true);
    committed.current = null;
    setNonce((current) => current + 1);
    setError(null);
  }

  /**
   * Applies the per-record outcome: failed ids stay selected, and a partial
   * failure returns the one sentence the toast and the bar both show.
   */
  function settle(result: BulkResult): string | null {
    onResult(result.failed.map((failure) => failure.id));
    if (result.failed.length === 0) {
      setError(null);
      return null;
    }
    const first = result.failed[0]?.message ?? "the server refused the write";
    const message = `${result.failed.length} failed — ${first}`;
    setError(message);
    return message;
  }

  function apply(value: unknown) {
    if (!chosen || value === undefined) {
      return;
    }
    setError(null);
    const subject = chosen.name;
    const verb = value === null ? "Clear" : "Update";
    const past = value === null ? "Cleared" : "Updated";
    update.mutate(
      { targets, properties: { [chosen.key]: value } },
      {
        onSuccess: (result) => {
          const partial = settle(result);
          if (result.succeeded.length === 0) {
            if (partial) {
              toast.showToast(`Could not ${verb.toLowerCase()} ${subject}; ${partial}`, "danger");
            }
            return;
          }
          if (partial) {
            toast.showToast(
              `${past} ${subject} on ${result.succeeded.length} of ${count}; ${partial}`,
              "danger",
            );
          } else {
            toast.showToast(
              `${past} ${subject} on ${result.succeeded.length} ${plural(result.succeeded.length)}.`,
            );
          }
        },
        onError: (failure) => setError(readError(failure)),
      },
    );
  }

  /** Apply reads the ref as well as state: blur may commit on the way to the click. */
  function applyDraft() {
    const held = committed.current ?? draft;
    if (!held) {
      setError("Choose a value in step 2 first.");
      focusValue();
      return;
    }
    if (required && held.value === null) {
      setError(`${chosen?.name ?? "This property"} is required, so it needs a value.`);
      focusValue();
      return;
    }
    apply(held.value);
  }

  function duplicateRows() {
    setError(null);
    duplicate.mutate(
      rows.map((row) => ({ id: row.id })),
      {
        onSuccess: (result) => {
          const partial = settle(result);
          const created = result.succeeded;
          if (created.length === 0) {
            if (partial) {
              toast.showToast(`Duplicated none; ${partial}`, "danger");
            }
            return;
          }
          toast.showToast(
            partial
              ? `Duplicated ${created.length} of ${count}; ${partial}`
              : `Duplicated ${created.length} ${plural(created.length)}.`,
            partial ? "danger" : "plain",
            { label: "Undo", onAction: () => onUndoDuplicate(created) },
          );
        },
        onError: (failure) => setError(readError(failure)),
      },
    );
  }

  function trashRows() {
    setError(null);
    trash.mutate(
      rows.map((row) => row.id),
      {
        onSuccess: (result) => {
          const partial = settle(result);
          const moved = result.succeeded;
          if (moved.length === 0) {
            if (partial) {
              toast.showToast(`Moved none; ${partial}`, "danger");
            }
            return;
          }
          toast.showToast(
            partial
              ? `Moved ${moved.length} of ${count} to the trash; ${partial}`
              : `Moved ${moved.length} ${plural(moved.length)} to the trash.`,
            partial ? "danger" : "plain",
            { label: "Undo", onAction: () => onUndoTrash(moved) },
          );
        },
        onError: (failure) => setError(readError(failure)),
      },
    );
  }

  return (
    <section
      aria-label="Bulk actions"
      className="pointer-events-auto flex flex-wrap items-center gap-x-2 gap-y-2 rounded-sheet border border-line bg-surface px-3 py-2 shadow-none"
    >
      <span className="label tnum mr-1">{count} selected</span>
      <Button
        type="button"
        variant="ghost"
        aria-expanded={panelOpen}
        aria-controls="bulk-property-panel"
        disabled={properties.length === 0 || busy}
        className="min-h-8 px-2.5 text-[12px] pointer-coarse:min-h-11"
        onClick={() => {
          if (panelOpen) {
            closePanel();
          } else {
            setPanelOpen(true);
            onPanelChange(true);
            setError(null);
          }
        }}
      >
        Set property
      </Button>
      <Button
        type="button"
        variant="ghost"
        disabled={busy}
        className="min-h-8 px-2.5 text-[12px] pointer-coarse:min-h-11"
        onClick={duplicateRows}
      >
        <Copy aria-hidden size={13} />
        Duplicate
      </Button>
      <Button
        type="button"
        variant="danger"
        disabled={busy}
        className="min-h-8 px-2.5 text-[12px] pointer-coarse:min-h-11"
        onClick={trashRows}
      >
        <Trash2 aria-hidden size={13} />
        Move to trash
      </Button>
      <Button
        type="button"
        variant="ghost"
        className="min-h-8 px-2.5 text-[12px] pointer-coarse:min-h-11"
        onClick={onClear}
      >
        Clear selection
      </Button>
      {properties.length === 0 ? (
        <span className="text-[12px] text-faint">This type has no properties to set.</span>
      ) : null}

      {error ? (
        <div className="basis-full">
          <FormError message={error} />
        </div>
      ) : null}

      {panelOpen && chosen ? (
        <div
          id="bulk-property-panel"
          role="group"
          aria-labelledby="bulk-property-title"
          className="basis-full border-t rule pt-2"
        >
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <div className="min-w-[16rem] flex-1">
              <p id="bulk-property-title" className="text-[12px] font-medium text-ink">
                Set a property on {count} {plural(count)}
              </p>
              <p className="mt-0.5 text-[11px] text-muted">
                Each record is saved on its own; a row that changed since it loaded fails
                alone.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                ref={applyRef}
                type="button"
                className="min-h-8 px-3 text-[12px] pointer-coarse:min-h-11"
                disabled={busy}
                aria-describedby="bulk-property-status"
                onClick={applyDraft}
              >
                {update.isPending ? "Applying…" : `Apply to ${count} ${plural(count)}`}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="min-h-8 px-3 text-[12px] pointer-coarse:min-h-11"
                disabled={busy || required}
                title={
                  required
                    ? "A required property can't be removed."
                    : "Clear this property on every selected record."
                }
                onClick={() => apply(null)}
              >
                Remove value
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="min-h-8 px-3 text-[12px] pointer-coarse:min-h-11"
                onClick={closePanel}
              >
                Close
              </Button>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-start gap-2">
            <label className="grid gap-1">
              <span className="label">1 · Property</span>
              <select
                aria-label="Property to set"
                className={field}
                value={chosen.key}
                onChange={(event) => {
                  setPropertyKey(event.target.value);
                  setDraft(null);
                  setEditing(true);
                  committed.current = null;
                  setNonce((current) => current + 1);
                  setError(null);
                }}
              >
                {properties.map((property) => (
                  <option key={property.key} value={property.key}>
                    {property.name}
                  </option>
                ))}
              </select>
            </label>
            <div
              ref={valueRef}
              className="grid min-w-[12rem] flex-1 gap-1"
              onKeyDownCapture={(event) => {
                const target = event.target as HTMLElement;
                if (
                  event.key === "Enter" ||
                  (event.key === " " && target.getAttribute("role") === "checkbox")
                ) {
                  keyboardCommit.current = true;
                }
              }}
            >
              <span className="label">2 · Value</span>
              {draft && !editing ? (
                <div className="flex min-h-8 items-center gap-1.5">
                  <span
                    className={cn(
                      "inline-flex min-h-8 min-w-0 flex-1 items-center truncate rounded-[4px] border border-line bg-ground px-2 text-[13px]",
                      draft.value === null ? "text-faint" : "text-ink",
                    )}
                  >
                    {draft.value === null
                      ? "Empty — removes the property"
                      : draft.label || "—"}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    className="min-h-8 px-2.5 text-[12px] pointer-coarse:min-h-11"
                    disabled={busy}
                    onClick={() => {
                      setEditing(true);
                      setNonce((current) => current + 1);
                    }}
                  >
                    Change
                  </Button>
                </div>
              ) : (
                <PropertyInput
                  key={`${chosen.key}:${nonce}`}
                  spaceId={spaceId}
                  property={chosen}
                  value={draft?.value}
                  onCommit={(value, label) => {
                    const fromKeyboard = keyboardCommit.current;
                    keyboardCommit.current = false;
                    committed.current = { value, label };
                    setDraft({ value, label });
                    setEditing(false);
                    setNonce((current) => current + 1);
                    if (fromKeyboard) {
                      requestAnimationFrame(() => applyRef.current?.focus());
                    }
                  }}
                  onCancel={() => {
                    committed.current = draft;
                    setEditing(draft === null);
                  }}
                />
              )}
            </div>
          </div>
          <p
            id="bulk-property-status"
            aria-live="polite"
            className="mt-2 text-[11px] text-muted"
          >
            {status}
          </p>
          {required ? (
            <p className="mt-1 text-[11px] text-warning">
              Required — it can be set, but not removed or left empty.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
