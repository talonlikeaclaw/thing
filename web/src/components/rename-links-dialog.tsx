import { Dialog } from "@base-ui/react/dialog";
import { useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useEffect, useState } from "react";

import { fetchObjectDetail, queryKeys, useTypes } from "@/api/queries";
import type { MentionBacklink, ObjectDetail } from "@/api/types";
import { ThumbRow, useHandedness } from "@/components/handedness";
import { ThingIcon } from "@/components/thing-icon";
import { Button, FormError } from "@/components/ui/controls";
import { SheetPopup, SheetViewport } from "@/components/ui/sheet";
import { cn } from "@/lib/cn";

/** A source record as it looked when the dialog opened, before the rename. */
export interface MentionSource {
  mention: MentionBacklink;
  detail: ObjectDetail | null;
}

interface RenameLinksDialogProps {
  spaceId: string;
  oldTitle: string;
  newTitle: string;
  mentions: MentionBacklink[];
  pending: boolean;
  error: string | null;
  onUpdateLinks: (sources: MentionSource[]) => void;
  onRenameOnly: () => void;
  onCancel: () => void;
}

/**
 * The preview before a rename: which records link to this one, and how many
 * times. Source bodies are read here, while the old title still resolves, so
 * the rewrite can tell the links that point at this record from every other
 * one. Applying is the caller's decision; this dialog only reports.
 */
export function RenameLinksDialog({
  spaceId,
  oldTitle,
  newTitle,
  mentions,
  pending,
  error,
  onUpdateLinks,
  onRenameOnly,
  onCancel,
}: RenameLinksDialogProps) {
  const { handedness } = useHandedness();
  const queryClient = useQueryClient();
  const [sources, setSources] = useState<MentionSource[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const types = useTypes(spaceId);
  const names = new Map((types.data ?? []).map((type) => [type.key, type.name]));

  useEffect(() => {
    let active = true;
    setSources(null);
    setLoadError(null);
    void Promise.all(
      mentions.map(async (mention) => {
        try {
          const detail = await queryClient.fetchQuery({
            queryKey: queryKeys.object(spaceId, mention.id),
            queryFn: () => fetchObjectDetail(spaceId, mention.id),
          });
          return { mention, detail };
        } catch {
          return { mention, detail: null };
        }
      }),
    ).then((rows) => {
      if (!active) {
        return;
      }
      setSources(rows);
      if (rows.some((row) => row.detail === null)) {
        setLoadError(
          "Some records could not be read. Updating links will skip them and leave their text as it is.",
        );
      }
    });
    return () => {
      active = false;
    };
  }, [mentions, queryClient, spaceId]);

  const loading = sources === null;
  const close = (
    <Dialog.Close
      key="close"
      aria-label="Close rename links"
      disabled={pending}
      className={cn(
        "inline-flex min-h-8 min-w-8 shrink-0 items-center justify-center rounded-full text-faint transition-colors hover:bg-raised hover:text-ink disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:min-h-11 pointer-coarse:min-w-11",
        handedness === "left" ? "-ml-1" : "-mr-1",
      )}
    >
      <X aria-hidden size={15} />
    </Dialog.Close>
  );

  const title = (
    <div>
      <Dialog.Title className="text-[17px] font-medium">Rename and update links?</Dialog.Title>
      <Dialog.Description className="mt-1 max-w-[48ch] text-[13px] text-muted">
        “{oldTitle}” becomes “{newTitle}”. Records that mention it in their body can be updated
        to the new title, or left alone and shown as unresolved.
      </Dialog.Description>
    </div>
  );

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !pending) {
          onCancel();
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 scrim" />
        <SheetViewport>
          <SheetPopup className="sm:w-[32rem]">
            <div
              className={cn(
                "flex items-baseline gap-4 border-b rule px-4 py-3",
                handedness === "left" ? "justify-start" : "justify-between",
              )}
            >
              {handedness === "left" ? (
                <>
                  {close}
                  {title}
                </>
              ) : (
                <>
                  {title}
                  {close}
                </>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <h3 className="label">Records that mention it</h3>
              <ul aria-label="Records that mention this one" className="mt-1 border-t rule">
                {mentions.map((mention) => (
                  <li
                    key={mention.id}
                    className="flex items-start gap-2.5 border-b rule py-2.5"
                  >
                    <ThingIcon
                      icon={mention.icon ?? mention.type_icon}
                      name={mention.title}
                      size="sm"
                      className="mt-0.5"
                    />
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="text-[15px]">{mention.title}</span>
                        <span className="shrink-0 font-mono text-[11px] text-faint tnum">
                          ×{mention.count}
                        </span>
                      </span>
                      <span className="text-[12px] text-muted">
                        {names.get(mention.type) ?? mention.type} ·{" "}
                        {mention.count === 1 ? "1 mention" : `${mention.count} mentions`}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>

              <p className="mt-3 max-w-[48ch] text-[13px] text-muted">
                Only links that point at this record are rewritten. A record edited since this
                preview opens is left untouched and reported.
              </p>
              {loading ? (
                <p role="status" className="mt-2 text-[13px] text-muted">
                  Reading the records that mention it…
                </p>
              ) : null}
              {loadError ? (
                <p role="status" className="mt-2 text-[13px] text-warning">
                  {loadError}
                </p>
              ) : null}
              {error ? (
                <div className="mt-3">
                  <FormError message={error} />
                </div>
              ) : null}
            </div>

            <div className="border-t rule px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <ThumbRow className="flex-wrap items-center gap-2">
                <Button
                  variant="ghost"
                  className="min-h-9 px-3 text-[13px] pointer-coarse:min-h-11"
                  disabled={pending}
                  onClick={onCancel}
                >
                  Cancel
                </Button>
                <Button
                  variant="ghost"
                  className="min-h-9 px-3 text-[13px] pointer-coarse:min-h-11"
                  disabled={pending}
                  onClick={onRenameOnly}
                >
                  Rename only
                </Button>
                <Button
                  className="min-h-9 px-3 text-[13px] pointer-coarse:min-h-11"
                  disabled={pending || loading}
                  onClick={() => {
                    if (sources) {
                      onUpdateLinks(sources);
                    }
                  }}
                >
                  {pending ? "Updating…" : "Update links"}
                </Button>
              </ThumbRow>
            </div>
          </SheetPopup>
        </SheetViewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
