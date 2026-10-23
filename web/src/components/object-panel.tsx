import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";

import { ApiError } from "@/api/client";
import {
  useCompleteObject,
  useDuplicateObject,
  useTrashObject,
  useUpdateObject,
} from "@/api/queries";
import type { ObjectDetail, PropertyDef, TypeDef } from "@/api/types";
import { MarkdownView } from "@/components/markdown-view";
import { PropertyField } from "@/components/property-field";
import { Button, FormError } from "@/components/ui/controls";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { formatDate, readError } from "@/lib/display";
import { completeLabel, dueTone, scheduleLabel } from "@/lib/schedule";
import { effectiveMembers, sameJson } from "@/lib/schema";
import { useRecordRecent } from "@/lib/use-record-recent";

interface ObjectPanelProps {
  spaceId: string;
  type: TypeDef | undefined;
  object: ObjectDetail;
  properties: PropertyDef[];
  canEdit: boolean;
  /** Refetches the record from the server; the panel replaces its draft on success. */
  reloadObject: () => Promise<ObjectDetail | undefined>;
}

const STATUS_LABELS = {
  unscheduled: "Not scheduled",
  done: "Done",
  overdue: "Overdue",
  today: "Due today",
  upcoming: "Upcoming",
} as const;

interface Draft {
  title: string;
  body: string;
  values: Record<string, unknown | null>;
}

interface Baseline {
  rev: number;
  title: string;
  body: string;
  values: Record<string, unknown | null>;
}

function rawValues(object: ObjectDetail): Record<string, unknown | null> {
  const values: Record<string, unknown | null> = {};
  for (const [key, cell] of Object.entries(object.properties)) {
    values[key] = cell.value;
  }
  return values;
}

function baselineOf(object: ObjectDetail): Baseline {
  return {
    rev: object.rev,
    title: object.title,
    body: object.body,
    values: rawValues(object),
  };
}

function draftOf(object: ObjectDetail): Draft {
  return { title: object.title, body: object.body, values: rawValues(object) };
}

/** One record: its title, every property, and the markdown body, saved as one write. */
export function ObjectPanel({
  spaceId,
  type,
  object,
  properties,
  canEdit,
  reloadObject,
}: ObjectPanelProps) {
  const [baseline, setBaseline] = useState<Baseline>(() => baselineOf(object));
  const [draft, setDraft] = useState<Draft>(() => draftOf(object));
  const [invalid, setInvalid] = useState<ReadonlySet<string>>(new Set());
  const [conflict, setConflict] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [mode, setMode] = useState<"write" | "preview">("write");
  const [confirmingTrash, setConfirmingTrash] = useState(false);
  /** Bumped on reload so every field re-reads the draft it was given. */
  const [nonce, setNonce] = useState(0);
  const update = useUpdateObject(spaceId);
  const complete = useCompleteObject(spaceId);
  const trash = useTrashObject(spaceId);
  const duplicate = useDuplicateObject(spaceId);
  const navigate = useNavigate();
  const toast = useToast();
  const objectId = object.id;
  useRecordRecent(spaceId, object);

  const propertyByKey = new Map(properties.map((property) => [property.key, property]));
  const effective = type ? effectiveMembers(type) : [];
  const members = new Map(effective.map((member) => [member.key, member]));
  const keys = [
    ...effective.map((member) => member.key),
    ...Object.keys(draft.values).filter((key) => !members.has(key)),
  ];
  const dueLabel = scheduleLabel(type?.schedule_labels, "due_date", "Due");
  const completedLabel = scheduleLabel(
    type?.schedule_labels,
    "last_completed_at",
    "Last completed",
  );
  const verb = completeLabel(type?.schedule_labels);

  const changes: Record<string, unknown | null> = {};
  for (const key of keys) {
    const before = baseline.values[key] ?? null;
    const after = draft.values[key] ?? null;
    if (!sameJson(before, after)) {
      changes[key] = after === "" ? null : after;
    }
  }
  const titleChanged = draft.title.trim() !== baseline.title;
  const bodyChanged = draft.body !== baseline.body;
  const dirty = titleChanged || bodyChanged || Object.keys(changes).length > 0;
  const stale = object.rev !== baseline.rev;

  function resetFrom(saved: ObjectDetail) {
    setBaseline(baselineOf(saved));
    setDraft(draftOf(saved));
    setInvalid(new Set());
    setNonce((current) => current + 1);
  }

  function save() {
    if (!canEdit || update.isPending || invalid.size > 0) {
      return;
    }
    update.mutate(
      {
        id: objectId,
        rev: baseline.rev,
        title: draft.title.trim(),
        body: draft.body,
        ...(Object.keys(changes).length === 0 ? {} : { properties: changes }),
      },
      {
        onSuccess: (saved) => {
          resetFrom(saved);
          setConflict(null);
          setSaveError(null);
        },
        onError: (error) => {
          if (error instanceof ApiError && error.status === 409) {
            setConflict(
              error.message ||
                "This record changed since you loaded it. Reload it to see the current version.",
            );
            setSaveError(null);
            return;
          }
          setSaveError(readError(error));
        },
      },
    );
  }

  const saveRef = useRef(save);
  saveRef.current = save;

  function onComplete() {
    if (!canEdit || complete.isPending) {
      return;
    }
    complete.mutate(
      { id: objectId, rev: object.rev, previous: object },
      {
        onSuccess: ({ object: saved, previous }) => {
          resetFrom(saved);
          setConflict(null);
          setSaveError(null);
          const nextDue = saved.schedule?.due_date;
          toast.showToast(
            nextDue ? `Next due ${nextDue}.` : "Marked done.",
            "plain",
            {
              label: "Undo",
              onAction: () => {
                void complete
                  .undo(saved, previous)
                  .then((undone) => {
                    resetFrom(undone);
                    toast.showToast("Completion undone.");
                  })
                  .catch((error) => {
                    toast.showToast(`Could not undo — ${readError(error)}`, "danger");
                  });
              },
            },
          );
        },
        onError: (error) => {
          if (error instanceof ApiError && error.status === 409) {
            toast.showToast(`Conflict — ${readError(error)}`, "danger");
            void reload();
            return;
          }
          setSaveError(readError(error));
        },
      },
    );
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        saveRef.current();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!dirty) {
      return;
    }
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  async function reload() {
    update.reset();
    const fresh = await reloadObject();
    if (fresh) {
      resetFrom(fresh);
      setConflict(null);
      setSaveError(null);
    } else {
      setSaveError("Could not reload the record. Retry in a moment.");
    }
  }

  /** A copy is an ordinary create; Undo trashes exactly the copy. */
  function duplicateRecord() {
    if (duplicate.isPending) {
      return;
    }
    duplicate.mutate(
      { id: objectId },
      {
        onSuccess: (copy) => {
          toast.showToast(`Duplicated “${copy.title}”.`, "plain", {
            label: "Undo",
            onAction: () =>
              trash.mutate(copy.id, {
                onSuccess: () => toast.showToast("Moved the duplicate to the trash."),
                onError: (error) =>
                  toast.showToast(`Could not undo — ${readError(error)}`, "danger"),
              }),
          });
        },
        onError: (error) => setSaveError(readError(error)),
      },
    );
  }

  function moveToTrash() {
    trash.mutate(objectId, {
      onSuccess: () => {
        toast.showToast(`Moved “${draft.title.trim() || object.title}” to the trash.`);
        navigate(`/s/${spaceId}/t/${object.type}`);
      },
      onError: (error) => {
        setConfirmingTrash(false);
        setSaveError(readError(error));
      },
    });
  }

  function field(key: string) {
    const property = propertyByKey.get(key);
    const member = members.get(key);
    if (!property) {
      return (
        <div key={key} className="grid gap-1 py-3 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-6">
          <span className="font-mono text-[11px] text-faint">{key}</span>
          <span className="font-mono text-[12.5px] text-muted">
            {String(draft.values[key] ?? "—")}
          </span>
        </div>
      );
    }
    return (
      <div
        key={key}
        className="grid gap-1 border-b rule py-3 last:border-b-0 sm:grid-cols-[12rem_minmax(0,1fr)] sm:items-start sm:gap-6"
      >
        <div className="pt-1">
          <span className="label block">{property.name}</span>
          <span className="font-mono text-[10px] text-faint">
            {key}
            {member?.required ? " · required" : ""}
          </span>
        </div>
        <div id={`field-frame-${key}`}>
          <PropertyField
            key={`${nonce}:${key}`}
            spaceId={spaceId}
            property={property}
            value={draft.values[key] ?? null}
            label={object.properties[key]?.label ?? ""}
            canEdit={canEdit}
            locked={key === "last_completed_at" ? "Set by Complete" : undefined}
            onChange={(value) =>
              setDraft((current) => ({
                ...current,
                values: { ...current.values, [key]: value },
              }))
            }
            onInvalid={(isInvalid) =>
              setInvalid((current) => {
                const next = new Set(current);
                if (isInvalid) {
                  next.add(key);
                } else {
                  next.delete(key);
                }
                return next;
              })
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="settle">
      <div className="flex items-center justify-between gap-4">
        <span className="font-mono text-[11px] text-faint">{object.id}</span>
        <span className="label tnum">rev {baseline.rev}</span>
      </div>

      <div className="mt-2 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b rule pb-3">
        {canEdit ? (
          <input
            aria-label="Title"
            className="min-w-0 flex-1 border-0 bg-transparent p-0 text-[26px] font-medium tracking-[-0.02em] outline-none placeholder:text-faint"
            maxLength={200}
            value={draft.title}
            onChange={(event) =>
              setDraft((current) => ({ ...current, title: event.target.value }))
            }
          />
        ) : (
          <h1 className="min-w-0 flex-1 text-[26px] font-medium tracking-[-0.02em]">
            {draft.title}
          </h1>
        )}
        <div className="flex items-center gap-3 pb-1">
          {canEdit ? (
            dirty ? (
              <span className="label flex items-center gap-1.5 text-accent">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
                unsaved
              </span>
            ) : (
              <span className="label">saved</span>
            )
          ) : (
            <span className="label">read only</span>
          )}
          {canEdit ? (
            <>
              <Button
                type="button"
                variant="ghost"
                className="min-h-8 px-3 text-[13px] pointer-coarse:min-h-11"
                disabled={duplicate.isPending || dirty}
                title={dirty ? "Save or discard the draft before duplicating" : "Duplicate record"}
                onClick={duplicateRecord}
              >
                {duplicate.isPending ? "Duplicating…" : "Duplicate"}
              </Button>
              <Button
                type="button"
                className="min-h-8 px-3 text-[13px] pointer-coarse:min-h-11"
                disabled={!dirty || update.isPending || invalid.size > 0}
                title="Save (Cmd/Ctrl+S)"
                onClick={save}
              >
                {update.isPending ? "Saving…" : "Save"}
              </Button>
            </>
          ) : null}
        </div>
      </div>

      <p className="mt-2 font-mono text-[11px] text-faint">
        updated {formatDate(object.updated_at)} · created {formatDate(object.created_at)}
        {type ? ` · ${type.key}` : ""}
      </p>

      {type?.schedule && object.schedule ? (
        <section
          aria-label="Schedule"
          className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-y rule py-2.5"
        >
          <span className={cn("label", dueTone(object.schedule.status))}>
            {STATUS_LABELS[object.schedule.status]}
          </span>
          {object.schedule.due_date ? (
            <span className="text-[13px] text-muted">
              {dueLabel}{" "}
              <span className={cn("tnum", dueTone(object.schedule.status))}>
                {object.schedule.due_date}
              </span>
            </span>
          ) : null}
          {object.schedule.status === "overdue" &&
          object.schedule.days_until_due !== undefined ? (
            <span className="text-[13px] text-danger tnum">
              {Math.abs(object.schedule.days_until_due)}d overdue
            </span>
          ) : null}
          {object.schedule.status === "upcoming" &&
          object.schedule.days_until_due !== undefined ? (
            <span className="text-[13px] text-muted tnum">
              in {object.schedule.days_until_due}d
            </span>
          ) : null}
          {type.schedule && object.properties.recurrence?.label ? (
            <span className="text-[13px] text-muted">
              {object.properties.recurrence.label}
            </span>
          ) : null}
          {object.schedule.completed_at ? (
            <span className="text-[13px] text-faint">
              {completedLabel}{" "}
              <span className="tnum">{formatDate(object.schedule.completed_at)}</span>
            </span>
          ) : null}
          {canEdit && object.schedule.status !== "done" ? (
            <Button
              type="button"
              className="ml-auto min-h-8 px-3 text-[13px] pointer-coarse:min-h-11"
              disabled={complete.isPending}
              onClick={onComplete}
            >
              {complete.isPending ? "Saving…" : verb}
            </Button>
          ) : null}
        </section>
      ) : null}

      {conflict ? (
        <div
          role="alert"
          className="mt-4 max-w-[52ch] border-l border-warning pl-3 text-[13px] text-warning"
        >
          <p>{conflict}</p>
          <button
            type="button"
            className="mt-1 text-[13px] text-ink underline decoration-line-strong hover:decoration-accent"
            onClick={() => void reload()}
          >
            Reload the record (discards this draft)
          </button>
        </div>
      ) : stale ? (
        <div
          role="status"
          className="mt-4 max-w-[52ch] border-l border-warning pl-3 text-[13px] text-warning"
        >
          <p>
            This record changed elsewhere: the server is at revision {object.rev}, your copy is at{" "}
            {baseline.rev}.
            {dirty ? " Reloading discards your draft." : ""}
          </p>
          <button
            type="button"
            className="mt-1 text-[13px] text-ink underline decoration-line-strong hover:decoration-accent"
            onClick={() => void reload()}
          >
            Reload the record
          </button>
        </div>
      ) : null}

      {saveError ? (
        <div className="mt-4 max-w-[52ch]">
          <FormError message={saveError} />
        </div>
      ) : null}

      <section aria-label="Properties" className="mt-6">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="label">Properties</h2>
          <span className="label tnum">{keys.length}</span>
        </div>
        <div className="mt-1 border-t rule">
          {type && keys.length === 0 ? (
            <p className="py-4 text-[13px] text-muted">
              This type has no properties yet. Add columns in the schema.
            </p>
          ) : (
            keys.map(field)
          )}
        </div>
      </section>

      <section aria-label="Body" className="mt-10">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="label">Body</h2>
          {canEdit ? (
            <div className="flex items-center gap-1" role="group" aria-label="Body mode">
              {(["write", "preview"] as const).map((choice) => (
                <button
                  key={choice}
                  type="button"
                  aria-pressed={mode === choice}
                  className={cn(
                    "label rounded-[3px] px-2 py-1 transition-colors hover:text-ink aria-pressed:bg-raised aria-pressed:text-ink pointer-coarse:min-h-11",
                    mode === choice ? "" : "text-faint",
                  )}
                  onClick={() => setMode(choice)}
                >
                  {choice}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        {canEdit && mode === "write" ? (
          <textarea
            aria-label="Markdown body"
            className="mt-2 min-h-[22rem] w-full resize-y rounded-field border border-line-interactive bg-ground px-3 py-2 text-[15px] leading-[1.6] text-ink transition-colors hover:border-line-strong focus:border-accent pointer-coarse:text-[16px]"
            placeholder="Write in markdown. Saves with the rest of the record."
            spellCheck
            value={draft.body}
            onChange={(event) =>
              setDraft((current) => ({ ...current, body: event.target.value }))
            }
          />
        ) : (
          <div className="mt-2 min-h-[22rem] rounded-field border border-line px-3">
            <MarkdownView text={draft.body} />
          </div>
        )}
      </section>

      {canEdit ? (
        <section aria-label="Trash" className="mt-10 border-t rule pt-4">
          {confirmingTrash ? (
            <div
              role="group"
              aria-label="Move to trash"
              className="flex flex-wrap items-center gap-3 border-l border-danger pl-3"
            >
              <p className="max-w-[46ch] text-[13px] text-muted">
                Move “{draft.title.trim() || object.title}” to the trash? The file and its history
                are kept until purged.
                {dirty ? " Unsaved changes are discarded." : ""}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="danger"
                  className="min-h-8 px-3 text-[13px] pointer-coarse:min-h-11"
                  disabled={trash.isPending}
                  onClick={moveToTrash}
                >
                  {trash.isPending ? "Moving…" : "Move to trash"}
                </Button>
                <Button
                  variant="ghost"
                  className="min-h-8 px-3 text-[13px] pointer-coarse:min-h-11"
                  onClick={() => setConfirmingTrash(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="text-[13px] text-danger underline decoration-danger/40 underline-offset-2 hover:decoration-danger pointer-coarse:min-h-11"
              onClick={() => setConfirmingTrash(true)}
            >
              Move record to trash
            </button>
          )}
        </section>
      ) : null}
    </div>
  );
}
