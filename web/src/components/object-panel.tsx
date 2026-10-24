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
import { Button, FormError, StickyActionBar } from "@/components/ui/controls";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { formatDate, readError } from "@/lib/display";
import { valueLabel } from "@/lib/format";
import { completeLabel, dueTone, scheduleLabel } from "@/lib/schedule";
import { effectiveMembers, sameJson } from "@/lib/schema";
import { useDirtyGuard } from "@/lib/use-dirty-guard";
import { useRecordRecent } from "@/lib/use-record-recent";

interface ObjectPanelProps {
  spaceId: string;
  type: TypeDef | undefined;
  object: ObjectDetail;
  properties: PropertyDef[];
  canEdit: boolean;
  /** The space's calendar zone, used by the date and datetime shortcuts. */
  timeZone: string;
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
  timeZone,
  reloadObject,
}: ObjectPanelProps) {
  const [baseline, setBaseline] = useState<Baseline>(() => baselineOf(object));
  const [draft, setDraft] = useState<Draft>(() => draftOf(object));
  const [invalid, setInvalid] = useState<ReadonlySet<string>>(new Set());
  const [conflict, setConflict] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [mode, setMode] = useState<"write" | "preview">(
    object.body.trim() === "" ? "write" : "preview",
  );
  const [confirmingTrash, setConfirmingTrash] = useState(false);
  const [confirmComplete, setConfirmComplete] = useState(false);
  const [leaving, setLeaving] = useState(false);
  /** Bumped only when the draft is replaced from the server, never on save. */
  const [resetToken, setResetToken] = useState(0);
  const [revertTokens, setRevertTokens] = useState<Record<string, number>>({});
  const lastSavedRev = useRef<number | null>(null);
  const focusBeforeSave = useRef<HTMLElement | null>(null);
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

  function changesAgainst(base: Baseline): Record<string, unknown | null> {
    const changes: Record<string, unknown | null> = {};
    for (const key of keys) {
      const before = base.values[key] ?? null;
      const after = draft.values[key] ?? null;
      if (!sameJson(before, after)) {
        changes[key] = after === "" ? null : after;
      }
    }
    return changes;
  }

  const titleChanged = draft.title.trim() !== baseline.title;
  const bodyChanged = draft.body !== baseline.body;
  const changedFields = keys.filter(
    (key) => !sameJson(baseline.values[key] ?? null, draft.values[key] ?? null),
  );
  const changeCount =
    changedFields.length + (titleChanged ? 1 : 0) + (bodyChanged ? 1 : 0);
  const dirty = changeCount > 0 && !leaving;
  const stale = object.rev !== baseline.rev;

  function resetFrom(saved: ObjectDetail, remount = false) {
    setBaseline(baselineOf(saved));
    setDraft(draftOf(saved));
    setInvalid(new Set());
    lastSavedRev.current = saved.rev;
    if (remount) {
      setResetToken((current) => current + 1);
      setMode(saved.body.trim() === "" ? "write" : "preview");
    }
  }

  function save(revOverride?: number, baseOverride?: Baseline): Promise<boolean> {
    if (!canEdit || update.isPending || invalid.size > 0) {
      return Promise.resolve(false);
    }
    const base = baseOverride ?? baseline;
    const nextChanges = changesAgainst(base);
    focusBeforeSave.current =
      document.activeElement instanceof HTMLElement &&
      document.activeElement.closest("[data-record-panel]") !== null
        ? document.activeElement
        : null;
    return new Promise((resolve) => {
      update.mutate(
        {
          id: objectId,
          rev: revOverride ?? base.rev,
          title: draft.title.trim(),
          body: draft.body,
          ...(Object.keys(nextChanges).length === 0 ? {} : { properties: nextChanges }),
        },
        {
          onSuccess: (saved) => {
            resetFrom(saved);
            setConflict(null);
            setSaveError(null);
            restoreFocus();
            resolve(true);
          },
          onError: (error) => {
            if (error instanceof ApiError && error.status === 409) {
              setConflict(
                error.message ||
                  "This record changed since you loaded it. Reload it to see the current version.",
              );
              setSaveError(null);
              resolve(false);
              return;
            }
            setSaveError(readError(error));
            restoreFocus();
            resolve(false);
          },
        },
      );
    });
  }

  /** A disabled frozen field blurred itself; return focus when it is enabled. */
  function restoreFocus() {
    const target = focusBeforeSave.current;
    if (target?.isConnected) {
      window.requestAnimationFrame(() => target.focus());
    }
  }

  const saveRef = useRef(save);
  saveRef.current = save;

  function runComplete(revOverride?: number) {
    if (!canEdit || complete.isPending) {
      return;
    }
    complete.mutate(
      { id: objectId, rev: revOverride ?? lastSavedRev.current ?? object.rev },
      {
        onSuccess: ({ object: saved, previous }) => {
          resetFrom(saved, true);
          setConflict(null);
          setSaveError(null);
          setConfirmComplete(false);
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
                    resetFrom(undone, true);
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
            void reload("theirs");
            return;
          }
          setSaveError(readError(error));
        },
      },
    );
  }

  function onComplete() {
    if (dirty) {
      setConfirmComplete(true);
      return;
    }
    runComplete();
  }

  async function saveThenComplete() {
    const ok = await save();
    if (ok) {
      setConfirmComplete(false);
      runComplete();
    }
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (
        event.defaultPrevented ||
        document.querySelector('[role="dialog"], [role="alertdialog"]')
      ) {
        return;
      }
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveRef.current();
        return;
      }
      if (mod && event.key === "Enter") {
        event.preventDefault();
        void saveRef.current();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        navigate(`/s/${spaceId}/t/${object.type}`);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, object.type, spaceId]);

  // A refused write must stay visible until the next attempt edits something.
  useEffect(() => {
    setSaveError(null);
  }, [draft]);

  async function reload(choice: "theirs" | "mine" | "save"): Promise<boolean> {
    update.reset();
    const fresh = await reloadObject();
    if (!fresh) {
      setSaveError("Could not reload the record. Retry in a moment.");
      return false;
    }
    if (choice === "theirs") {
      resetFrom(fresh, true);
      setConflict(null);
      setSaveError(null);
      return true;
    }
    const freshBase = baselineOf(fresh);
    setBaseline(freshBase);
    setConflict(null);
    setSaveError(null);
    if (choice === "save") {
      return save(fresh.rev, freshBase);
    }
    return true;
  }

  const guard = useDirtyGuard(dirty, () => save());

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
        setLeaving(true);
        // The blocker reads the previous render's `dirty`; let the state land.
        window.setTimeout(() => navigate(`/s/${spaceId}/t/${object.type}`), 0);
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
    const changed = changedFields.includes(key);
    if (!property) {
      const raw = draft.values[key];
      const text =
        raw !== null && typeof raw === "object"
          ? JSON.stringify(raw)
          : valueLabel("text", raw, undefined);
      return (
        <div key={key} className="grid gap-1 py-3 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-6">
          <span className="font-mono text-[11px] text-faint">{key}</span>
          <span className="font-mono text-[12.5px] text-muted">{text || "—"}</span>
        </div>
      );
    }
    return (
      <div
        key={key}
        className="grid gap-1 border-b rule py-3 last:border-b-0 sm:grid-cols-[12rem_minmax(0,1fr)] sm:items-start sm:gap-6"
      >
        <div className="pt-1">
          <span className="label flex items-center gap-1.5">
            {changed ? (
              <span
                aria-label="Unsaved change"
                title="Unsaved change"
                className="h-1.5 w-1.5 rounded-full bg-accent"
              />
            ) : null}
            {property.name}
          </span>
          <span className="font-mono text-[10px] text-faint">
            {key}
            {member?.required ? " · required" : ""}
          </span>
          {changed ? (
            <button
              type="button"
              className="mt-0.5 block text-[11px] text-muted underline decoration-line-strong hover:text-ink pointer-coarse:min-h-11"
              onClick={() => {
                setDraft((current) => ({
                  ...current,
                  values: { ...current.values, [key]: baseline.values[key] ?? null },
                }));
                setRevertTokens((current) => ({
                  ...current,
                  [key]: (current[key] ?? 0) + 1,
                }));
              }}
            >
              Revert
            </button>
          ) : null}
        </div>
        <div id={`field-frame-${key}`}>
          <PropertyField
            key={`${objectId}:${key}:${resetToken}:${revertTokens[key] ?? 0}`}
            spaceId={spaceId}
            property={property}
            value={draft.values[key] ?? null}
            label={object.properties[key]?.label ?? ""}
            canEdit={canEdit}
            timeZone={timeZone}
            missing={object.properties[key]?.missing}
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
    <div className="settle" data-record-panel>
      <div className="flex items-center justify-between gap-4">
        <span className="font-mono text-[11px] text-faint">{object.id}</span>
        <span className="label tnum">rev {baseline.rev}</span>
      </div>

      <div className="mt-2 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b rule pb-3">
        {canEdit ? (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <input
              aria-label="Title"
              className="min-w-0 flex-1 border-0 bg-transparent p-0 text-[26px] font-medium tracking-[-0.02em] outline-none placeholder:text-faint"
              maxLength={200}
              disabled={update.isPending}
              value={draft.title}
              onChange={(event) =>
                setDraft((current) => ({ ...current, title: event.target.value }))
              }
            />
            {titleChanged ? (
              <button
                type="button"
                className="label shrink-0 text-muted underline decoration-line-strong hover:text-ink pointer-coarse:min-h-11"
                onClick={() =>
                  setDraft((current) => ({ ...current, title: baseline.title }))
                }
              >
                Revert
              </button>
            ) : null}
          </div>
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
                {changeCount} unsaved {changeCount === 1 ? "change" : "changes"}
              </span>
            ) : (
              <span className="label">saved</span>
            )
          ) : (
            <span className="label">read only</span>
          )}
          {canEdit ? (
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
          ) : null}
        </div>
      </div>

      <p className="mt-2 font-mono text-[11px] text-faint">
        updated {formatDate(object.updated_at, timeZone)} · created{" "}
        {formatDate(object.created_at, timeZone)}
        {type ? ` · ${type.key}` : ""}
      </p>

      {type?.schedule && object.schedule ? (
        <section
          aria-label="Schedule"
          className="mt-4 flex items-center gap-4 border-y rule py-2.5"
        >
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 sm:gap-x-5">
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
                <span className="tnum">
                  {formatDate(object.schedule.completed_at, timeZone)}
                </span>
              </span>
            ) : null}
          </div>
          {canEdit && object.schedule.status !== "done" ? (
            <Button
              type="button"
              className="min-h-8 shrink-0 px-3 text-[13px] pointer-coarse:min-h-11"
              disabled={complete.isPending || confirmComplete}
              onClick={onComplete}
            >
              {complete.isPending ? "Saving…" : verb}
            </Button>
          ) : null}
        </section>
      ) : null}

      {confirmComplete ? (
        <div
          role="alertdialog"
          aria-label="Complete record"
          className="mt-4 grid max-w-[52ch] gap-2 border-y rule py-3"
        >
          <p className="text-[13px]">
            This record has {changeCount} unsaved{" "}
            {changeCount === 1 ? "change" : "changes"}.{" "}
            {changeCount === 1 ? "Save it" : "Save them"} before completing?
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              className="min-h-8 px-3 text-[12px] pointer-coarse:min-h-11"
              disabled={update.isPending}
              onClick={() => void saveThenComplete()}
            >
              {update.isPending ? "Saving…" : "Save changes and complete"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="min-h-8 px-3 text-[12px] pointer-coarse:min-h-11"
              onClick={() => {
                setConfirmComplete(false);
                runComplete();
              }}
            >
              Discard changes and complete
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="min-h-8 px-3 text-[12px] pointer-coarse:min-h-11"
              onClick={() => setConfirmComplete(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {conflict ? (
        <div
          role="alert"
          className="mt-4 max-w-[52ch] border-l border-warning pl-3 text-[13px] text-warning"
        >
          <p>{conflict}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              className="min-h-8 px-3 text-[12px] pointer-coarse:min-h-11"
              disabled={update.isPending}
              onClick={() => void reload("theirs")}
            >
              Reload their version
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="min-h-8 px-3 text-[12px] pointer-coarse:min-h-11"
              disabled={update.isPending}
              onClick={() => void reload("mine")}
            >
              Keep my draft
            </Button>
            <Button
              type="button"
              className="min-h-8 px-3 text-[12px] pointer-coarse:min-h-11"
              disabled={update.isPending}
              onClick={() => void reload("save")}
            >
              Save anyway
            </Button>
          </div>
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
            onClick={() => void reload("theirs")}
          >
            Reload the record
          </button>
        </div>
      ) : null}

      <fieldset
        aria-label="Properties"
        disabled={update.isPending}
        className="mt-6 m-0 min-w-0 border-0 p-0"
      >
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
      </fieldset>

      <section aria-label="Body" className="mt-10">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="label flex items-center gap-1.5">
            {bodyChanged ? (
              <span
                aria-label="Unsaved change"
                title="Unsaved change"
                className="h-1.5 w-1.5 rounded-full bg-accent"
              />
            ) : null}
            Body
          </h2>
          {canEdit ? (
            <div className="flex items-center gap-1" role="group" aria-label="Body mode">
              {bodyChanged ? (
                <button
                  type="button"
                  className="label px-2 text-muted underline decoration-line-strong hover:text-ink pointer-coarse:min-h-11"
                  onClick={() => setDraft((current) => ({ ...current, body: baseline.body }))}
                >
                  Revert
                </button>
              ) : null}
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
            disabled={update.isPending}
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

      {canEdit ? (
        <StickyActionBar>
          {saveError ? (
            <span className="flex min-w-[14rem] flex-1 flex-wrap items-center gap-2">
              <FormError message={saveError} />
              <Button
                type="button"
                variant="ghost"
                className="min-h-8 px-3 text-[12px] pointer-coarse:min-h-11"
                disabled={update.isPending}
                onClick={() => void save()}
              >
                Retry
              </Button>
            </span>
          ) : null}
          {dirty ? (
            <span className="label flex items-center gap-1.5 text-accent">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
              {changeCount} unsaved {changeCount === 1 ? "change" : "changes"}
            </span>
          ) : (
            <span className="label">Saved</span>
          )}
          <Button
            type="button"
            className="min-h-9 px-3 text-[13px] pointer-coarse:min-h-11"
            disabled={!dirty || update.isPending || invalid.size > 0}
            title="Save (Cmd/Ctrl+S or Cmd/Ctrl+Enter)"
            onClick={() => void save()}
          >
            {update.isPending ? "Saving…" : "Save"}
          </Button>
        </StickyActionBar>
      ) : null}
      {guard}
    </div>
  );
}
