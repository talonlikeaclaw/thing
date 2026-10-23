import { Columns3, Search, Settings2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";

import { useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/api/queries";
import {
  useCompleteObject,
  useCreateObject,
  useObjects,
  useUpdateObject,
  useUpdateView,
} from "@/api/queries";
import type {
  Filter,
  ObjectSummary,
  PropertyDef,
  Sort,
  TypeDef,
  UpdateView,
} from "@/api/types";
import { ApiError } from "@/api/client";
import { FilterBar } from "@/components/filter-bar";
import { SortBar } from "@/components/sort-bar";
import { Button, FormError } from "@/components/ui/controls";
import { useToast } from "@/components/ui/toast";
import { BoardView } from "@/components/views/board-view";
import { CalendarView } from "@/components/views/calendar-view";
import { ColumnPanel } from "@/components/views/column-panel";
import { GalleryView } from "@/components/views/gallery-view";
import { TableView } from "@/components/views/table-view";
import { ViewSettings } from "@/components/views/view-settings";
import { ViewTabs } from "@/components/views/view-tabs";
import { readError } from "@/lib/display";
import {
  columnChoices,
  filterParam,
  sortsParam,
  withParam,
} from "@/lib/filter";
import { todayIn } from "@/lib/timezone";
import {
  effectiveQuery,
  monthOf,
  queryIsDirty,
  selectedView,
  withWidth,
} from "@/lib/views";

interface TypeTableProps {
  spaceId: string;
  type: TypeDef;
  properties: PropertyDef[];
  canEdit: boolean;
  timeZone: string;
}

/** The type page: saved views, their shared toolbar, filters and a renderer. */
export function TypeTable({
  spaceId,
  type,
  properties,
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
  const update = useUpdateObject(spaceId);
  const complete = useCompleteObject(spaceId);
  const create = useCreateObject(spaceId);
  const layout = useUpdateView(spaceId, type.key, view.key);
  const client = useQueryClient();
  const toast = useToast();
  const [autoEditId, setAutoEditId] = useState<string | null>(null);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    if (selected.unknown) {
      setParams(withParam(params, "view", view.key), { replace: true });
    }
  }, [params, selected.unknown, setParams, view.key]);

  // Panels belong to the view they were opened on, not to the next one.
  useEffect(() => {
    setColumnsOpen(false);
    setSettingsOpen(false);
    setAutoEditId(null);
  }, [view.key]);

  const objects = useObjects(spaceId, {
    type: type.key,
    view: view.key,
    filter: query.filter,
    sorts: query.sorts,
    ...(q ? { q } : {}),
  });

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

  function selectView(key: string) {
    const next = new URLSearchParams(params);
    next.set("view", key);
    next.delete("filter");
    next.delete("sorts");
    next.delete("month");
    setParams(next, { replace: true });
  }

  function clearQuery() {
    const next = new URLSearchParams(params);
    next.delete("q");
    next.delete("filter");
    next.delete("sorts");
    setParams(next, { replace: true });
  }

  function setMonth(next: string) {
    setParams(withParam(params, "month", next), { replace: true });
  }

  function saveQuery() {
    layout.mutate(
      { filter: query.filter, sorts: query.sorts },
      {
        onSuccess: () => {
          setParams(resetParams(params), { replace: true });
          toast.showToast("View saved.");
        },
        onError: report,
      },
    );
  }

  function setFilter(next: Filter) {
    setParams(withParam(params, "filter", filterParam(next)), { replace: true });
  }

  function setSorts(next: Sort[]) {
    setParams(withParam(params, "sorts", sortsParam(next)), { replace: true });
  }

  function commitCell(
    row: ObjectSummary,
    property: PropertyDef,
    cell: { value: unknown; label: string },
  ) {
    update.mutate(
      {
        id: row.id,
        rev: row.rev,
        properties: { [property.key]: cell.value },
        cells: {
          [property.key]:
            cell.value === null ? null : { value: cell.value, label: cell.label },
        },
      },
      { onError: report },
    );
  }

  function commitTitle(row: ObjectSummary, title: string) {
    setAutoEditId(null);
    update.mutate({ id: row.id, rev: row.rev, title }, { onError: report });
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

  function createRecord() {
    create.mutate(
      { type: type.key, title: "Untitled" },
      {
        onSuccess: (object) => setAutoEditId(object.id),
        onError: (error) => toast.showToast(readError(error), "danger"),
      },
    );
  }

  const rows = objects.data?.objects ?? [];
  const total = objects.data?.total ?? 0;
  const shown = rows.length;
  const dirty = queryIsDirty(view, query.filter, query.sorts);
  const hasOverrides = params.has("q") || params.has("filter") || params.has("sorts");

  return (
    <div className="settle">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="flex items-baseline gap-3">
          {type.icon ? (
            <span aria-hidden className="text-[22px] leading-none">
              {type.icon}
            </span>
          ) : null}
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
              onClick={createRecord}
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

      <div className="mt-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <SearchBox
          value={q}
          onSubmit={(next) => setParams(withParam(params, "q", next), { replace: true })}
        />
        {canEdit ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {view.kind === "calendar" ? null : (
              <Button
                type="button"
                variant="ghost"
                aria-expanded={columnsOpen}
                className="min-h-8 px-2.5 text-[12px] pointer-coarse:min-h-11"
                onClick={() => {
                  setColumnsOpen((open) => !open);
                  setSettingsOpen(false);
                }}
              >
                <Columns3 aria-hidden size={14} />
                Columns
              </Button>
            )}
            <Button
              type="button"
              className="min-h-8 px-2.5 text-[12px] pointer-coarse:min-h-11"
              disabled={!dirty || layout.isPending}
              onClick={saveQuery}
            >
              {layout.isPending ? "Saving…" : "Save view"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="min-h-8 px-2.5 text-[12px] pointer-coarse:min-h-11"
              disabled={!hasOverrides}
              onClick={clearQuery}
            >
              Clear filters
            </Button>
            <Button
              type="button"
              variant="ghost"
              aria-expanded={settingsOpen}
              className="min-h-8 px-2.5 text-[12px] pointer-coarse:min-h-11"
              onClick={() => {
                setSettingsOpen((open) => !open);
                setColumnsOpen(false);
              }}
            >
              <Settings2 aria-hidden size={14} />
              View settings
            </Button>
          </div>
        ) : null}
      </div>

      {canEdit && columnsOpen ? (
        <ColumnPanel
          view={view}
          properties={properties}
          disabled={layout.isPending}
          onPatch={writeLayout}
        />
      ) : null}

      {canEdit && settingsOpen ? (
        <ViewSettings
          spaceId={spaceId}
          type={type}
          view={view}
          onClose={() => setSettingsOpen(false)}
          onDeleted={selectView}
        />
      ) : null}

      <div className="mt-4 grid gap-4 border-t rule pt-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
        <FilterBar
          spaceId={spaceId}
          type={type}
          properties={properties}
          filter={query.filter}
          onChange={setFilter}
        />
        {view.kind === "calendar" ? null : (
          <SortBar columns={choices} sorts={query.sorts} onChange={setSorts} />
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
      ) : total === 0 ? (
        <p className="mt-6 max-w-[52ch] border-t rule pt-4 text-muted">
          {query.filter.conditions.length > 0 || q
            ? "No records match this view. Loosen a filter or clear the search."
            : "This type has no records yet."}
          {canEdit && query.filter.conditions.length === 0 && !q
            ? " Create the first one."
            : ""}
        </p>
      ) : view.kind === "board" ? (
        <BoardView
          spaceId={spaceId}
          view={view}
          rows={rows}
          properties={properties}
        />
      ) : view.kind === "gallery" ? (
        <GalleryView
          spaceId={spaceId}
          type={type}
          view={view}
          rows={rows}
          properties={properties}
        />
      ) : view.kind === "calendar" ? (
        <CalendarView
          spaceId={spaceId}
          view={view}
          rows={rows}
          properties={properties}
          month={month}
          today={today}
          onMonthChange={setMonth}
        />
      ) : (
        <TableView
          key={view.key}
          spaceId={spaceId}
          type={type}
          view={view}
          rows={rows}
          properties={properties}
          canEdit={canEdit}
          completing={complete.isPending}
          autoEditId={autoEditId}
          onTitleCommit={commitTitle}
          onCellCommit={commitCell}
          onComplete={completeRecord}
          onResize={(key, width) => {
            const next = withWidth(view, key, width);
            writeLayout({ columns: next.columns, widths: next.widths });
          }}
          onCancelAutoEdit={() => setAutoEditId(null)}
        />
      )}

      {objects.data?.has_more ? (
        <p className="mt-2 text-[12px] text-muted">
          Showing the first {shown} of {total}; narrow the view to see the rest.
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
  return next;
}

/**
 * Search commits on Enter or after a 250ms pause; blur alone does nothing, so
 * tabbing away never changes the query. Clear is always present once committed.
 */
function SearchBox({ value, onSubmit }: { value: string; onSubmit: (value: string) => void }) {
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
