import { X } from "lucide-react";
import { useEffect, useState } from "react";

import {
  useDeleteView,
  useSetDefaultView,
  useUpdateView,
} from "@/api/queries";
import type { TypeDef, ViewDef } from "@/api/types";
import { Button, FormError, TextField } from "@/components/ui/controls";
import { readError } from "@/lib/display";
import { viewKindLabel } from "@/components/views/view-tabs";

interface ViewSettingsProps {
  spaceId: string;
  type: TypeDef;
  view: ViewDef;
  onClose: () => void;
  onDeleted: (nextViewKey: string) => void;
}

/** Rename, promote or delete the selected view; the kind never changes. */
export function ViewSettings({
  spaceId,
  type,
  view,
  onClose,
  onDeleted,
}: ViewSettingsProps) {
  const update = useUpdateView(spaceId, type.key, view.key);
  const remove = useDeleteView(spaceId, type.key);
  const makeDefault = useSetDefaultView(spaceId, type.key);
  const [name, setName] = useState(view.name);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    setName(view.name);
    setConfirming(false);
  }, [view.key, view.name]);

  const isDefault = view.key === type.default_view;
  const canDelete = type.views.length > 1;
  const nameDirty = name.trim() !== view.name && name.trim() !== "";

  function rename() {
    if (!nameDirty) {
      return;
    }
    update.mutate({ name: name.trim() });
  }

  function destroy() {
    remove.mutate(view.key, {
      onSuccess: (detail) => {
        onDeleted(detail.default_view);
        onClose();
      },
    });
  }

  return (
    <section aria-label="View settings" className="mt-3 border-y rule py-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="label">View settings</span>
        <button
          type="button"
          aria-label="Close view settings"
          className="inline-flex h-7 w-7 items-center justify-center rounded-[3px] text-faint transition-colors hover:bg-raised hover:text-ink pointer-coarse:h-11 pointer-coarse:w-11"
          onClick={onClose}
        >
          <X aria-hidden size={13} />
        </button>
      </div>

      <div className="mt-2 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <TextField
          label="View name"
          name={`${type.key}-${view.key}-name`}
          maxLength={80}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <Button
          type="button"
          variant="ghost"
          className="min-h-10 px-3 text-[13px]"
          disabled={!nameDirty || update.isPending}
          onClick={rename}
        >
          {update.isPending ? "Renaming…" : "Rename"}
        </Button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        {isDefault ? (
          <span className="label text-accent">DEFAULT</span>
        ) : (
          <Button
            type="button"
            variant="ghost"
            className="min-h-9 px-3 text-[13px]"
            disabled={makeDefault.isPending}
            onClick={() =>
              makeDefault.mutate(view.key, {
                onSuccess: () => onClose(),
              })
            }
          >
            {makeDefault.isPending ? "Making default…" : "Make default"}
          </Button>
        )}
        <p className="text-[13px] text-muted">
          Kind: <span className="text-ink">{viewKindLabel(view.kind)}</span> ·{" "}
          <span className="font-mono text-[11px] text-faint">{view.key}</span>
        </p>
      </div>

      <p className="mt-1 max-w-[62ch] text-[13px] text-muted">
        Kind is fixed; create a view to show these records another way.
      </p>

      <div className="mt-4 border-t rule pt-3">
        {!canDelete ? (
          <p className="text-[13px] text-muted">
            A type needs at least one view. Create another before deleting this one.
          </p>
        ) : confirming ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-[13px] text-ink">Delete “{view.name}”? This cannot be undone.</p>
            <Button
              type="button"
              variant="danger"
              className="min-h-9 px-3 text-[13px]"
              disabled={remove.isPending}
              onClick={destroy}
            >
              {remove.isPending ? "Deleting…" : "Delete view"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="min-h-9 px-3 text-[13px]"
              onClick={() => setConfirming(false)}
            >
              Keep view
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            variant="danger"
            className="min-h-9 px-3 text-[13px]"
            onClick={() => setConfirming(true)}
          >
            Delete view
          </Button>
        )}
      </div>

      <FormError
        message={
          update.error
            ? readError(update.error)
            : makeDefault.error
              ? readError(makeDefault.error)
              : remove.error
                ? readError(remove.error)
                : null
        }
      />
    </section>
  );
}
