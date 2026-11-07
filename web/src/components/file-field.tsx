import { FileText, Image as ImageIcon, Upload } from "lucide-react";
import { useRef, useState, type DragEvent } from "react";

import { useUploadFile } from "@/api/queries";
import { AttachmentMenu } from "@/components/attachment-menu";
import { ThumbRow, useThumbHandedness } from "@/components/handedness";
import { ImageLightbox } from "@/components/image-lightbox";
import { Button, focusRing } from "@/components/ui/controls";
import { cn } from "@/lib/cn";
import { readError } from "@/lib/display";
import {
  ACCEPTED_IMAGES,
  MAX_UPLOAD_BYTES,
  fileName,
  fileUrl,
  isAcceptedImageType,
  thumbnailUrl,
} from "@/lib/files";

interface FileFieldProps {
  spaceId: string;
  format: "file" | "image";
  /** The stored path, or any other value the record holds for this key. */
  value: unknown;
  disabled?: boolean;
  /** Called with the uploaded path, or `null` when the value is removed. */
  onChange: (value: string | null) => void;
  /** Present in a cell editor, which can be dismissed without a value. */
  onCancel?: () => void;
  /** An image value can become the record's cover; absent leaves it alone. */
  onSetCover?: (path: string) => void;
  /** The path the record already uses as its cover. */
  coverPath?: string;
}

/**
 * One file or image value: choose or drop bytes, see what is stored, replace it
 * or remove it. A failed upload never touches the caller's value, so the
 * previous file survives while Retry offers the same bytes again.
 */
export function FileField({
  spaceId,
  format,
  value,
  disabled = false,
  onChange,
  onCancel,
  onSetCover,
  coverPath,
}: FileFieldProps) {
  const upload = useUploadFile(spaceId);
  const input = useRef<HTMLInputElement | null>(null);
  const [attempt, setAttempt] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const handedness = useThumbHandedness();
  const left = handedness === "left";
  const path = typeof value === "string" && value.trim() !== "" ? value.trim() : null;
  const image = format === "image";
  const noun = image ? "image" : "file";
  const busy = upload.isPending || disabled;

  function send(file: File) {
    if (busy) {
      return;
    }
    setAttempt(file);
    setError(null);
    upload.mutate(file, {
      onSuccess: (stored) => {
        setAttempt(null);
        onChange(stored.path);
      },
      onError: (failure) => setError(readError(failure)),
    });
  }

  /** A local refusal keeps the previous value and never spends an upload. */
  function pick(file: File | undefined) {
    if (!file) {
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setAttempt(null);
      setError("A file may be at most 10 MiB.");
      return;
    }
    if (image && file.type !== "" && !isAcceptedImageType(file.type)) {
      setAttempt(null);
      setError("Choose a PNG, JPEG, WebP or GIF image.");
      return;
    }
    send(file);
  }

  function dropped(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    pick(event.dataTransfer.files?.[0]);
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
        aria-label={`Upload ${noun}`}
        className="sr-only"
        type="file"
        accept={image ? ACCEPTED_IMAGES : undefined}
        disabled={busy}
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Clearing the field lets the same file be chosen again for a retry.
          event.target.value = "";
          pick(file);
        }}
      />

      {path ? (
        <div className="flex flex-wrap items-center gap-2">
          <div
            className={cn(
              "flex min-w-0 flex-1 items-center gap-2",
              left && "order-2",
            )}
          >
          {image ? (
            <button
              type="button"
              aria-label={`Open image ${fileName(path)}`}
              className={cn(
                "shrink-0 rounded-[8px] transition-opacity hover:opacity-90",
                focusRing,
              )}
              onClick={(event) => {
                opener.current = event.currentTarget;
                setPreview(true);
              }}
            >
              <img
                src={thumbnailUrl(spaceId, path, 256)}
                alt=""
                className="size-14 rounded-[8px] object-cover"
              />
            </button>
          ) : (
            <span className="flex size-14 shrink-0 items-center justify-center rounded-[8px] bg-ground text-muted">
              <FileText aria-hidden size={20} />
            </span>
          )}
          <div className="min-w-[8rem] flex-1">
            {image ? (
              <button
                type="button"
                className={cn(
                  "block max-w-full min-w-0 text-left text-[14px] text-ink underline decoration-line-strong hover:decoration-ink pointer-coarse:flex pointer-coarse:min-h-11 pointer-coarse:items-center",
                  focusRing,
                )}
                onClick={(event) => {
                  opener.current = event.currentTarget;
                  setPreview(true);
                }}
              >
                <span className="truncate">{fileName(path)}</span>
              </button>
            ) : (
              <a
                href={fileUrl(spaceId, path)}
                download={fileName(path)}
                className={cn(
                  "block max-w-full min-w-0 text-[14px] text-ink underline decoration-line-strong hover:decoration-ink pointer-coarse:flex pointer-coarse:min-h-11 pointer-coarse:items-center",
                  focusRing,
                )}
              >
                <span className="truncate">{fileName(path)}</span>
              </a>
            )}
            <span className="text-[11px] text-faint">{image ? "Image" : "File"}</span>
          </div>
          </div>
          {/* The destructive action sits furthest from the thumb edge, so a
              reach never lands on it by mistake: reversed DOM order in left mode. */}
          <div
            className={cn(
              "flex shrink-0 items-center gap-1",
              left && "order-1 flex-row-reverse",
            )}
          >
            <AttachmentMenu
              label={noun}
              canSetCover={image && onSetCover !== undefined && path !== coverPath}
              disabled={busy}
              onSetCover={() => onSetCover?.(path)}
              onRemove={() => setConfirming(true)}
            />
            {image && onSetCover && path === coverPath ? (
              <span className="inline-flex min-h-8 items-center rounded-full bg-accent-wash px-2.5 text-[12px] text-accent-on-wash pointer-coarse:min-h-11">
                Cover
              </span>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              className="min-h-8 px-3 text-[12px] pointer-coarse:min-h-11"
              disabled={busy}
              onClick={() => input.current?.click()}
            >
              Replace
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className={cn(
            "flex min-h-16 w-full flex-col items-center justify-center gap-1 rounded-[10px] border border-dashed border-line-strong px-3 py-3 text-center text-muted transition-colors hover:border-accent hover:text-ink disabled:opacity-50 pointer-coarse:min-h-[var(--control-coarse)]",
            focusRing,
          )}
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          {image ? (
            <ImageIcon aria-hidden size={18} />
          ) : (
            <Upload aria-hidden size={18} />
          )}
          <span className="text-[13px]">Choose {noun} or drop it here</span>
        </button>
      )}

      {confirming ? (
        <div
          role="alertdialog"
          aria-label={`Remove ${noun}?`}
          className="grid gap-2 rounded-[10px] border border-line-strong bg-ground/60 p-2"
        >
          <p className="text-[12px] text-muted">
            Remove {path ? `“${fileName(path)}”` : `this ${noun}`} from this record?
          </p>
          <ThumbRow className="flex-wrap items-center gap-2 lg:justify-start">
            <Button
              type="button"
              variant="destructive"
              className="min-h-9 px-3 text-[12px] pointer-coarse:min-h-11"
              disabled={busy}
              onClick={() => {
                setConfirming(false);
                setAttempt(null);
                setError(null);
                onChange(null);
              }}
            >
              Remove
            </Button>
            <button
              type="button"
              className={cn(
                "text-[12px] text-faint hover:text-ink pointer-coarse:min-h-11",
                focusRing,
              )}
              onClick={() => setConfirming(false)}
            >
              Keep
            </button>
          </ThumbRow>
        </div>
      ) : null}
      {upload.isPending ? (
        <span role="status" className="text-[11px] text-muted">
          Uploading…
        </span>
      ) : null}
      {error ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 text-[12px] text-danger"
        >
          <span>{error}</span>
          {attempt ? (
            <button
              type="button"
              className={cn(
                "underline decoration-danger/50 hover:decoration-danger pointer-coarse:min-h-11",
                focusRing,
              )}
              onClick={() => send(attempt)}
            >
              Retry
            </button>
          ) : null}
        </div>
      ) : null}
      {onCancel ? (
        <button
          type="button"
          className={cn(
            "text-[12px] text-faint hover:text-ink pointer-coarse:min-h-11",
            focusRing,
            left ? "justify-self-start" : "justify-self-end",
          )}
          onClick={onCancel}
        >
          Cancel
        </button>
      ) : null}
      {preview && path ? (
        <ImageLightbox
          spaceId={spaceId}
          images={[{ path, title: fileName(path) }]}
          index={0}
          onIndexChange={() => {}}
          returnFocus={opener}
          onClose={() => setPreview(false)}
        />
      ) : null}
    </div>
  );
}
