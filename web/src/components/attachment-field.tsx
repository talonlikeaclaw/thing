import { ClipboardPaste, FileText, Image as ImageIcon, Plus, Star } from "lucide-react";
import { useRef, useState, type DragEvent } from "react";

import { useUploadFile } from "@/api/queries";
import { AttachmentMenu } from "@/components/attachment-menu";
import { ThumbRow, useThumbHandedness } from "@/components/handedness";
import { ImageLightbox } from "@/components/image-lightbox";
import { Button, focusRing } from "@/components/ui/controls";
import { cn } from "@/lib/cn";
import { readError } from "@/lib/display";
import {
  MAX_UPLOAD_BYTES,
  fileName,
  fileUrl,
  imagePaths,
  isAcceptedImageType,
  isImagePath,
  thumbnailUrl,
} from "@/lib/files";

interface AttachmentFieldProps {
  spaceId: string;
  /** The stored list, or anything else the record holds for this key. */
  value: unknown;
  disabled?: boolean;
  /** Called with the ordered list, or `null` when the last item is removed. */
  onChange: (list: string[] | null) => void;
  /** Present in a cell editor, which stages its changes until Done. */
  onCancel?: () => void;
  /** The record's cover action; absent when the caller cannot set one. */
  onSetCover?: (path: string) => void;
  /** The path the record already uses as its cover. */
  coverPath?: string;
  /** Buffer adds, removals and uploads until one Done commits the list. */
  defer?: boolean;
}

interface FailedFile {
  file: File;
  message: string;
  /** A local refusal will fail the same way again, so it offers no Retry. */
  retryable: boolean;
}

/** The stored paths of an `attachments` value, in upload order. */
function storedPaths(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string" && entry !== "");
}

/** A refusal the server would answer identically, found before spending an upload. */
function localRefusal(file: File): string | null {
  if (file.size > MAX_UPLOAD_BYTES) {
    return "A file may be at most 10 MiB.";
  }
  if (file.type.startsWith("image/") && !isAcceptedImageType(file.type)) {
    return "Choose a PNG, JPEG, WebP or GIF image.";
  }
  return null;
}

/**
 * An ordered set of stored files. Images read as a grid of thumbnails, every
 * other file as a row; adding, removing and pasting append or drop in place, and
 * the caller gets the whole list. A failed upload leaves the list untouched and
 * offers Retry over the same bytes.
 */
export function AttachmentField({
  spaceId,
  value,
  disabled = false,
  onChange,
  onCancel,
  onSetCover,
  coverPath,
  defer = false,
}: AttachmentFieldProps) {
  const handedness = useThumbHandedness();
  const upload = useUploadFile(spaceId);
  const input = useRef<HTMLInputElement | null>(null);
  const [draft, setDraft] = useState<string[]>(() => storedPaths(value));
  const [uploading, setUploading] = useState(false);
  const [failed, setFailed] = useState<FailedFile[]>([]);
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<number | null>(null);
  /** The path whose removal is waiting for confirmation. */
  const [removing, setRemoving] = useState<string | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const stored = storedPaths(value);
  const list = defer ? draft : stored;
  const images = imagePaths(list);
  const files = list.filter((path) => !isImagePath(path));
  const busy = uploading || disabled;

  function remove(path: string) {
    write(list.filter((entry) => entry !== path));
    setRemoving(null);
  }

  function write(next: string[]) {
    if (defer) {
      setDraft(next);
      return;
    }
    onChange(next.length === 0 ? null : next);
  }

  /** Uploads one batch in order and appends what the store accepts. */
  async function uploadBatch(batch: File[]) {
    if (busy || batch.length === 0) {
      return;
    }
    setUploading(true);
    const next = [...list];
    const outcomes: FailedFile[] = [];
    for (const file of batch) {
      const refusal = localRefusal(file);
      if (refusal) {
        outcomes.push({ file, message: refusal, retryable: false });
        continue;
      }
      try {
        const result = await upload.mutateAsync(file);
        next.push(result.path);
      } catch (failure) {
        outcomes.push({ file, message: readError(failure), retryable: true });
      }
    }
    setUploading(false);
    setFailed((current) => [
      ...current.filter((entry) => !batch.includes(entry.file)),
      ...outcomes,
    ]);
    if (next.length !== list.length) {
      write(next);
    }
  }

  function picked(filesPicked: FileList | null) {
    if (filesPicked && filesPicked.length > 0) {
      void uploadBatch(Array.from(filesPicked));
    }
  }

  function dropped(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    picked(event.dataTransfer.files);
  }

  async function paste() {
    if (busy) {
      return;
    }
    setPasteError(null);
    try {
      const items = await navigator.clipboard.read();
      const pasted: File[] = [];
      for (const item of items) {
        const type = item.types.find(isAcceptedImageType);
        if (!type) {
          continue;
        }
        const blob = await item.getType(type);
        pasted.push(new File([blob], `pasted-${pasted.length + 1}.png`, { type }));
      }
      await uploadBatch(pasted);
    } catch {
      setPasteError("The clipboard could not be read; use Choose files instead.");
    }
  }

  return (
    <div
      className={cn(
        "grid max-w-[34rem] gap-2 rounded-field border border-line-interactive/70 bg-raised/25 p-2 transition-colors",
        dragging && "border-accent bg-accent-wash",
      )}
      data-drop-target={dragging ? "" : undefined}
      onDragEnter={(event) => {
        event.preventDefault();
        if (!busy) {
          setDragging(true);
        }
      }}
      onDragOver={(event) => {
        event.preventDefault();
      }}
      onDragLeave={(event) => {
        const to = event.relatedTarget;
        if (!(to instanceof Node) || !event.currentTarget.contains(to)) {
          setDragging(false);
        }
      }}
      onDrop={dropped}
    >
      <input
        ref={input}
        aria-label="Upload attachments"
        className="sr-only"
        type="file"
        multiple
        disabled={busy}
        onChange={(event) => {
          picked(event.target.files);
          // Clearing the field lets the same file be chosen again for a retry.
          event.target.value = "";
        }}
      />

      {images.length > 0 ? (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {images.map((path) => {
            const index = images.indexOf(path);
            const cover = path === coverPath;
            return (
              <li key={path} className="relative min-w-0">
                <button
                  type="button"
                  aria-label={`Open image ${fileName(path)}`}
                  className={cn("block w-full rounded-[8px]", focusRing)}
                  disabled={disabled}
                  onClick={(event) => {
                    opener.current = event.currentTarget;
                    setPreview(index);
                  }}
                >
                  <img
                    src={thumbnailUrl(spaceId, path, 256)}
                    alt=""
                    loading="lazy"
                    className="aspect-square w-full rounded-[8px] border rule object-cover"
                  />
                </button>
                <AttachmentMenu
                  label={fileName(path)}
                  onImage
                  canSetCover={onSetCover !== undefined && !cover}
                  disabled={busy}
                  onSetCover={() => onSetCover?.(path)}
                  onRemove={() => setRemoving(path)}
                  className={cn(
                    "absolute top-1",
                    handedness === "left" ? "left-1" : "right-1",
                  )}
                />
                {cover ? (
                  <span
                    className={cn(
                      "absolute top-1 inline-flex items-center gap-1 rounded-full border border-accent/80 bg-black/55 px-2 py-1 text-[11px] text-white backdrop-blur-md",
                      handedness === "left" ? "right-1" : "left-1",
                    )}
                  >
                    <Star aria-hidden size={12} className="text-accent" />
                    Cover
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {files.length > 0 ? (
        <ul className="grid gap-1">
          {files.map((path) => (
            <li
              key={path}
              className={cn(
                "flex items-center gap-2",
                handedness === "left" && "flex-row-reverse",
              )}
            >
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-[8px] bg-ground text-muted">
                  <FileText aria-hidden size={16} />
                </span>
                <a
                  href={fileUrl(spaceId, path)}
                  download={fileName(path)}
                  className={cn(
                    "min-w-0 flex-1 truncate text-[13px] text-ink underline decoration-line-strong hover:decoration-ink",
                    focusRing,
                  )}
                >
                  {fileName(path)}
                </a>
              </span>
              <AttachmentMenu
                label={fileName(path)}
                disabled={busy}
                onRemove={() => setRemoving(path)}
              />
            </li>
          ))}
        </ul>
      ) : null}

      {list.length === 0 ? (
        <button
          type="button"
          className={cn(
            "flex min-h-16 w-full flex-col items-center justify-center gap-1 rounded-[10px] border border-dashed border-line-strong px-3 py-3 text-center text-muted transition-colors hover:border-accent hover:text-ink disabled:opacity-50 pointer-coarse:min-h-[var(--control-coarse)]",
            focusRing,
          )}
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          <ImageIcon aria-hidden size={18} />
          <span className="text-[13px]">Add files or drop them here</span>
        </button>
      ) : null}

      <ThumbRow className="flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          className="min-h-9 gap-1 px-3 text-[12px] pointer-coarse:min-h-11"
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          <Plus aria-hidden size={13} />
          Add files
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="min-h-9 gap-1 px-3 text-[12px] pointer-coarse:min-h-11"
          disabled={busy}
          onClick={() => void paste()}
        >
          <ClipboardPaste aria-hidden size={13} />
          Paste
        </Button>
        {defer ? (
          <>
            {onCancel ? (
              <button
                type="button"
                className={cn(
                  "text-[12px] text-faint hover:text-ink pointer-coarse:min-h-11",
                  focusRing,
                )}
                onClick={onCancel}
              >
                Cancel
              </button>
            ) : null}
            <Button
              type="button"
              className="min-h-9 px-3 text-[12px] pointer-coarse:min-h-11"
              disabled={busy}
              onClick={() => onChange(draft.length === 0 ? null : draft)}
            >
              Done
            </Button>
          </>
        ) : null}
      </ThumbRow>

      {removing ? (
        <div
          role="alertdialog"
          aria-label={`Remove ${fileName(removing)}?`}
          className="grid gap-2 rounded-[10px] border border-line-strong bg-ground/60 p-2"
        >
          <p className="text-[12px] text-muted">
            Remove “{fileName(removing)}” from this record?
          </p>
          <ThumbRow className="flex-wrap items-center gap-2 lg:justify-start">
            <Button
              type="button"
              variant="destructive"
              className="min-h-9 px-3 text-[12px] pointer-coarse:min-h-11"
              disabled={busy}
              onClick={() => remove(removing)}
            >
              Remove
            </Button>
            <button
              type="button"
              className={cn(
                "text-[12px] text-faint hover:text-ink pointer-coarse:min-h-11",
                focusRing,
              )}
              onClick={() => setRemoving(null)}
            >
              Keep
            </button>
          </ThumbRow>
        </div>
      ) : null}

      {uploading ? (
        <span role="status" className="text-[11px] text-muted">
          Uploading…
        </span>
      ) : null}
      {pasteError ? (
        <p role="alert" className="text-[12px] text-danger">
          {pasteError}
        </p>
      ) : null}
      {failed.length > 0 ? (
        <ul className="grid gap-1">
          {failed.map((entry) => (
            <li
              key={`${entry.file.name}:${entry.file.lastModified}:${entry.message}`}
              role="alert"
              className="flex flex-wrap items-center gap-2 text-[12px] text-danger"
            >
              <span>
                {entry.file.name}: {entry.message}
              </span>
              {entry.retryable ? (
                <button
                  type="button"
                  className={cn(
                    "underline decoration-danger/50 hover:decoration-danger pointer-coarse:min-h-11",
                    focusRing,
                  )}
                  onClick={() => void uploadBatch([entry.file])}
                >
                  Retry
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {preview !== null && images.length > 0 ? (
        <ImageLightbox
          spaceId={spaceId}
          images={images.map((path) => ({ path, title: fileName(path) }))}
          index={preview}
          onIndexChange={setPreview}
          returnFocus={opener}
          onClose={() => setPreview(null)}
        />
      ) : null}
    </div>
  );
}
