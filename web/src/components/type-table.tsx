import { Popover } from "@base-ui/react/popover";
import {
  ArrowUpDown,
  Columns3,
  FileSpreadsheet,
  ListFilter,
  MoreHorizontal,
  Plus,
  Search,
  Settings2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useNavigate, useSearchParams } from "react-router";

import { useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/api/queries";
import {
  useBulkRestoreObjects,
  useBulkTrashObjects,
  useCompleteObject,
  useCreateObject,
  useCreateView,
  useDuplicateObject,
  useObjects,
  useRestoreObject,
  useTrashObject,
  useUpdateObject,
  useUpdateView,
  useUpdateViewLayout,
} from "@/api/queries";
import type {
  Filter,
  ObjectSummary,
  PropertyDef,
  Sort,
  TypeDef,
  UpdateView,
  Uuid,
  WriteResult,
} from "@/api/types";
import { ApiError } from "@/api/client";
import { AddPropertyDialog } from "@/components/add-property";
import { BulkBar } from "@/components/bulk-bar";
import { FilterBar } from "@/components/filter-bar";
import { SortBar } from "@/components/sort-bar";
import { ThingIcon } from "@/components/thing-icon";
import { useTableShortcuts } from "@/components/table-shortcuts";
import { Button, FormError, TextField } from "@/components/ui/controls";
import { useToast } from "@/components/ui/toast";
import { BoardView } from "@/components/views/board-view";
import { CalendarView } from "@/components/views/calendar-view";
import { ColumnPanel } from "@/components/views/column-panel";
import { DataPanel } from "@/components/views/data-panel";
import { GalleryView } from "@/components/views/gallery-view";
import { TableView } from "@/components/views/table-view";
import { ViewSettings } from "@/components/views/view-settings";
import { ViewTabs } from "@/components/views/view-tabs";
import { readError } from "@/lib/display";
import { isBlank } from "@/lib/format";
import {
  columnChoices,
  cycleSort,
  filterParam,
  sortsParam,
  withParam,
} from "@/lib/filter";
import {
  TABLE_SHORTCUTS,
  TABLE_VIEWER_SHORTCUTS,
  type ShortcutDescriptor,
} from "@/lib/hotkeys";
import { clampPage, PAGE_SIZE, pageCount, pageFromParam, pageRange } from "@/lib/paging";
import { completeLabel } from "@/lib/schedule";
import { todayIn } from "@/lib/timezone";
import {
  effectiveQuery,
  monthOf,
  queryIsDirty,
  selectedView,
  withWidth,
  withoutPage,
} from "@/lib/views";

/** The layout views ask for the server maximum; only the table pages. */
const LAYOUT_LIMIT = 500;
const NO_SHORTCUTS: ShortcutDescriptor[] = [];
const VIEW_MENU_ITEM =
  "flex min-h-9 w-full items-center gap-2 rounded-[4px] px-3 text-left text-[13px] text-ink transition-colors hover:bg-raised disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:min-h-11";

interface TypeTableProps {
  spaceId: string;
  type: TypeDef;
  /** The type's members, in member order. */
  properties: PropertyDef[];
  /** The whole space library; adding a property starts here. */
  library: PropertyDef[];
  canEdit: boolean;
  timeZone: string;
}

/** The type page: saved views, their shared toolbar, filters and a renderer. */
export function TypeTable({
  spaceId,
  type,
  properties,
  library,
  canEdit,
  timeZone,
}: TypeTableProps) {
  const [params, setParams] = useSearchParams();
  const selected = selectedView(type, params.get("view") ?? undefined);
  const view = selected.view;
  const query = effectiveQuery(view, params);
  const q = (params.get("q") ?? "").trim();
  const today = todayIn(timeZone);
  const requestedMonth = params.get("month") ?? "";
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(requestedMonth)
    ? requestedMonth
    : monthOf(today);
  const choices = columnChoices(type, properties);
  const tableView = type.views.find((entry) => entry.kind === "table");
  const isTable = view.kind === "table";
  const page = isTable ? pageFromParam(params.get("page")) : 1;
  const update = useUpdateObject(spaceId);
  const complete = useCompleteObject(spaceId);
  const create = useCreateObject(spaceId);
  const duplicate = useDuplicateObject(spaceId);
  const trash = useTrashObject(spaceId);
  const restore = useRestoreObject(spaceId);
  const bulkTrash = useBulkTrashObjects(spaceId);
  const bulkRestore = useBulkRestoreObjects(spaceId);
  const updateView = useUpdateView(spaceId, type.key, view.key);
  const layout = useUpdateViewLayout(spaceId, type.key, view.key);
  const createView = useCreateView(spaceId, type.key);
  const client = useQueryClient();
  const toast = useToast();
  const searchRef = useRef<HTMLInputElement | null>(null);
  const navigate = useNavigate();
  const journal = useRef(new Map<string, { rev?: number; queue: Promise<unknown> }>());
  const [draft, setDraft] = useState<{
    title: string;
    icon: string;
    values: Record<string, unknown | null>;
    error: string | null;
  } | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [addPropertyOpen, setAddPropertyOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(() => params.get("settings") === "1");
  const previousView = useRef(view.key);
  const [dataOpen, setDataOpen] = useState(false);
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  const [pendingRows, setPendingRows] = useState<ReadonlySet<string>>(new Set());
  const [bulkPanelOpen, setBulkPanelOpen] = useState(false);
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [saveAsName, setSaveAsName] = useState("");

  const tableShortcuts = useMemo(
    () => (isTable ? (canEdit ? TABLE_SHORTCUTS : TABLE_VIEWER_SHORTCUTS) : NO_SHORTCUTS),
    [canEdit, isTable],
  );
  useTableShortcuts(tableShortcuts);

  // Step 1 starts on the first property this view actually shows.
  const initialBulkKey =
    view.columns.find(
      (key) => key !== "title" && properties.some((property) => property.key === key),
    ) ??
    properties[0]?.key ??
    "";

  const requiredProperties = useMemo(
    () =>
      type.properties
        .filter((member) => member.required)
        .flatMap((member) => {
          const property = properties.find((entry) => entry.key === member.key);
          return property ? [property] : [];
        }),
    [properties, type.properties],
  );

  // Generated schedule keys are never required; only declared members can be.
  const requiredKeys = useMemo(
    () =>
      new Set(
        type.properties
          .filter((member) => member.required)
          .map((member) => member.key),
      ),
    [type.properties],
  );

  useEffect(() => {
    if (selected.unknown) {
      setParams(withParam(params, "view", view.key), { replace: true, preventScrollReset: true });
    }
  }, [params, selected.unknown, setParams, view.key]);

  // Panels belong to the view they were opened on, not to the next one. A mount
  // with `?settings=1` keeps the requested panel; only a later switch closes it.
  useEffect(() => {
    setColumnsOpen(false);
    setFilterOpen(false);
    setSortOpen(false);
    if (previousView.current === view.key) {
      return;
    }
    previousView.current = view.key;
    setSettingsOpen(false);
  }, [view.key]);

  // `page` only means something to the table; leaving it behind would make a
  // later view switch inherit a stale page number.
  useEffect(() => {
    if (!isTable && params.has("page")) {
      setParams(withParam(params, "page", null), { replace: true, preventScrollReset: true });
    }
  }, [isTable, params, setParams]);

  const objects = useObjects(spaceId, {
    type: type.key,
    view: view.key,
    filter: query.filter,
    sorts: query.sorts,
    ...(q ? { q } : {}),
    limit: isTable ? PAGE_SIZE : LAYOUT_LIMIT,
    offset: isTable ? (page - 1) * PAGE_SIZE : 0,
  });

  const rows = objects.data?.objects ?? [];
  const total = objects.data?.total ?? 0;

  // A page that shrank under the reader (a live delete, a filter) clamps to
  // the last real page instead of showing an empty stretch.
  useEffect(() => {
    if (!isTable || objects.data === undefined || page <= pageCount(total)) {
      return;
    }
    const clamped = clampPage(page, total);
    setParams(withParam(params, "page", clamped === 1 ? null : String(clamped)), {
      replace: true,
      preventScrollReset: true,
    });
  }, [isTable, objects.data, page, params, setParams, total]);

  // Selection is page-local: any change that changes the loaded rows drops it.
  const selectionKey = [
    view.key,
    filterParam(query.filter),
    sortsParam(query.sorts),
    q,
    page,
  ].join("\u0000");
  useEffect(() => {
    setSelection(new Set());
  }, [selectionKey]);

  // The bar unmounts with the selection; the next selection starts collapsed.
  useEffect(() => {
    if (selection.size === 0) {
      setBulkPanelOpen(false);
    }
  }, [selection]);

  // A live delete can remove a selected row without a query change.
  const rowIds = rows.map((row) => row.id).join(",");
  useEffect(() => {
    setSelection((current) => {
      if (current.size === 0) {
        return current;
      }
      const visible = new Set(rowIds === "" ? [] : rowIds.split(","));
      const kept = new Set([...current].filter((id) => visible.has(id)));
      return kept.size === current.size ? current : kept;
    });
  }, [rowIds]);

  function report(error: unknown) {
    if (error instanceof ApiError && error.status === 409) {
      toast.showToast(`Conflict — ${readError(error)}`, "danger");
    } else {
      toast.showToast(readError(error), "danger");
    }
  }

  function reportLayout(error: unknown) {
    report(error);
    void client.invalidateQueries({ queryKey: queryKeys.type(spaceId, type.key) });
  }

  function writeLayout(change: UpdateView) {
    layout.mutate(change, { onError: reportLayout });
  }

  /**
   * A column resize: seed the new width into the type cache before the PATCH,
   * so the column under the finger moves on the same frame; revert that cache
   * and name the column if the write fails. The table keeps its own preview
   * until this promise settles.
   */
  function commitWidth(key: string, width: number): Promise<void> {
    const label =
      key === "title"
        ? "Title"
        : properties.find((entry) => entry.key === key)?.name ?? key;
    const next = withWidth(view, key, width);
    const typeKey = queryKeys.type(spaceId, type.key);
    const previous = client.getQueryData<TypeDef>(typeKey);
    client.setQueryData<TypeDef>(typeKey, (current) =>
      current === undefined
        ? current
        : {
            ...current,
            views: current.views.map((entry) =>
              entry.key === view.key ? { ...entry, widths: next.widths } : entry,
            ),
          },
    );
    return layout
      .mutateAsync({ columns: next.columns, widths: next.widths })
      .then(
        () => undefined,
        (error: unknown) => {
          if (previous !== undefined) {
            client.setQueryData(typeKey, previous);
          }
          toast.showToast(`Could not resize ${label} — ${readError(error)}`, "danger");
          throw error;
        },
      );
  }

  /** Every query edit drops `page`; the table starts from its first page. */
  function editParams(edit: (next: URLSearchParams) => void) {
    const next = new URLSearchParams(params);
    edit(next);
    setParams(withoutPage(next), { replace: true, preventScrollReset: true });
  }

  function goPage(next: number) {
    setParams(
      withParam(params, "page", next === 1 ? null : String(clampPage(next, total))),
      { replace: true, preventScrollReset: true },
    );
  }

  function selectView(key: string) {
    editParams((next) => {
      next.set("view", key);
      next.delete("filter");
      next.delete("sorts");
      next.delete("month");
    });
  }

  function clearQuery() {
    editParams((next) => {
      next.delete("q");
      next.delete("filter");
      next.delete("sorts");
    });
  }

  function closeViews() {
    setFilterOpen(false);
    setSortOpen(false);
    setColumnsOpen(false);
    setSettingsOpen(false);
    setDataOpen(false);
    setSaveAsOpen(false);
  }

  function toggleFilter() {
    const next = !filterOpen;
    closeViews();
    setFilterOpen(next);
  }

  function toggleSort() {
    const next = !sortOpen;
    closeViews();
    setSortOpen(next);
  }

  function toggleColumns() {
    const next = !columnsOpen;
    closeViews();
    setColumnsOpen(next);
  }

  function toggleSettings() {
    const next = !settingsOpen;
    closeViews();
    setSettingsOpen(next);
  }

  function toggleData() {
    const next = !dataOpen;
    closeViews();
    setDataOpen(next);
  }

  function startSaveAs() {
    closeViews();
    setSaveAsOpen(true);
    setSaveAsName(`${view.name} copy`);
  }

  function clearFilter() {
    setParams(withParam(withoutPage(params), "filter", ""), { replace: true, preventScrollReset: true });
  }

  function clearSearch() {
    setParams(withParam(withoutPage(params), "q", ""), { replace: true, preventScrollReset: true });
  }

  function setMonth(next: string) {
    setParams(withParam(params, "month", next), { replace: true, preventScrollReset: true });
  }

  function submitSearch(next: string) {
    setParams(withParam(withoutPage(params), "q", next), { replace: true, preventScrollReset: true });
  }

  function saveQuery() {
    updateView.mutate(
      { filter: query.filter, sorts: query.sorts },
      {
        onSuccess: () => {
          setParams(resetParams(params), { replace: true, preventScrollReset: true });
          toast.showToast("View saved.");
        },
        onError: report,
      },
    );
  }

  function saveAsView() {
    const name = saveAsName.trim();
    if (!name || createView.isPending) {
      return;
    }
    createView.mutate(
      {
        name,
        kind: view.kind,
        filter: query.filter,
        sorts: query.sorts,
        columns: view.columns,
        ...(view.widths ? { widths: view.widths } : {}),
        ...(view.group_by ? { group_by: view.group_by } : {}),
        ...(view.cover ? { cover: view.cover } : {}),
        ...(view.date_property ? { date_property: view.date_property } : {}),
      },
      {
        onSuccess: (detail) => {
          const created = detail.views.at(-1);
          setSaveAsOpen(false);
          setSaveAsName("");
          if (created) {
            selectView(created.key);
          }
        },
      },
    );
  }

  function setFilter(next: Filter) {
    editParams((paramsNext) => {
      paramsNext.set("filter", filterParam(next));
    });
  }

  function setSorts(next: Sort[]) {
    editParams((paramsNext) => {
      paramsNext.set("sorts", sortsParam(next));
    });
  }

  function sortBy(key: string, additive: boolean) {
    setSorts(cycleSort(query.sorts, key, additive));
  }

  /**
   * Writes to one row are serialized, and the next write uses the revision the
   * previous one returned. Two quick edits therefore cannot conflict with each
   * other; a third party's write still can, and that failure belongs to the row.
   */
  function enqueueRow<T>(
    id: string,
    task: (rev: number | undefined) => Promise<T>,
  ): Promise<T> {
    const entry = journal.current.get(id);
    // The revision is read when the task actually runs, so a queued write sees
    // the revision its predecessor returned.
    const run = (entry?.queue ?? Promise.resolve()).then(() =>
      task(journal.current.get(id)?.rev),
    );
    journal.current.set(id, {
      rev: entry?.rev,
      queue: run.catch(() => undefined),
    });
    return run;
  }

  async function writeRow(
    row: ObjectSummary,
    input: { title?: string; properties?: Record<string, unknown | null>; cells?: Record<string, { value: unknown; label: string } | null> },
  ): Promise<WriteResult> {
    try {
      const saved = await enqueueRow(row.id, (rev) =>
        update.mutateAsync({
          id: row.id,
          rev: rev ?? row.rev,
          ...input,
        }),
      );
      const entry = journal.current.get(row.id);
      if (entry) {
        entry.rev = saved.rev;
      }
      return { ok: true };
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        // Drop the remembered revision; the refreshed row is the next authority.
        journal.current.delete(row.id);
        void client.invalidateQueries({ queryKey: queryKeys.objectsPrefix(spaceId) });
      }
      return { ok: false, message: readError(error) };
    }
  }

  function commitCell(
    row: ObjectSummary,
    property: PropertyDef,
    cell: { value: unknown; label: string },
  ): Promise<WriteResult> {
    return writeRow(row, {
      properties: { [property.key]: cell.value },
      cells: {
        [property.key]:
          cell.value === null ? null : { value: cell.value, label: cell.label },
      },
    });
  }

  function commitTitle(row: ObjectSummary, title: string): Promise<WriteResult> {
    return writeRow(row, { title });
  }

  function completeRecord(row: ObjectSummary) {
    if (complete.isPending) {
      return;
    }
    complete.mutate(
      { id: row.id, rev: row.rev },
      {
        onSuccess: ({ object: saved, previous }) => {
          const nextDue = saved.schedule?.due_date;
          toast.showToast(nextDue ? `Next due ${nextDue}.` : "Marked done.", "plain", {
            label: "Undo",
            onAction: () => {
              void complete
                .undo(saved, previous)
                .then(() => toast.showToast("Completion undone."))
                .catch((error) =>
                  toast.showToast(`Could not undo — ${readError(error)}`, "danger"),
                );
            },
          });
        },
        onError: report,
      },
    );
  }

  function startRowAction(id: string) {
    setPendingRows((current) => new Set(current).add(id));
  }

  function endRowAction(id: string) {
    setPendingRows((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }

  function duplicateRecord(row: ObjectSummary) {
    startRowAction(row.id);
    duplicate.mutate(
      { id: row.id },
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
        onError: report,
        onSettled: () => endRowAction(row.id),
      },
    );
  }

  function trashRecord(row: ObjectSummary) {
    startRowAction(row.id);
    trash.mutate(row.id, {
      onSuccess: () => {
        toast.showToast(`Moved “${row.title}” to the trash.`, "plain", {
          label: "Undo",
          onAction: () =>
            restore.mutate(row.id, {
              onSuccess: () => toast.showToast("Restored the record."),
              onError: (error) =>
                toast.showToast(`Could not undo — ${readError(error)}`, "danger"),
            }),
        });
      },
      onError: report,
      onSettled: () => endRowAction(row.id),
    });
  }

  /** Bulk undo lives here because the bar unmounts with its selection. */
  function undoBulkTrash(ids: Uuid[]) {
    bulkRestore.mutate(ids, {
      onSuccess: (result) => {
        if (result.failed.length > 0) {
          toast.showToast(`Could not restore ${result.failed.length}.`, "danger");
        } else {
          toast.showToast(
            `Restored ${ids.length} ${ids.length === 1 ? "record" : "records"}.`,
          );
        }
      },
      onError: (error) =>
        toast.showToast(`Could not undo — ${readError(error)}`, "danger"),
    });
  }

  function undoBulkDuplicate(ids: Uuid[]) {
    bulkTrash.mutate(ids, {
      onSuccess: (result) => {
        if (result.failed.length > 0) {
          toast.showToast(`Could not undo ${result.failed.length}.`, "danger");
        } else {
          toast.showToast(
            `Moved ${ids.length} ${ids.length === 1 ? "record" : "records"} to the trash.`,
          );
        }
      },
      onError: (error) =>
        toast.showToast(`Could not undo — ${readError(error)}`, "danger"),
    });
  }

  function startDraft() {
    if (create.isPending) {
      return;
    }
    if (!isTable) {
      if (!tableView) {
        toast.showToast("Open a table view to add a record.", "danger");
        return;
      }
      selectView(tableView.key);
    }
    setDraft({ title: "", icon: "", values: {}, error: null });
  }

  function draftCommit() {
    if (!draft || create.isPending) {
      return;
    }
    const title = draft.title.trim();
    if (!title) {
      setDraft({ ...draft, error: "A title is required." });
      return;
    }
    const missing = requiredProperties.filter((property) =>
      isBlank(draft.values[property.key]),
    );
    if (missing.length > 0) {
      setDraft({
        ...draft,
        error: `Fill ${missing.map((property) => property.name).join(", ")} before creating.`,
      });
      return;
    }
    const values = Object.fromEntries(
      Object.entries(draft.values).filter(([, value]) => value !== null && value !== undefined),
    );
    create.mutate(
      {
        type: type.key,
        title,
        ...(draft.icon.trim() === "" ? {} : { icon: draft.icon.trim() }),
        ...(Object.keys(values).length === 0 ? {} : { properties: values }),
      },
      {
        onSuccess: (created) => {
          setDraft(null);
          toast.showToast(`Created “${created.title}”.`, "plain", [
            {
              label: "Open",
              onAction: () => navigate(`/s/${spaceId}/o/${created.id}`),
            },
            {
              label: "Undo",
              onAction: () =>
                trash.mutate(created.id, {
                  onSuccess: () => toast.showToast("Moved the new record to the trash."),
                  onError: (error) =>
                    toast.showToast(`Could not undo — ${readError(error)}`, "danger"),
                }),
            },
          ]);
          // A filter or search typed on this page must not hide the new row.
          clearQuery();
          setHighlightId(created.id);
          window.setTimeout(() => setHighlightId(null), 1600);
        },
        onError: (error) =>
          setDraft((current) =>
            current ? { ...current, error: readError(error) } : current,
          ),
      },
    );
  }

  function toggleRow(id: string) {
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
    setSelection((current) => {
      const every = rows.length > 0 && rows.every((row) => current.has(row.id));
      return every ? new Set() : new Set(rows.map((row) => row.id));
    });
  }

  const shown = rows.length;
  const dirty = queryIsDirty(view, query.filter, query.sorts);
  const hasOverrides = params.has("q") || params.has("filter") || params.has("sorts");
  const hasFilter = query.filter.conditions.length > 0;
  // Dim only when the visible rows belong to a query the reader has left (a new
  // filter, page or view). A background refresh of the same rows — a live
  // change, a layout write's echo — must not grey out the table.
  const busy = objects.isPlaceholderData;
  const selectedRows = rows.filter((row) => selection.has(row.id));
  const range = pageRange(total, page);
  const verb = completeLabel(type.schedule_labels);

  function focusSearch() {
    searchRef.current?.focus();
  }

  return (
    <div className="settle">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="flex items-baseline gap-3">
          <ThingIcon icon={type.icon} size="lg" />
          <h1 className="text-[26px] font-medium tracking-[-0.02em]">{type.name_plural}</h1>
          <span className="label tnum">{type.key}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="label tnum">
            {shown === total ? `${total}` : `${shown} of ${total}`} records
          </span>
          {canEdit ? (
            <Button
              type="button"
              className="min-h-8 px-3 text-[13px] pointer-coarse:min-h-11"
              disabled={create.isPending}
              onClick={startDraft}
            >
              {create.isPending ? "Creating…" : "New record"}
            </Button>
          ) : null}
        </div>
      </div>

      <ViewTabs
        spaceId={spaceId}
        type={type}
        properties={properties}
        selectedKey={view.key}
        canEdit={canEdit}
        onSelect={selectView}
        onCreated={selectView}
      />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <SearchBox value={q} inputRef={searchRef} onSubmit={submitSearch} />
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            aria-expanded={filterOpen}
            aria-controls="type-filters"
            className="min-h-8 px-2.5 text-[12px] pointer-coarse:min-h-11"
            onClick={toggleFilter}
          >
            <ListFilter aria-hidden size={14} />
            Filter
            {query.filter.conditions.length > 0 ? (
              <span className="tnum text-accent">{query.filter.conditions.length}</span>
            ) : null}
          </Button>
          {view.kind === "calendar" ? null : (
            <Button
              type="button"
              variant="ghost"
              aria-expanded={sortOpen}
              aria-controls="type-sorts"
              className="min-h-8 px-2.5 text-[12px] pointer-coarse:min-h-11"
              onClick={toggleSort}
            >
              <ArrowUpDown aria-hidden size={14} />
              Sort
              {query.sorts.length > 0 ? (
                <span className="tnum text-accent">{query.sorts.length}</span>
              ) : null}
            </Button>
          )}
          {canEdit && view.kind !== "calendar" ? (
            <Button
              type="button"
              variant="ghost"
              aria-expanded={columnsOpen}
              aria-controls="type-columns"
              className="min-h-8 px-2.5 text-[12px] pointer-coarse:min-h-11"
              onClick={toggleColumns}
            >
              <Columns3 aria-hidden size={14} />
              Columns
              <span className="tnum text-accent">
                {Math.max(0, view.columns.length - 1)}
              </span>
            </Button>
          ) : null}
          {canEdit && dirty ? (
            <Button
              type="button"
              className="min-h-8 px-2.5 text-[12px] pointer-coarse:min-h-11"
              disabled={updateView.isPending}
              onClick={saveQuery}
            >
              {updateView.isPending ? "Saving…" : "Save view"}
            </Button>
          ) : null}
          {hasOverrides ? (
            <Button
              type="button"
              variant="ghost"
              className="min-h-8 px-2.5 text-[12px] pointer-coarse:min-h-11"
              onClick={clearQuery}
              title="Clear search, filters and sorts"
            >
              Reset
            </Button>
          ) : null}
          <Popover.Root>
            <Popover.Trigger
              aria-label="More view actions"
              className="inline-flex h-8 w-8 items-center justify-center rounded-field border border-line-interactive text-muted transition-colors hover:border-line-strong hover:bg-raised hover:text-ink pointer-coarse:h-11 pointer-coarse:w-11"
            >
              <MoreHorizontal aria-hidden size={16} />
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Positioner sideOffset={4} align="end" className="z-50">
                <Popover.Popup className="min-w-[12rem] rounded-field border border-line bg-surface p-1">
                  {canEdit ? (
                    <Popover.Close className={VIEW_MENU_ITEM} onClick={toggleSettings}>
                      <Settings2 aria-hidden size={14} />
                      View settings
                    </Popover.Close>
                  ) : null}
                  {canEdit ? (
                    <Popover.Close className={VIEW_MENU_ITEM} onClick={startSaveAs}>
                      <Plus aria-hidden size={14} />
                      Save as view…
                    </Popover.Close>
                  ) : null}
                  <Popover.Close className={VIEW_MENU_ITEM} onClick={toggleData}>
                    <FileSpreadsheet aria-hidden size={14} />
                    Data — CSV
                  </Popover.Close>
                </Popover.Popup>
              </Popover.Positioner>
            </Popover.Portal>
          </Popover.Root>
        </div>
      </div>

      {canEdit && saveAsOpen ? (
        <form
          aria-label="Save current filter and sort as a view"
          className="mt-3 flex flex-wrap items-end gap-2 border-y rule py-3"
          onSubmit={(event) => {
            event.preventDefault();
            saveAsView();
          }}
        >
          <div className="w-[min(22rem,100%)]">
            <TextField
              label="New view name"
              name="save-as-view-name"
              required
              maxLength={80}
              autoFocus
              value={saveAsName}
              onChange={(event) => setSaveAsName(event.target.value)}
            />
          </div>
          <Button
            type="submit"
            className="min-h-9 px-3 text-[13px]"
            disabled={!saveAsName.trim() || createView.isPending}
          >
            {createView.isPending ? "Creating…" : "Create view"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="min-h-9 px-3 text-[13px]"
            onClick={() => setSaveAsOpen(false)}
          >
            Cancel
          </Button>
          <div className="min-w-[12rem] flex-1">
            <FormError message={createView.error ? readError(createView.error) : null} />
          </div>
        </form>
      ) : null}

      {canEdit && view.kind !== "calendar" ? (
        <div id="type-columns" hidden={!columnsOpen}>
          <ColumnPanel
            view={view}
            properties={properties}
            disabled={layout.isPending}
            onPatch={writeLayout}
            onAddProperty={() => setAddPropertyOpen(true)}
          />
        </div>
      ) : null}

      {canEdit && addPropertyOpen ? (
        <AddPropertyDialog
          spaceId={spaceId}
          type={type}
          library={library}
          view={view}
          onClose={() => setAddPropertyOpen(false)}
        />
      ) : null}

      {canEdit && settingsOpen ? (
        <ViewSettings
          spaceId={spaceId}
          type={type}
          view={view}
          properties={properties}
          onClose={() => setSettingsOpen(false)}
          onDeleted={selectView}
        />
      ) : null}

      {dataOpen ? (
        <DataPanel
          spaceId={spaceId}
          type={type}
          canEdit={canEdit}
          onClose={() => setDataOpen(false)}
          onImported={() => {
            setDataOpen(false);
            setSelection(new Set());
          }}
        />
      ) : null}

      <div className={filterOpen || sortOpen ? "mt-3 border-t rule pt-3" : ""}>
        <div id="type-filters" hidden={!filterOpen}>
          <FilterBar
            spaceId={spaceId}
            type={type}
            properties={properties}
            filter={query.filter}
            onChange={setFilter}
          />
        </div>
        {view.kind === "calendar" ? null : (
          <div id="type-sorts" hidden={!sortOpen}>
            <SortBar columns={choices} sorts={query.sorts} onChange={setSorts} />
          </div>
        )}
      </div>

      {objects.isError ? (
        <div className="mt-6 grid max-w-[52ch] gap-3">
          <FormError message={readError(objects.error)} />
          <Button variant="ghost" className="w-fit" onClick={() => void objects.refetch()}>
            Retry
          </Button>
        </div>
      ) : objects.isPending ? (
        <p className="mt-6 text-[13px] text-muted">Reading records…</p>
      ) : total === 0 && draft === null ? (
        <div className="mt-6 grid max-w-[52ch] gap-3 border-t rule pt-4">
          <p className="text-muted">
            {hasFilter || q
              ? "No records match this view."
              : "This type has no records yet."}
          </p>
          {hasFilter || q ? (
            <div className="flex flex-wrap items-center gap-2">
              {hasFilter ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-8 px-3 text-[12px] pointer-coarse:min-h-11"
                  onClick={clearFilter}
                >
                  Clear filters
                </Button>
              ) : null}
              {q ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-8 px-3 text-[12px] pointer-coarse:min-h-11"
                  onClick={clearSearch}
                >
                  Clear search
                </Button>
              ) : null}
            </div>
          ) : canEdit ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                className="min-h-9 w-fit px-3 text-[13px] pointer-coarse:min-h-11"
                disabled={create.isPending}
                onClick={startDraft}
              >
                {create.isPending ? "Creating…" : "New record"}
              </Button>
              {view.kind === "board" || view.kind === "gallery" ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-9 w-fit px-3 text-[13px] pointer-coarse:min-h-11"
                  onClick={() => setSettingsOpen(true)}
                >
                  Open view settings
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : view.kind === "board" ? (
        <BoardView
          spaceId={spaceId}
          timeZone={timeZone}
          view={view}
          rows={rows}
          properties={properties}
          canEdit={canEdit}
          completing={complete.isPending}
          pendingRows={pendingRows}
          verb={verb}
          onOpenSettings={() => setSettingsOpen(true)}
          onComplete={completeRecord}
          onDuplicate={duplicateRecord}
          onTrash={trashRecord}
        />
      ) : view.kind === "gallery" ? (
        <GalleryView
          spaceId={spaceId}
          timeZone={timeZone}
          type={type}
          view={view}
          rows={rows}
          properties={properties}
          canEdit={canEdit}
          completing={complete.isPending}
          pendingRows={pendingRows}
          verb={verb}
          onComplete={completeRecord}
          onDuplicate={duplicateRecord}
          onTrash={trashRecord}
        />
      ) : view.kind === "calendar" ? (
        <CalendarView
          spaceId={spaceId}
          view={view}
          {...(tableView
            ? { tableHref: `/s/${spaceId}/t/${type.key}?view=${tableView.key}` }
            : {})}
          rows={rows}
          properties={properties}
          month={month}
          today={today}
          canEdit={canEdit}
          completing={complete.isPending}
          pendingRows={pendingRows}
          verb={verb}
          onComplete={completeRecord}
          onDuplicate={duplicateRecord}
          onTrash={trashRecord}
          onOpenSettings={() => setSettingsOpen(true)}
          onMonthChange={setMonth}
        />
      ) : (
        // The selection band floats over the scrollport instead of pushing the
        // table down; the scrollport keeps room at its end so no row is
        // permanently hidden behind it.
        <div className="relative">
          <TableView
            key={view.key}
            spaceId={spaceId}
            type={type}
            view={view}
            rows={rows}
            properties={properties}
            canEdit={canEdit}
            completing={complete.isPending}
            busy={busy}
            sorts={query.sorts}
            selected={selection}
            pendingRows={pendingRows}
            bulkOpen={bulkPanelOpen && selectedRows.length > 0}
            requiredProperties={requiredProperties}
            draft={draft}
            onDraftIcon={(icon) =>
              setDraft((current) => (current === null ? current : { ...current, icon }))
            }
            highlightId={highlightId}
            timeZone={timeZone}
            onDraftTitle={(title) =>
              setDraft((current) => (current ? { ...current, title } : current))
            }
            onDraftValue={(key, value) =>
              setDraft((current) =>
                current
                  ? { ...current, values: { ...current.values, [key]: value } }
                  : current,
              )
            }
            onDraftCommit={draftCommit}
            onDraftCancel={() => setDraft(null)}
            onSort={sortBy}
            onToggleRow={toggleRow}
            onToggleAll={toggleAll}
            onClearSelection={() => setSelection(new Set())}
            onTitleCommit={commitTitle}
            onCellCommit={commitCell}
            onComplete={completeRecord}
            onDuplicate={duplicateRecord}
            onTrash={trashRecord}
            onFocusSearch={focusSearch}
            onAddProperty={() => setAddPropertyOpen(true)}
            layoutPending={layout.isPending}
            onResize={commitWidth}
          />
          {canEdit && selectedRows.length > 0 ? (
            <div className="absolute inset-x-2 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-20 md:inset-x-3">
              <BulkBar
                spaceId={spaceId}
                properties={properties}
                initialPropertyKey={initialBulkKey}
                requiredKeys={requiredKeys}
                rows={selectedRows}
                onPanelChange={setBulkPanelOpen}
                onResult={(failed) => setSelection(new Set(failed))}
                onClear={() => setSelection(new Set())}
                onUndoTrash={undoBulkTrash}
                onUndoDuplicate={undoBulkDuplicate}
              />
            </div>
          ) : null}
        </div>
      )}

      {objects.data && isTable ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t rule pt-3">
          <span className="font-mono text-[11px] tnum text-muted">
            {range.first === 0 ? "0" : `${range.first}–${range.last}`} of {total}
          </span>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              aria-label="Previous page"
              className="min-h-8 px-3 text-[12px] pointer-coarse:min-h-11"
              disabled={page <= 1}
              onClick={() => goPage(page - 1)}
            >
              Prev
            </Button>
            <Button
              type="button"
              variant="ghost"
              aria-label="Next page"
              className="min-h-8 px-3 text-[12px] pointer-coarse:min-h-11"
              disabled={page >= pageCount(total)}
              onClick={() => goPage(page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}
      {objects.data && !isTable && total > rows.length ? (
        <p className="mt-2 font-mono text-[11px] text-muted">
          Showing the first {rows.length} of {total}; open the table to page through every
          record.
        </p>
      ) : null}
      {update.isPending ? <span className="sr-only">Saving</span> : null}
      {create.error ? <FormError message={readError(create.error)} /> : null}
    </div>
  );
}

function resetParams(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params);
  next.delete("filter");
  next.delete("sorts");
  next.delete("page");
  return next;
}

/**
 * Search commits on Enter or after a 250ms pause; blur alone does nothing, so
 * tabbing away never changes the query. Clear is always present once committed.
 */
function SearchBox({
  value,
  inputRef,
  onSubmit,
}: {
  value: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  onSubmit: (value: string) => void;
}) {
  const [text, setText] = useState(value);
  const committed = useRef(value);
  const submitRef = useRef(onSubmit);
  submitRef.current = onSubmit;

  useEffect(() => {
    setText(value);
    committed.current = value;
  }, [value]);

  useEffect(() => {
    const trimmed = text.trim();
    if (trimmed === committed.current) {
      return;
    }
    const timer = window.setTimeout(() => {
      committed.current = trimmed;
      submitRef.current(trimmed);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [text]);

  function commit() {
    const trimmed = text.trim();
    committed.current = trimmed;
    submitRef.current(trimmed);
  }

  function clear() {
    setText("");
    committed.current = "";
    submitRef.current("");
  }

  return (
    <form
      role="search"
      className="relative max-w-[26rem] min-w-[12rem] flex-1"
      onSubmit={(event) => {
        event.preventDefault();
        commit();
      }}
    >
      <Search
        aria-hidden
        size={14}
        className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-faint"
      />
      <input
        ref={inputRef}
        aria-label="Search titles and bodies"
        className="h-8 w-full rounded-field border border-line-interactive bg-ground pr-9 pl-8 text-[13px] text-ink transition-colors hover:border-line-strong focus:border-accent pointer-coarse:h-11 pointer-coarse:text-[16px]"
        placeholder="Search titles and bodies"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      {text !== "" || value !== "" ? (
        <button
          type="button"
          aria-label="Clear search"
          className="absolute top-1/2 right-1 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-[3px] text-faint transition-colors hover:text-ink pointer-coarse:h-11 pointer-coarse:w-11"
          onClick={clear}
        >
          <X aria-hidden size={13} />
        </button>
      ) : null}
    </form>
  );
}
