import { useState } from "react";
import { useParams } from "react-router";

import { usePurgeObject, useRestoreObject, useSpace, useTrash, useTypes } from "@/api/queries";
import type { TrashItem } from "@/api/types";
import { SpaceNav } from "@/components/space-nav";
import { Button, FormError } from "@/components/ui/controls";
import { useToast } from "@/components/ui/toast";
import { formatDate, readError } from "@/lib/display";
import { useSpaceEvents } from "@/lib/use-space-events";

/** `/s/:spaceId/trash` — what was deleted, with restore and the one true purge. */
export function TrashPage() {
  const { spaceId } = useParams();
  const space = useSpace(spaceId);
  const types = useTypes(spaceId);
  const trash = useTrash(spaceId);

  useSpaceEvents(spaceId);

  if (space.isPending || types.isPending || trash.isPending) {
    return <p className="text-[13px] text-muted">Reading the trash…</p>;
  }

  const error = space.error ?? types.error ?? trash.error;
  if (error) {
    return (
      <div className="grid max-w-[52ch] gap-3">
        <FormError message={readError(error)} />
        <Button
          variant="ghost"
          className="w-fit"
          onClick={() => {
            void space.refetch();
            void types.refetch();
            void trash.refetch();
          }}
        >
          Retry
        </Button>
      </div>
    );
  }

  const detail = space.data;
  const typesData = types.data;
  const items = trash.data;
  if (!detail || !typesData || !items) {
    return <p className="text-[13px] text-muted">Reading the trash…</p>;
  }

  return (
    <div className="settle grid gap-8 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10">
      <SpaceNav spaceId={detail.id} types={typesData} role={detail.role} />
      <div className="min-w-0">
        <TrashList
          spaceId={detail.id}
          items={items}
          typeNames={new Map(typesData.map((type) => [type.key, type.name]))}
          canEdit={detail.role !== "viewer"}
        />
      </div>
    </div>
  );
}

function TrashList({
  spaceId,
  items,
  typeNames,
  canEdit,
}: {
  spaceId: string;
  items: TrashItem[];
  typeNames: Map<string, string>;
  canEdit: boolean;
}) {
  const restore = useRestoreObject(spaceId);
  const purge = usePurgeObject(spaceId);
  const toast = useToast();
  const [confirming, setConfirming] = useState<string | null>(null);

  function report(error: unknown) {
    toast.showToast(readError(error), "danger");
  }

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-[26px] font-medium tracking-[-0.02em]">Trash</h1>
        <span className="label tnum">
          {items.length} {items.length === 1 ? "record" : "records"}
        </span>
      </div>
      <p className="mt-2 max-w-[52ch] text-[13px] text-muted">
        A trashed record keeps its file and its history. Restore it to the table it came from, or
        purge it — purging deletes the file and every revision for good.
      </p>

      {items.length === 0 ? (
        <p className="mt-8 border-t rule pt-4 text-muted">
          The trash is empty. Deleting a record from its panel moves it here.
        </p>
      ) : (
        <ul className="mt-6 border-t rule">
          {items.map((item) => {
            const isConfirming = confirming === item.id;
            return (
              <li key={item.id} className="grid gap-2 border-b rule py-3">
                <div className="grid gap-x-4 gap-y-1 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                      <span className="text-[15px] font-medium">{item.title}</span>
                      <span className="font-mono text-[10px] text-faint">
                        {typeNames.get(item.type) ?? item.type} · {item.type}
                      </span>
                    </div>
                    <p className="mt-1 font-mono text-[10.5px] text-faint">
                      rev {item.rev} · trashed{" "}
                      {item.trashed_at ? formatDate(item.trashed_at) : "unknown"}
                      {item.trashed_from ? (
                        <>
                          {" · "}
                          <span
                            className="break-all text-muted"
                            title={item.trashed_from}
                          >
                            {item.trashed_from}
                          </span>
                        </>
                      ) : null}
                    </p>
                  </div>
                  {canEdit ? (
                    isConfirming ? null : (
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          variant="ghost"
                          className="min-h-8 px-3 text-[13px] pointer-coarse:min-h-11"
                          disabled={restore.isPending}
                          onClick={() =>
                            restore.mutate(item.id, {
                              onSuccess: () =>
                                toast.showToast(`Restored “${item.title}”.`),
                              onError: report,
                            })
                          }
                        >
                          Restore
                        </Button>
                        <button
                          type="button"
                          className="text-[13px] text-danger underline decoration-danger/40 underline-offset-2 hover:decoration-danger"
                          onClick={() => setConfirming(item.id)}
                        >
                          Purge
                        </button>
                      </div>
                    )
                  ) : null}
                </div>

                {canEdit && isConfirming ? (
                  <div
                    role="group"
                    aria-label={`Purge ${item.title}`}
                    className="flex flex-wrap items-center gap-3 border-l border-danger pl-3"
                  >
                    <p className="text-[13px] text-muted">
                      Purge “{item.title}” and every revision of it? This cannot be undone.
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="danger"
                        className="min-h-8 px-3 text-[13px] pointer-coarse:min-h-11"
                        disabled={purge.isPending}
                        onClick={() =>
                          purge.mutate(item.id, {
                            onSuccess: () => {
                              setConfirming(null);
                              toast.showToast(`Purged “${item.title}”.`);
                            },
                            onError: (error) => {
                              setConfirming(null);
                              report(error);
                            },
                          })
                        }
                      >
                        {purge.isPending ? "Purging…" : "Purge forever"}
                      </Button>
                      <Button
                        variant="ghost"
                        className="min-h-8 px-3 text-[13px] pointer-coarse:min-h-11"
                        onClick={() => setConfirming(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
