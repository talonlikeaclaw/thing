import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import {
  useBulkPurgeObjects,
  useBulkRestoreObjects,
  usePurgeObject,
  useRestoreObject,
  useSpace,
  useTrash,
  useTypes,
} from "@/api/queries";
import type { TrashItem } from "@/api/types";
import { ThumbRow, useHandedness } from "@/components/handedness";
import { ThingIcon } from "@/components/thing-icon";
import { Button, FormError, TextField } from "@/components/ui/controls";
import { useToast } from "@/components/ui/toast";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { ErrorState } from "@/components/error-state";
import { cn } from "@/lib/cn";
import { formatDate, readError } from "@/lib/display";
import { useRouteMeta } from "@/lib/route";

/** `/s/:spaceId/trash` — what was deleted, with restore and the one true purge. */
export function TrashPage() {
  const { spaceId } = useParams();
  const space = useSpace(spaceId);
  const types = useTypes(spaceId);
  const trash = useTrash(spaceId);

  useRouteMeta("Trash");

  if (types.isPending || trash.isPending) {
    return <p className="text-[13px] text-muted">Reading the trash…</p>;
  }

  const error = types.error ?? trash.error;
  if (error) {
    return (
      <ErrorState
        error={error}
        subject="Trash"
        onRetry={() => {
          void types.refetch();
          void trash.refetch();
        }}
      />
    );
  }

  const detail = space.data;
  const typesData = types.data;
  const items = trash.data;
  if (!detail || !typesData || !items) {
    return <p className="text-[13px] text-muted">Reading the trash…</p>;
  }

  return (
    <div className="settle">
      <Breadcrumbs items={[{ label: detail.name, to: `/s/${detail.id}` }, { label: "Trash" }]} />
      <TrashList
        spaceId={detail.id}
        spaceName={detail.name}
        items={items}
        typeNames={new Map(typesData.map((type) => [type.key, type.name]))}
        canEdit={detail.role !== "viewer"}
        timeZone={detail.timezone}
      />
    </div>
  );
}

function TrashList({
  spaceId,
  timeZone,
  spaceName,
  items,
  typeNames,
  canEdit,
}: {
  spaceId: string;
  timeZone: string;
  spaceName: string;
  items: TrashItem[];
  typeNames: Map<string, string>;
  canEdit: boolean;
}) {
  const restore = useRestoreObject(spaceId);
  const purge = usePurgeObject(spaceId);
  const bulkRestore = useBulkRestoreObjects(spaceId);
  const bulkPurge = useBulkPurgeObjects(spaceId);
  const toast = useToast();
  const navigate = useNavigate();
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState<string | null>(null);
  const [rowConfirmText, setRowConfirmText] = useState("");
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const [bulkConfirmText, setBulkConfirmText] = useState("");
  const [bulkError, setBulkError] = useState<string | null>(null);
  const { handedness } = useHandedness();

  const selectedIds = items.filter((item) => selection.has(item.id)).map((item) => item.id);
  const selectionKey = selectedIds.join("\u0000");
  const allSelected = items.length > 0 && selectedIds.length === items.length;
  const purgeConfirmed =
    bulkConfirmText.trim() === spaceName ||
    bulkConfirmText.trim() === String(selectedIds.length);
  const rowPurgeConfirmed =
    rowConfirmText.trim() === spaceName || rowConfirmText.trim() === "1";

  // A new selection starts a new confirmation; a closed one never lingers.
  useEffect(() => {
    setBulkConfirm(false);
    setBulkConfirmText("");
  }, [selectionKey]);

  function toggle(id: string) {
    setBulkError(null);
    setSelection((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleAll() {
    setBulkError(null);
    setSelection(allSelected ? new Set() : new Set(items.map((item) => item.id)));
  }

  function markPending(id: string, active: boolean) {
    setPending((current) => {
      const next = new Set(current);
      if (active) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  function clearRowError(id: string) {
    setRowErrors((current) => {
      if (!(id in current)) {
        return current;
      }
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  function setRowError(id: string, message: string) {
    setRowErrors((current) => ({ ...current, [id]: message }));
  }

  function dropSelection(ids: string[]) {
    setSelection((current) => {
      const next = new Set(current);
      for (const id of ids) {
        next.delete(id);
      }
      return next;
    });
  }

  function openRestored(id: string) {
    navigate(`/s/${spaceId}/o/${id}`);
  }

  async function restoreOne(item: TrashItem) {
    clearRowError(item.id);
    markPending(item.id, true);
    try {
      await restore.mutateAsync(item.id);
      dropSelection([item.id]);
      toast.showToast(`Restored “${item.title}”.`, "plain", {
        label: "Open",
        onAction: () => openRestored(item.id),
      });
    } catch (error) {
      setRowError(item.id, readError(error));
    } finally {
      markPending(item.id, false);
    }
  }

  async function purgeOne(item: TrashItem) {
    clearRowError(item.id);
    markPending(item.id, true);
    try {
      await purge.mutateAsync(item.id);
      setConfirming(null);
      setRowConfirmText("");
      dropSelection([item.id]);
      toast.showToast(`Purged “${item.title}”.`);
    } catch (error) {
      setConfirming(null);
      setRowError(item.id, readError(error));
    } finally {
      markPending(item.id, false);
    }
  }

  async function restoreSelected() {
    if (selectedIds.length === 0) {
      return;
    }
    setBulkError(null);
    for (const id of selectedIds) {
      clearRowError(id);
    }
    const result = await bulkRestore.mutateAsync(selectedIds);
    dropSelection(result.succeeded);
    for (const failure of result.failed) {
      setRowError(failure.id, failure.message);
    }
    if (result.succeeded.length === 1 && result.failed.length === 0) {
      const item = items.find((entry) => entry.id === result.succeeded[0]);
      toast.showToast(`Restored “${item?.title ?? "the record"}”.`, "plain", {
        label: "Open",
        onAction: () => openRestored(result.succeeded[0] ?? ""),
      });
    } else if (result.succeeded.length > 0) {
      toast.showToast(
        `Restored ${result.succeeded.length} ${
          result.succeeded.length === 1 ? "record" : "records"
        }.`,
      );
    }
    if (result.failed.length > 0) {
      setBulkError(
        `${result.failed.length} ${
          result.failed.length === 1 ? "record" : "records"
        } could not be restored. They stay selected; retry after the error beside each row.`,
      );
    }
  }

  async function purgeSelected() {
    if (selectedIds.length === 0 || !purgeConfirmed) {
      return;
    }
    setBulkError(null);
    for (const id of selectedIds) {
      clearRowError(id);
    }
    const result = await bulkPurge.mutateAsync(selectedIds);
    dropSelection(result.succeeded);
    for (const failure of result.failed) {
      setRowError(failure.id, failure.message);
    }
    setBulkConfirm(false);
    setBulkConfirmText("");
    if (result.succeeded.length > 0) {
      toast.showToast(
        `Purged ${result.succeeded.length} ${
          result.succeeded.length === 1 ? "record" : "records"
        } forever.`,
      );
    }
    if (result.failed.length > 0) {
      setBulkError(
        `${result.failed.length} ${
          result.failed.length === 1 ? "record" : "records"
        } could not be purged. They stay selected.`,
      );
    }
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
        <div className="mt-8 grid gap-3 border-t rule pt-4">
          <p className="text-muted">
            The trash is empty. Deleting a record from its panel moves it here.
          </p>
          <Link
            to={`/s/${spaceId}`}
            className="w-fit text-[13px] text-accent underline decoration-accent/50 underline-offset-2 hover:decoration-accent pointer-coarse:min-h-11 pointer-coarse:content-center"
          >
            Back to the space
          </Link>
        </div>
      ) : (
        <>
          {canEdit ? (
            <ThumbRow className="mt-6 flex-wrap items-center gap-3 border-y rule py-2.5">
              <span className="flex flex-wrap items-center gap-3">
                <label className="flex min-h-11 items-center gap-2 text-[13px] text-muted">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label="Select all records"
                  />
                  Select all
                </label>
                <span className="label tnum">{selectedIds.length} selected</span>
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="ghost"
                  className="min-h-8 px-3 text-[13px] pointer-coarse:min-h-11"
                  disabled={selectedIds.length === 0 || bulkRestore.isPending}
                  onClick={() => void restoreSelected()}
                >
                  {bulkRestore.isPending ? "Restoring…" : "Restore"}
                </Button>
                <Button
                  variant="danger"
                  className="min-h-8 px-3 text-[13px] pointer-coarse:min-h-11"
                  disabled={selectedIds.length === 0 || bulkPurge.isPending}
                  onClick={() => setBulkConfirm(true)}
                >
                  Purge forever
                </Button>
              </div>
            </ThumbRow>
          ) : null}

          {bulkError ? (
            <div className="mt-3">
              <FormError message={bulkError} />
            </div>
          ) : null}

          {canEdit && bulkConfirm ? (
            <div
              role="group"
              aria-label="Confirm purging the selected records"
              className="mt-3 grid gap-3 border-l border-danger pl-3"
            >
              <p className="text-[13px] text-muted">
                Purge {selectedIds.length} {selectedIds.length === 1 ? "record" : "records"} and
                every revision of them? This cannot be undone. Type the space name or the count
                to confirm.
              </p>
              <div className="max-w-[22rem]">
                <TextField
                  label="Space name or count"
                  name="trash-purge-confirm"
                  autoComplete="off"
                  autoFocus
                  value={bulkConfirmText}
                  disabled={bulkPurge.isPending}
                  onChange={(event) => setBulkConfirmText(event.target.value)}
                />
              </div>
              <ThumbRow className="flex-wrap items-center gap-2">
                <Button
                  variant="ghost"
                  className="min-h-8 px-3 text-[13px] pointer-coarse:min-h-11"
                  disabled={bulkPurge.isPending}
                  onClick={() => {
                    setBulkConfirm(false);
                    setBulkConfirmText("");
                  }}
                >
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  className="min-h-8 px-3 text-[13px] pointer-coarse:min-h-11"
                  disabled={!purgeConfirmed || bulkPurge.isPending}
                  onClick={() => void purgeSelected()}
                >
                  {bulkPurge.isPending ? "Purging…" : "Purge forever"}
                </Button>
              </ThumbRow>
            </div>
          ) : null}

          <ul className="mt-6 border-t rule">
            {items.map((item) => {
              const isConfirming = confirming === item.id;
              const isPending = pending.has(item.id);
              const error = rowErrors[item.id];
              return (
                <li key={item.id} className="grid gap-2 border-b rule py-3">
                  <div className="flex items-start gap-3">
                    {canEdit ? (
                      <label className="flex min-h-11 items-center">
                        <input
                          type="checkbox"
                          checked={selection.has(item.id)}
                          onChange={() => toggle(item.id)}
                          aria-label={`Select ${item.title}`}
                        />
                      </label>
                    ) : null}
                    <div className="grid min-w-0 flex-1 gap-2">
                      <div
                        className={cn(
                          "grid gap-x-4 gap-y-1 sm:items-start",
                          handedness === "left"
                            ? "sm:grid-cols-[auto_minmax(0,1fr)]"
                            : "sm:grid-cols-[minmax(0,1fr)_auto]",
                        )}
                      >
                        <div
                          className={cn(
                            "min-w-0",
                            handedness === "left" && "sm:col-start-2 sm:row-start-1",
                          )}
                        >
                          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                            {item.icon ? (
                              <ThingIcon icon={item.icon} size="sm" />
                            ) : null}
                            <span className="text-[15px] font-medium">{item.title}</span>
                            <span className="font-mono text-[10px] text-faint">
                              {typeNames.get(item.type) ?? item.type} · {item.type}
                            </span>
                          </div>
                          <p className="mt-1 font-mono text-[10.5px] text-faint">
                            rev {item.rev} · trashed{" "}
                            {item.trashed_at ? formatDate(item.trashed_at, timeZone) : "unknown"}
                            {item.trashed_from ? (
                              <>
                                {" · "}
                                <span className="break-all text-muted" title={item.trashed_from}>
                                  {item.trashed_from}
                                </span>
                              </>
                            ) : null}
                          </p>
                        </div>
                        {canEdit && !isConfirming ? (
                          <div
                            className={cn(
                              "flex flex-wrap items-center gap-2",
                              handedness === "left"
                                ? "justify-start sm:col-start-1 sm:row-start-1"
                                : "justify-end",
                            )}
                          >
                            <Button
                              variant="ghost"
                              className="min-h-8 px-3 text-[13px] pointer-coarse:min-h-11"
                              disabled={isPending}
                              onClick={() => void restoreOne(item)}
                            >
                              {isPending ? "Working…" : "Restore"}
                            </Button>
                            <button
                              type="button"
                              className="text-[13px] text-danger underline decoration-danger/40 underline-offset-2 hover:decoration-danger pointer-coarse:min-h-11"
                              disabled={isPending}
                              onClick={() => {
                                setRowConfirmText("");
                                setConfirming(item.id);
                              }}
                            >
                              Purge
                            </button>
                          </div>
                        ) : null}
                      </div>

                      {error ? <FormError message={error} /> : null}

                      {canEdit && isConfirming ? (
                        <div
                          role="group"
                          aria-label={`Purge ${item.title}`}
                          className="grid gap-3 border-l border-danger pl-3"
                        >
                          <p className="text-[13px] text-muted">
                            Purge “{item.title}” and every revision of it? This cannot be undone.
                            Type the space name or the count to confirm.
                          </p>
                          <div className="max-w-[22rem]">
                            <TextField
                              label="Space name or count"
                              name={`trash-purge-${item.id}`}
                              autoComplete="off"
                              autoFocus
                              value={rowConfirmText}
                              disabled={isPending}
                              onChange={(event) => setRowConfirmText(event.target.value)}
                            />
                          </div>
                          <ThumbRow className="flex-wrap items-center gap-2">
                            <Button
                              variant="ghost"
                              className="min-h-8 px-3 text-[13px] pointer-coarse:min-h-11"
                              disabled={isPending}
                              onClick={() => {
                                setConfirming(null);
                                setRowConfirmText("");
                              }}
                            >
                              Cancel
                            </Button>
                            <Button
                              variant="danger"
                              className="min-h-8 px-3 text-[13px] pointer-coarse:min-h-11"
                              disabled={!rowPurgeConfirmed || isPending}
                              onClick={() => void purgeOne(item)}
                            >
                              {isPending ? "Purging…" : "Purge forever"}
                            </Button>
                          </ThumbRow>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
