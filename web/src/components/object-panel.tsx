import { Popover } from "@base-ui/react/popover";
import {
  AlignLeft,
  ChevronRight,
  Copy,
  ImageOff,
  ImagePlus,
  Move,
  MoreHorizontal,
  Pencil,
  SlidersHorizontal,
  Undo2,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";

import { ApiError } from "@/api/client";
import {
  useCompleteObject,
  useDuplicateObject,
  useRestoreObject,
  useTrashObject,
  useUpdateObject,
  useUploadFile,
} from "@/api/queries";
import type {
  MentionBacklink,
  ObjectDetail,
  PropertyDef,
  TypeDef,
} from "@/api/types";
import { ThumbRow, useHandedness } from "@/components/handedness";
import { IconPicker } from "@/components/icon-picker";
import { ImageLightbox } from "@/components/image-lightbox";
import { MarkdownEditor } from "@/components/markdown-editor";
import { MarkdownView } from "@/components/markdown-view";
import { PropertyField } from "@/components/property-field";
import { RenameLinksDialog, type MentionSource } from "@/components/rename-links-dialog";
import { ThingIcon } from "@/components/thing-icon";
import { Button, FormError, StickyActionBar } from "@/components/ui/controls";
import { FormatChip } from "@/components/ui/page";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { formatDate, formatDateTime, formatDay, readError } from "@/lib/display";
import { coverPoint, thumbnailUrl } from "@/lib/files";
import { useWideLayout } from "@/lib/media";
import { valueLabel } from "@/lib/format";
import { completeLabel, dueTone, scheduleLabel } from "@/lib/schedule";
import { effectiveMembers, formatLabel, sameJson } from "@/lib/schema";
import { useDirtyGuard } from "@/lib/use-dirty-guard";
import { useRecordRecent } from "@/lib/use-record-recent";
import { rewriteMentions } from "@/lib/wiki-links";

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
  /** A search query that opened this record; its body occurrences are marked. */
  highlight?: string;
  /** Removes the query from the URL without leaving the record. */
  onClearHighlight?: () => void;
  /** Evidence below the body — the links and the history — in the main field. */
  children?: ReactNode;
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
  /** The raw glyph; an empty string means no icon. */
  icon: string;
  /** The cover's stored path; an empty string means no cover. */
  cover: string;
  /** The cover's focal point; an empty string means the centre. */
  coverPosition: string;
  body: string;
  values: Record<string, unknown | null>;
}

interface Baseline {
  rev: number;
  title: string;
  icon: string;
  cover: string;
  coverPosition: string;
  body: string;
  values: Record<string, unknown | null>;
}

/** The title change held back while the reader decides about inbound links. */
interface RenamePrompt {
  base: Baseline;
  oldTitle: string;
  newTitle: string;
  mentions: MentionBacklink[];
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
    icon: object.icon ?? "",
    cover: object.cover ?? "",
    coverPosition: object.cover_position ?? "",
    body: object.body,
    values: rawValues(object),
  };
}

function draftOf(object: ObjectDetail): Draft {
  return {
    title: object.title,
    icon: object.icon ?? "",
    cover: object.cover ?? "",
    coverPosition: object.cover_position ?? "",
    body: object.body,
    values: rawValues(object),
  };
}

/**
 * The record's folio: its type key and revision in one mono line, with the id
 * and its copy control behind the disclosure. The full value is one tap away,
 * where it can also be copied without selecting it by hand on a phone.
 */
function RecordIdentity({
  objectId,
  rev,
  typeKey,
}: {
  objectId: string;
  rev: number;
  typeKey: string;
}) {
  const toast = useToast();
  const codeRef = useRef<HTMLElement | null>(null);

  async function copyId() {
    try {
      await navigator.clipboard.writeText(objectId);
      toast.showToast("Record id copied.");
    } catch {
      // A blocked clipboard still leaves the id selectable by hand.
      const code = codeRef.current;
      if (!code) {
        return;
      }
      const range = document.createRange();
      range.selectNodeContents(code);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      toast.showToast("Select the id and copy it.", "plain");
    }
  }

  return (
    <details className="group min-w-0">
      <summary
        aria-label={`Record id ${objectId}, revision ${rev}. Show the full id.`}
        className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 font-mono text-[length:var(--text-small)] text-faint uppercase transition-colors hover:text-ink sm:min-h-7 [&::-webkit-details-marker]:hidden"
      >
        <ChevronRight
          aria-hidden
          size={12}
          className="shrink-0 motion-safe:transition-transform group-open:rotate-90"
        />
        <span className="truncate">{typeKey}</span>
        <span aria-hidden>·</span>
        <span className="tnum">rev {rev}</span>
      </summary>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[length:var(--text-small)] text-muted">
        <code ref={codeRef} className="min-w-0 break-all select-all">
          {objectId}
        </code>
        <button
          type="button"
          className="text-[length:var(--text-small)] text-muted underline decoration-line-strong hover:text-ink pointer-coarse:min-h-11"
          onClick={() => void copyId()}
        >
          Copy id
        </button>
        <span className="tnum text-faint">rev {rev}</span>
      </div>
    </details>
  );
}

const RECORD_MENU_ITEM =
  "flex min-h-9 w-full items-center gap-2 rounded-[10px] px-3 text-left text-[13px] text-ink transition-colors hover:bg-raised disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:min-h-11";

/** The record header's overflow: Revert and Duplicate no longer crowd the title. */
function RecordOverflow({
  revertLabel,
  onRevert,
  hasCover,
  onChooseCover,
  onRemoveCover,
  onRepositionCover,
  coverPending,
  typeHref,
  typeName,
  onDuplicate,
  duplicating,
  duplicateDisabled,
}: {
  revertLabel: string | null;
  onRevert: () => void;
  /** Whether the draft already has a cover, which makes the action a change. */
  hasCover: boolean;
  onChooseCover: () => void;
  onRemoveCover: () => void;
  onRepositionCover: () => void;
  coverPending: boolean;
  /** The type editor, opened on the record's own type. */
  typeHref: string;
  typeName: string;
  onDuplicate: () => void;
  duplicating: boolean;
  duplicateDisabled: boolean;
}) {
  const { handedness } = useHandedness();
  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label="More record actions"
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-line-interactive/70 bg-raised/40 text-muted transition-colors hover:border-line-strong hover:bg-raised hover:text-ink pointer-coarse:h-11 pointer-coarse:w-11"
      >
        <MoreHorizontal aria-hidden size={16} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          sideOffset={4}
          align={handedness === "left" ? "start" : "end"}
          className="z-50"
        >
          <Popover.Popup className="min-w-[11rem] glass-strong rounded-card p-1.5">
            {revertLabel ? (
              <Popover.Close className={RECORD_MENU_ITEM} onClick={onRevert}>
                <Undo2 aria-hidden size={14} />
                {revertLabel}
              </Popover.Close>
            ) : null}
            <Popover.Close
              className={RECORD_MENU_ITEM}
              disabled={coverPending}
              onClick={onChooseCover}
            >
              <ImagePlus aria-hidden size={14} />
              {hasCover ? "Change cover" : "Add cover"}
            </Popover.Close>
            {hasCover ? (
              <>
                <Popover.Close
                  className={RECORD_MENU_ITEM}
                  disabled={coverPending}
                  onClick={onRepositionCover}
                >
                  <Move aria-hidden size={14} />
                  Reposition cover
                </Popover.Close>
                <Popover.Close
                  className={RECORD_MENU_ITEM}
                  disabled={coverPending}
                  onClick={onRemoveCover}
                >
                  <ImageOff aria-hidden size={14} />
                  Remove cover
                </Popover.Close>
              </>
            ) : null}
            <Popover.Close
              className={RECORD_MENU_ITEM}
              title={`Edit ${typeName} type`}
              render={<Link to={typeHref} />}
            >
              <Pencil aria-hidden size={14} />
              Edit type
            </Popover.Close>
            <Popover.Close
              className={RECORD_MENU_ITEM}
              disabled={duplicateDisabled || duplicating}
              title={
                duplicateDisabled
                  ? "Save or discard the draft before duplicating"
                  : "Duplicate record"
              }
              onClick={onDuplicate}
            >
              <Copy aria-hidden size={14} />
              {duplicating ? "Duplicating…" : "Duplicate"}
            </Popover.Close>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
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
  highlight,
  onClearHighlight,
  children,
}: ObjectPanelProps) {
  const [baseline, setBaseline] = useState<Baseline>(() => baselineOf(object));
  const [draft, setDraft] = useState<Draft>(() => draftOf(object));
  const [invalid, setInvalid] = useState<ReadonlySet<string>>(new Set());
  const [conflict, setConflict] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [coverError, setCoverError] = useState<string | null>(null);
  const [coverAttempt, setCoverAttempt] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState(false);
  const [repositioning, setRepositioning] = useState(false);
  const [focusStart, setFocusStart] = useState("");
  const [confirmingTrash, setConfirmingTrash] = useState(false);
  const [confirmComplete, setConfirmComplete] = useState(false);
  const [renamePrompt, setRenamePrompt] = useState<RenamePrompt | null>(null);
  const [renamePending, setRenamePending] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  /** Bumped only when the draft is replaced from the server, never on save. */
  const [resetToken, setResetToken] = useState(0);
  const [revertTokens, setRevertTokens] = useState<Record<string, number>>({});
  const lastSavedRev = useRef<number | null>(null);
  const focusBeforeSave = useRef<HTMLElement | null>(null);
  const coverInput = useRef<HTMLInputElement | null>(null);
  const coverOpener = useRef<HTMLElement | null>(null);
  const update = useUpdateObject(spaceId);
  const coverUpload = useUploadFile(spaceId);
  const complete = useCompleteObject(spaceId);
  const trash = useTrashObject(spaceId);
  const restore = useRestoreObject(spaceId);
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
  const iconChanged = draft.icon.trim() !== baseline.icon;
  const coverChanged = draft.cover.trim() !== baseline.cover;
  const coverPositionChanged = draft.coverPosition !== baseline.coverPosition;
  const bodyChanged = draft.body !== baseline.body;
  const bodyText = draft.body.trim();
  const bodyWords = bodyText === "" ? 0 : bodyText.split(/\s+/u).length;
  const bodyChars = Array.from(draft.body).length;
  const changedFields = keys.filter(
    (key) => !sameJson(baseline.values[key] ?? null, draft.values[key] ?? null),
  );
  const changeCount =
    changedFields.length +
    (titleChanged ? 1 : 0) +
    (iconChanged ? 1 : 0) +
    (coverChanged || coverPositionChanged ? 1 : 0) +
    (bodyChanged ? 1 : 0);
  const dirty = changeCount > 0 && !leaving;
  const wide = useWideLayout();
  const stale = object.rev !== baseline.rev;
  const headerParts = [
    ...(titleChanged ? ["title"] : []),
    ...(iconChanged ? ["icon"] : []),
    ...(coverChanged || coverPositionChanged ? ["cover"] : []),
  ];
  const headerRevertLabel =
    headerParts.length === 0
      ? null
      : headerParts.length === 1
        ? `Revert ${headerParts[0]}`
        : headerParts.length === 2
          ? `Revert ${headerParts[0]} and ${headerParts[1]}`
          : `Revert ${headerParts[0]}, ${headerParts[1]} and ${headerParts[2]}`;
  const coverFocus = coverPoint(draft.coverPosition);
  const coverStyle = {
    objectPosition: `${coverFocus.x}% ${coverFocus.y}%`,
  };

  function revertHeader() {
    setDraft((current) => ({
      ...current,
      title: baseline.title,
      icon: baseline.icon,
      cover: baseline.cover,
      coverPosition: baseline.coverPosition,
    }));
    setRepositioning(false);
  }

  /** Sets both axes from a click or a slider; the centre is stored as absent. */
  function setCoverFocus(x: number, y: number) {
    const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));
    setDraft((current) => ({
      ...current,
      coverPosition: `${clamp(x)}% ${clamp(y)}%`,
    }));
  }

  function startReposition() {
    setFocusStart(draft.coverPosition);
    setRepositioning(true);
  }

  function cancelReposition() {
    setDraft((current) => ({ ...current, coverPosition: focusStart }));
    setRepositioning(false);
  }

  function finishReposition() {
    const point = coverPoint(draft.coverPosition);
    setDraft((current) => ({
      ...current,
      coverPosition: point.x === 50 && point.y === 50 ? "" : `${point.x}% ${point.y}%`,
    }));
    setRepositioning(false);
  }

  /** Uploads cover bytes; the draft gets the path only after the store accepts them. */
  function chooseCover(file: File | undefined) {
    if (!file || !canEdit || coverUpload.isPending) {
      return;
    }
    setCoverAttempt(file);
    setCoverError(null);
    coverUpload.mutate(file, {
      onSuccess: (stored) => {
        setCoverAttempt(null);
        setRepositioning(false);
        setDraft((current) => ({
          ...current,
          cover: stored.path,
          coverPosition: "",
        }));
      },
      onError: (error) => setCoverError(readError(error)),
    });
  }

  function removeCover() {
    setCoverAttempt(null);
    setCoverError(null);
    setRepositioning(false);
    setDraft((current) => ({ ...current, cover: "", coverPosition: "" }));
  }

  function resetFrom(saved: ObjectDetail, remount = false) {
    setBaseline(baselineOf(saved));
    setDraft(draftOf(saved));
    setInvalid(new Set());
    lastSavedRev.current = saved.rev;
    if (remount) {
      setResetToken((current) => current + 1);
    }
  }

  const mentionBacklinks = (object.backlinks ?? []).filter(
    (row): row is MentionBacklink => row.kind === "mention",
  );

  /**
   * Saves the draft. A title change that would strand inbound mentions stops
   * first at the preview; `renameConfirmed` is how the preview's own actions
   * get past the gate to the ordinary write.
   */
  function save(
    revOverride?: number,
    baseOverride?: Baseline,
    renameConfirmed = false,
  ): Promise<boolean> {
    if (!canEdit || update.isPending || invalid.size > 0) {
      return Promise.resolve(false);
    }
    const base = baseOverride ?? baseline;
    const nextTitle = draft.title.trim();
    if (
      !renameConfirmed &&
      nextTitle !== base.title &&
      mentionBacklinks.length > 0
    ) {
      setRenamePrompt({
        base,
        oldTitle: base.title,
        newTitle: nextTitle,
        mentions: mentionBacklinks,
      });
      setRenameError(null);
      return Promise.resolve(false);
    }
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
          icon: draft.icon.trim() === "" ? null : draft.icon.trim(),
          ...(draft.cover.trim() === base.cover
            ? {}
            : { cover: draft.cover.trim() === "" ? null : draft.cover.trim() }),
          ...(draft.coverPosition === base.coverPosition
            ? {}
            : {
                cover_position:
                  draft.coverPosition === "" ? null : draft.coverPosition,
              }),
          body: draft.body,
          ...(Object.keys(nextChanges).length === 0 ? {} : { properties: nextChanges }),
        },
        {
          onSuccess: (saved) => {
            resetFrom(saved);
            setRepositioning(false);
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
            nextDue
              ? `Next due ${nextDue} for “${saved.title}”.`
              : `“${saved.title}” marked done.`,
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
      // Only an open dialog owns Escape. The palette, capture and background
      // sheets stay mounted while closed, each with `hidden`, so a bare role
      // query would swallow every Escape on the record.
      if (
        event.defaultPrevented ||
        document.querySelector(
          '[role="dialog"]:not([hidden]), [role="alertdialog"]:not([hidden])',
        )
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

  async function renameOnly() {
    const prompt = renamePrompt;
    if (!prompt || renamePending) {
      return;
    }
    setRenamePending(true);
    setRenameError(null);
    const saved = await save(prompt.base.rev, prompt.base, true);
    setRenamePending(false);
    if (!saved) {
      setRenameError("The rename was not saved. Nothing was changed.");
      return;
    }
    setRenamePrompt(null);
    toast.showToast(`Renamed to “${prompt.newTitle}”.`);
  }

  /**
   * Renames the record, then repairs the sources the preview listed. Each
   * source is an independent ordinary PATCH: a stale revision or a failed
   * write is reported and left alone, never retried or rolled back.
   */
  async function updateLinks(sources: MentionSource[]) {
    const prompt = renamePrompt;
    if (!prompt || renamePending) {
      return;
    }
    setRenamePending(true);
    setRenameError(null);
    const saved = await save(prompt.base.rev, prompt.base, true);
    if (!saved) {
      setRenamePending(false);
      setRenameError("The rename was not saved. No links were changed.");
      return;
    }

    let updated = 0;
    let skipped = 0;
    for (const source of sources) {
      const detail = source.detail;
      if (!detail) {
        skipped += 1;
        continue;
      }
      const resolved = new Map<string, string>();
      for (const link of detail.links ?? []) {
        if (link.status === "ok" && link.id) {
          resolved.set(link.raw, link.id);
        }
      }
      const rewritten = rewriteMentions(
        detail.body,
        objectId,
        object.type,
        prompt.oldTitle,
        prompt.newTitle,
        (raw) => resolved.get(raw),
      );
      if (rewritten.count === 0) {
        skipped += 1;
        continue;
      }
      try {
        await update.mutateAsync({
          id: detail.id,
          rev: detail.rev,
          body: rewritten.body,
        });
        updated += 1;
      } catch {
        skipped += 1;
      }
    }

    setRenamePending(false);
    setRenamePrompt(null);
    const records = updated === 1 ? "record" : "records";
    toast.showToast(
      skipped === 0
        ? `Updated ${updated} ${records} that link here.`
        : `Updated ${updated} ${records} that link here; skipped ${skipped} changed ${
            skipped === 1 ? "record" : "records"
          }.`,
      "plain",
    );
  }

  function moveToTrash() {
    const title = draft.title.trim() || object.title;
    trash.mutate(objectId, {
      onSuccess: () => {
        toast.showToast(`Moved “${title}” to the trash.`, "plain", {
          label: "Undo",
          onAction: () =>
            // The panel has unmounted by the time this runs, and TanStack only
            // delivers per-call callbacks to a mounted observer. The promise
            // from `mutateAsync` settles either way.
            void restore
              .mutateAsync(objectId)
              .then(() => toast.showToast(`Restored “${title}”.`))
              .catch((error) =>
                toast.showToast(`Could not undo — ${readError(error)}`, "danger"),
              ),
        });
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
        <div
          key={key}
          className="grid gap-1 border-b rule py-3 last:border-b-0 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-6 xl:grid-cols-1 xl:gap-1"
        >
          <span className="font-mono text-[length:var(--text-label)] tracking-[0.09em] text-faint uppercase">
            {key}
          </span>
          <span className="font-mono text-[length:var(--text-small)] text-muted">{text || "—"}</span>
        </div>
      );
    }
    return (
      <div
        key={key}
        role="group"
        aria-label={`${property.name} — key ${key}${member?.required ? ", required" : ""}`}
        className="group/property grid gap-1 border-b rule py-3 last:border-b-0 sm:grid-cols-[12rem_minmax(0,1fr)] sm:items-start sm:gap-6 xl:grid-cols-1 xl:gap-1"
      >
        <div className="pt-1 xl:pt-0">
          <div className="flex items-center justify-between gap-2">
            <span
              className="label flex min-w-0 items-center gap-1.5 text-accent"
              title={member?.required ? `${property.name} — required` : property.name}
            >
              {changed ? (
                <span
                  aria-label="Unsaved change"
                  title="Unsaved change"
                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                />
              ) : null}
              <span className="truncate">{property.name}</span>
              {member?.required ? (
                <span className="font-normal tracking-normal text-faint normal-case">required</span>
              ) : null}
            </span>
            <FormatChip className="shrink-0 border-accent/40 bg-accent-wash text-accent-on-wash">
              {formatLabel(property.format)}
            </FormatChip>
          </div>
          {changed ? (
            <ThumbRow className="mt-0.5 w-full">
              <button
                type="button"
                className="text-[length:var(--text-label)] text-muted underline decoration-line-strong hover:text-ink pointer-coarse:min-h-11"
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
            </ThumbRow>
          ) : null}
        </div>
        <div id={`field-frame-${key}`} aria-description={`Key ${key}`}>
          <PropertyField
            key={`${objectId}:${key}:${resetToken}:${revertTokens[key] ?? 0}`}
            spaceId={spaceId}
            property={property}
            value={draft.values[key] ?? null}
            label={object.properties[key]?.label ?? ""}
            canEdit={canEdit}
            timeZone={timeZone}
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
    <div className="settle rounded-[24px] border border-line bg-surface p-5 sm:p-6" data-record-panel>
      <input
        ref={coverInput}
        aria-label="Upload cover image"
        className="sr-only"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        disabled={!canEdit || coverUpload.isPending}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          chooseCover(file);
        }}
      />
      {draft.cover !== "" ? (
        <div className="mb-4 overflow-hidden rounded-[16px] border border-line bg-raised/40">
          {repositioning ? (
            <div className="relative">
              <img
                src={thumbnailUrl(spaceId, draft.cover, 512)}
                alt=""
                className="aspect-video w-full cursor-crosshair object-cover"
                style={coverStyle}
                onClick={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  if (rect.width === 0 || rect.height === 0) {
                    return;
                  }
                  setCoverFocus(
                    ((event.clientX - rect.left) / rect.width) * 100,
                    ((event.clientY - rect.top) / rect.height) * 100,
                  );
                }}
              />
              <span
                aria-hidden
                className="pointer-events-none absolute size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.6)]"
                style={{ left: `${coverFocus.x}%`, top: `${coverFocus.y}%` }}
              />
            </div>
          ) : (
            <button
              type="button"
              aria-label="Open cover image"
              className="block w-full transition-opacity hover:opacity-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              onClick={(event) => {
                coverOpener.current = event.currentTarget;
                setCoverPreview(true);
              }}
            >
              <img
                src={thumbnailUrl(spaceId, draft.cover, 512)}
                alt=""
                className="aspect-video w-full object-cover"
                style={coverStyle}
              />
            </button>
          )}
        </div>
      ) : null}
      {repositioning ? (
        <div className="mb-4 grid gap-2 rounded-field border border-line bg-raised/25 p-2">
          <label className="grid gap-1 text-[11px] text-muted">
            Horizontal
            <input
              type="range"
              min={0}
              max={100}
              value={coverFocus.x}
              aria-label="Cover horizontal position"
              className="h-11 w-full accent-accent"
              onChange={(event) =>
                setCoverFocus(Number(event.target.value), coverFocus.y)
              }
            />
          </label>
          <label className="grid gap-1 text-[11px] text-muted">
            Vertical
            <input
              type="range"
              min={0}
              max={100}
              value={coverFocus.y}
              aria-label="Cover vertical position"
              className="h-11 w-full accent-accent"
              onChange={(event) =>
                setCoverFocus(coverFocus.x, Number(event.target.value))
              }
            />
          </label>
          <ThumbRow className="flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              className="min-h-9 px-3 text-[12px] pointer-coarse:min-h-11"
              onClick={() => setCoverFocus(50, 50)}
            >
              Center
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="min-h-9 px-3 text-[12px] pointer-coarse:min-h-11"
              onClick={cancelReposition}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="min-h-9 px-3 text-[12px] pointer-coarse:min-h-11"
              onClick={finishReposition}
            >
              Done
            </Button>
          </ThumbRow>
        </div>
      ) : null}
      {coverUpload.isPending ? (
        <p role="status" className="mb-3 text-[12px] text-muted">
          Uploading cover…
        </p>
      ) : null}
      {coverError ? (
        <div
          role="alert"
          className="mb-3 flex flex-wrap items-center gap-2 text-[12px] text-danger"
        >
          <span>{coverError}</span>
          {coverAttempt ? (
            <button
              type="button"
              className="underline decoration-danger/50 hover:decoration-danger pointer-coarse:min-h-11"
              onClick={() => chooseCover(coverAttempt)}
            >
              Retry
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="xl:grid xl:grid-cols-12 xl:gap-x-10">
      <div className="border-b rule pb-3 xl:col-span-8 xl:col-start-1">
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <span className="flex min-w-0 items-center gap-2">
            {/* A type without an icon renders no slot at all: the stand-in box
                reads as a broken image beside the record's own icon control. */}
            {type?.icon ? <ThingIcon icon={type.icon} size="md" /> : null}
            <span className="label truncate">{type?.name ?? object.type}</span>
          </span>
          <span className="flex min-w-0 items-center gap-3">
          <RecordIdentity
            objectId={object.id}
            rev={baseline.rev}
            typeKey={object.type.toUpperCase()}
          />
          {canEdit && !dirty && !saveError ? (
            <span role="status" className="record-save-pill shrink-0">
              Saved
            </span>
          ) : null}
          {canEdit && wide && (dirty || saveError) ? (
            <span className="flex shrink-0 items-center gap-2">
              {saveError ? (
                <span className="label text-danger">save failed</span>
              ) : (
                <span role="status" className="label tnum text-accent">
                  {changeCount} unsaved
                </span>
              )}
              <Button
                type="button"
                className="min-h-8 px-3 text-[12px] pointer-coarse:min-h-11"
                disabled={!dirty || update.isPending || invalid.size > 0}
                title="Save (Cmd/Ctrl+S or Cmd/Ctrl+Enter)"
                onClick={() => void save()}
              >
                {update.isPending ? "Saving…" : saveError ? "Retry" : "Save"}
              </Button>
            </span>
          ) : null}
          <ThumbRow className="shrink-0 items-center gap-1">
            {canEdit ? (
              <IconPicker
                variant="glyph"
                label="Record icon"
                value={draft.icon}
                onChange={(icon) => setDraft((current) => ({ ...current, icon }))}
                disabled={update.isPending}
              />
            ) : draft.icon ? (
              <ThingIcon icon={draft.icon} name={draft.title} size="md" />
            ) : null}
            {canEdit ? (
              <RecordOverflow
                revertLabel={headerRevertLabel}
                onRevert={revertHeader}
                hasCover={draft.cover !== ""}
                onChooseCover={() => coverInput.current?.click()}
                onRemoveCover={removeCover}
                onRepositionCover={startReposition}
                coverPending={coverUpload.isPending}
                typeHref={`/s/${spaceId}/schema?type=${encodeURIComponent(object.type)}#type-editor`}
                typeName={type?.name ?? object.type}
                onDuplicate={duplicateRecord}
                duplicating={duplicate.isPending}
                duplicateDisabled={dirty}
              />
            ) : null}
          </ThumbRow>
          </span>
        </div>

        {canEdit ? (
          <input
            aria-label="Title"
            className="display mt-1 block min-h-10 w-full min-w-0 border-0 bg-transparent p-0 text-title placeholder:text-faint focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent pointer-coarse:min-h-11"
            maxLength={200}
            placeholder={`Untitled ${(type?.name ?? object.type).toLowerCase()}`}
            disabled={update.isPending}
            value={draft.title}
            onChange={(event) =>
              setDraft((current) => ({ ...current, title: event.target.value }))
            }
          />
        ) : (
          <h1 className="display mt-1 text-title">{draft.title}</h1>
        )}

        <p className="mt-2 flex flex-wrap items-baseline gap-x-2 font-mono text-[length:var(--text-small)] text-faint">
          <span>updated {formatDate(object.updated_at, timeZone)}</span>
          <span className="max-sm:hidden">· created {formatDate(object.created_at, timeZone)}</span>
          {canEdit ? null : <span className="label">read only</span>}
        </p>
      </div>

      {type?.schedule && object.schedule ? (
        <section
          aria-label="Schedule"
          className="mt-4 border-y rule py-2.5 xl:col-span-8 xl:col-start-1"
        >
          <ThumbRow className="items-center gap-4">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-[length:var(--text-small)] sm:gap-x-5">
            <span className={cn("label", dueTone(object.schedule.status))}>
              {STATUS_LABELS[object.schedule.status]}
            </span>
            {object.schedule.due_date ? (
              <span className="text-muted">
                {dueLabel}{" "}
                <span className={cn("tnum", dueTone(object.schedule.status))}>
                  {formatDay(object.schedule.due_date)}
                </span>
              </span>
            ) : null}
            {object.schedule.status === "overdue" &&
            object.schedule.days_until_due !== undefined ? (
              <span className="text-danger tnum">
                {Math.abs(object.schedule.days_until_due)}d overdue
              </span>
            ) : null}
            {object.schedule.status === "upcoming" &&
            object.schedule.days_until_due !== undefined ? (
              <span className="text-muted tnum">
                in {object.schedule.days_until_due}d
              </span>
            ) : null}
            {type.schedule && object.properties.recurrence?.label ? (
              <span className="text-muted">
                {object.properties.recurrence.label}
              </span>
            ) : null}
            {object.schedule.completed_at ? (
              <span className="text-faint">
                {completedLabel}{" "}
                <span className="tnum">
                  {formatDateTime(object.schedule.completed_at, timeZone)}
                </span>
              </span>
            ) : null}
          </div>
          {canEdit && object.schedule.status !== "done" ? (
            <Button
              type="button"
              title={verb}
              className="min-h-8 min-w-0 max-w-[45%] shrink-0 px-3 text-[length:var(--text-small)] sm:max-w-[12rem] pointer-coarse:min-h-11"
              disabled={complete.isPending || confirmComplete}
              onClick={onComplete}
            >
              {/* A user-set verb can be a sentence; the strip keeps its width. */}
              <span className="min-w-0 truncate">
                {complete.isPending ? "Saving…" : verb}
              </span>
            </Button>
          ) : null}
          </ThumbRow>
        </section>
      ) : null}

      {confirmComplete ? (
        <div
          role="alertdialog"
          aria-label="Complete record"
          className="mt-4 grid max-w-[52ch] gap-2 border-y rule py-3 xl:col-span-8 xl:col-start-1"
        >
          <p className="text-[13px]">
            This record has {changeCount} unsaved{" "}
            {changeCount === 1 ? "change" : "changes"}.{" "}
            {changeCount === 1 ? "Save it" : "Save them"} before completing?
          </p>
          <ThumbRow className="flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              className="min-h-8 px-3 text-[12px] pointer-coarse:min-h-11"
              onClick={() => setConfirmComplete(false)}
            >
              Cancel
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
              className="min-h-8 px-3 text-[12px] pointer-coarse:min-h-11"
              disabled={update.isPending}
              onClick={() => void saveThenComplete()}
            >
              {update.isPending ? "Saving…" : "Save changes and complete"}
            </Button>
          </ThumbRow>
        </div>
      ) : null}

      {conflict ? (
        <div
          role="alert"
          className="mt-4 max-w-[52ch] border-l border-warning pl-3 text-[13px] text-warning xl:col-span-8 xl:col-start-1"
        >
          <p>{conflict}</p>
          <ThumbRow className="mt-2 flex-wrap items-center gap-2">
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
          </ThumbRow>
        </div>
      ) : stale ? (
        <div
          role="status"
          className="mt-4 max-w-[52ch] border-l border-warning pl-3 text-[13px] text-warning xl:col-span-8 xl:col-start-1"
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
        className="mt-6 m-0 min-w-0 border-t rule pt-4 xl:col-span-4 xl:col-start-9 xl:mt-0 xl:border-t-0 xl:border-l xl:border-line xl:pt-0 xl:pl-8 xl:[grid-row:1/span_99]"
      >
        <div className="xl:sticky xl:top-[calc(var(--shell-header-h)+1rem)]">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="flex items-center gap-2 text-heading font-medium">
            <SlidersHorizontal aria-hidden size={15} strokeWidth={1.5} className="text-muted" />
            Properties
            <span className="font-mono text-[length:var(--text-small)] font-normal text-faint tnum">
              {keys.length}
            </span>
          </h2>
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
        </div>
      </fieldset>

      <section aria-label="Body" className="mt-10 xl:col-span-8 xl:col-start-1 xl:mt-8">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3 border-b rule pb-2">
          <div className="min-w-0">
            <h2 className="label flex flex-wrap items-center gap-x-1.5 gap-y-1">
              <AlignLeft aria-hidden size={13} strokeWidth={1.5} className="text-muted" />
              <span
                aria-label="Unsaved change"
                title="Unsaved change"
                className={cn(
                  "h-1.5 w-1.5 rounded-full bg-accent",
                  !bodyChanged && "invisible",
                )}
              />
              Body
              <span className="font-mono text-[11px] font-normal tracking-normal text-faint normal-case tnum">
                {bodyWords} {bodyWords === 1 ? "word" : "words"} · {bodyChars}{" "}
                {bodyChars === 1 ? "character" : "characters"}
              </span>
            </h2>
            {highlight ? (
              <p className="mt-0.5 flex items-center gap-2 text-[length:var(--text-label)] text-faint">
                <span className="truncate">Match: “{highlight}”</span>
                {onClearHighlight ? (
                  <button
                    type="button"
                    className="shrink-0 underline decoration-line-strong hover:text-ink pointer-coarse:min-h-11"
                    onClick={onClearHighlight}
                  >
                    Clear
                  </button>
                ) : null}
              </p>
            ) : null}
          </div>
          {canEdit ? (
            <button
              type="button"
              className={cn(
                "label px-2 text-muted underline decoration-line-strong hover:text-ink pointer-coarse:min-h-11",
                !bodyChanged && "invisible",
              )}
              onClick={() => setDraft((current) => ({ ...current, body: baseline.body }))}
            >
              Revert
            </button>
          ) : null}
        </div>
        {canEdit ? (
          <MarkdownEditor
            value={draft.body}
            onChange={(body) => setDraft((current) => ({ ...current, body }))}
            disabled={update.isPending}
            spaceId={spaceId}
            resetToken={resetToken}
            dirty={dirty}
            saving={update.isPending}
            error={saveError ?? conflict}
            onSave={() => void save()}
            preview={(text) => (
              <MarkdownView
                text={text}
                links={object.links}
                spaceId={spaceId}
                highlight={highlight}
              />
            )}
          />
        ) : (
          <div className="mt-2 min-h-[22rem] rounded-[14px] border border-line-interactive/70 bg-raised/30 px-3">
            <MarkdownView
              text={draft.body}
              links={object.links}
              spaceId={spaceId}
              highlight={highlight}
            />
          </div>
        )}
      </section>

      {children ? (
        <div className="xl:col-span-8 xl:col-start-1">{children}</div>
      ) : null}

      {canEdit ? (
        <section
          aria-label="Trash"
          className="mt-10 border-t rule pt-4 xl:col-span-8 xl:col-start-1"
        >
          {confirmingTrash ? (
            <div
              role="group"
              aria-label="Move to trash"
              className="grid gap-2 border-l border-danger pl-3"
            >
              <p className="max-w-[46ch] text-[13px] text-muted">
                Move “{draft.title.trim() || object.title}” to the trash? The file and its history
                are kept until purged.
                {dirty ? " Unsaved changes are discarded." : ""}
              </p>
              <ThumbRow className="flex-wrap items-center gap-2">
                <Button
                  variant="ghost"
                  className="min-h-8 px-3 text-[13px] pointer-coarse:min-h-11"
                  onClick={() => setConfirmingTrash(false)}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  className="min-h-8 px-3 text-[13px] pointer-coarse:min-h-11"
                  disabled={trash.isPending}
                  onClick={moveToTrash}
                >
                  {trash.isPending ? "Moving…" : "Move to trash"}
                </Button>
              </ThumbRow>
            </div>
          ) : (
            <ThumbRow>
              <button
                type="button"
                className="text-[13px] text-danger underline decoration-danger/40 underline-offset-2 hover:decoration-danger pointer-coarse:min-h-11"
                onClick={() => setConfirmingTrash(true)}
              >
                Move record to trash
              </button>
            </ThumbRow>
          )}
        </section>
      ) : null}

      </div>

      {canEdit ? (
        dirty || saveError ? (
          wide ? null : (
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
            <span
              role="status"
              className={cn(
                "label flex items-center gap-1.5",
                dirty && "text-accent",
              )}
            >
              {dirty ? (
                <>
                  <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
                  {changeCount} unsaved {changeCount === 1 ? "change" : "changes"}
                </>
              ) : (
                "Saved"
              )}
            </span>
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
          )
        ) : null
      ) : null}
      {renamePrompt ? (
        <RenameLinksDialog
          spaceId={spaceId}
          oldTitle={renamePrompt.oldTitle}
          newTitle={renamePrompt.newTitle}
          mentions={renamePrompt.mentions}
          pending={renamePending}
          error={renameError}
          onUpdateLinks={(sources) => void updateLinks(sources)}
          onRenameOnly={() => void renameOnly()}
          onCancel={() => {
            if (!renamePending) {
              setRenamePrompt(null);
              setRenameError(null);
            }
          }}
        />
      ) : null}
      {guard}
      {coverPreview && draft.cover !== "" ? (
        <ImageLightbox
          spaceId={spaceId}
          images={[{ path: draft.cover, title: object.title }]}
          index={0}
          onIndexChange={() => {}}
          returnFocus={coverOpener}
          onClose={() => setCoverPreview(false)}
        />
      ) : null}
    </div>
  );
}
