import { FileText, Image as ImageIcon, Upload, X } from "lucide-react";
import { useRef, useState, type DragEvent } from "react";

import { useUploadFile } from "@/api/queries";
import { ImageLightbox } from "@/components/image-lightbox";
import { Button, focusRing } from "@/components/ui/controls";
import { cn } from "@/lib/cn";
import { readError } from "@/lib/display";
import { fileName, fileUrl, thumbnailUrl } from "@/lib/files";

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
}

const ACCEPTED_IMAGES = "image/png,image/jpeg,image/webp,image/gif";
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

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
}: FileFieldProps) {
  const upload = useUploadFile(spaceId);
  const input = useRef<HTMLInputElement | null>(null);
  const [attempt, setAttempt] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
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
    if (image && file.type !== "" && !IMAGE_TYPES.has(file.type)) {
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
                  "block max-w-full truncate text-left text-[14px] text-ink underline decoration-line-strong hover:decoration-ink",
                  focusRing,
                )}
                onClick={(event) => {
                  opener.current = event.currentTarget;
                  setPreview(true);
                }}
              >
                {fileName(path)}
              </button>
            ) : (
              <a
                href={fileUrl(spaceId, path)}
                download={fileName(path)}
                className={cn(
                  "block truncate text-[14px] text-ink underline decoration-line-strong hover:decoration-ink",
                  focusRing,
                )}
              >
                {fileName(path)}
              </a>
            )}
            <span className="text-[11px] text-faint">{image ? "Image" : "File"}</span>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              className="min-h-9 px-3 text-[12px] pointer-coarse:min-h-11"
              disabled={busy}
              onClick={() => input.current?.click()}
            >
              Replace
            </Button>
            <button
              type="button"
              aria-label={`Remove ${noun}`}
              className={cn(
                "inline-flex size-9 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-50 pointer-coarse:size-11",
                focusRing,
              )}
              disabled={busy}
              onClick={() => {
                setAttempt(null);
                setError(null);
                onChange(null);
              }}
            >
              <X aria-hidden size={15} />
            </button>
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
            "justify-self-start text-[12px] text-faint hover:text-ink pointer-coarse:min-h-11",
            focusRing,
          )}
          onClick={onCancel}
        >
          Cancel
        </button>
      ) : null}
      {preview && path ? (
        <ImageLightbox
          spaceId={spaceId}
          path={path}
          title={fileName(path)}
          returnFocus={opener}
          onClose={() => setPreview(false)}
        />
      ) : null}
    </div>
  );
}
