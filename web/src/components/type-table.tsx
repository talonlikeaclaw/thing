import { ArrowUpRight, Check, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";

import {
  useCompleteObject,
  useCreateObject,
  useObjects,
  useUpdateObject,
} from "@/api/queries";
import type {
  Filter,
  ObjectSummary,
  PropertyDef,
  Sort,
  TypeDef,
} from "@/api/types";
import { ApiError } from "@/api/client";
import { FilterBar } from "@/components/filter-bar";
import { PropertyCell, TitleCell } from "@/components/property-cell";
import { SortBar } from "@/components/sort-bar";
import { Button, FormError } from "@/components/ui/controls";
import { useToast } from "@/components/ui/toast";
import { readError } from "@/lib/display";
import {
  columnChoices,
  filterParam,
  sortsParam,
  withParam,
} from "@/lib/filter";
import { completeLabel } from "@/lib/schedule";
import { useSpaceEvents } from "@/lib/use-space-events";
import { effectiveQuery, selectedView } from "@/lib/views";

interface TypeTableProps {
  spaceId: string;
  type: TypeDef;
  properties: PropertyDef[];
  canEdit: boolean;
}

/** The live table: the type's view, one row per record, cells edited in place. */
export function TypeTable({ spaceId, type, properties, canEdit }: TypeTableProps) {
  const [params, setParams] = useSearchParams();
  const selected = selectedView(type, params.get("view") ?? undefined);
  const view = selected.view;
  const query = effectiveQuery(view, params);
  const q = (params.get("q") ?? "").trim();
  const columns = view.columns.filter((key) => key !== "title");
  const propertyByKey = new Map(properties.map((property) => [property.key, property]));
  const choices = columnChoices(type, properties);
  const update = useUpdateObject(spaceId);
  const complete = useCompleteObject(spaceId);
  const create = useCreateObject(spaceId);
  const toast = useToast();
  const verb = completeLabel(type.schedule_labels);
  const [autoEditId, setAutoEditId] = useState<string | null>(null);

  useSpaceEvents(spaceId);

  // A view deleted in another window falls back to the default instead of
  // leaving a dead key in the URL.
  useEffect(() => {
    if (selected.unknown) {
      setParams(withParam(params, "view", view.key), { replace: true });
    }
  }, [params, selected.unknown, setParams, view.key]);

  const objects = useObjects(spaceId, {
    type: type.key,
    view: view.key,
    filter: query.filter,
    sorts: query.sorts,
    ...(q ? { q } : {}),
  });

  function setFilter(next: Filter) {
    setParams(withParam(params, "filter", filterParam(next)), { replace: true });
  }

  function setSorts(next: Sort[]) {
    setParams(withParam(params, "sorts", sortsParam(next)), { replace: true });
  }

  function report(error: unknown) {
    if (error instanceof ApiError && error.status === 409) {
      toast.showToast(`Conflict — ${readError(error)}`, "danger");
    } else {
      toast.showToast(readError(error), "danger");
    }
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

  const total = objects.data?.total ?? 0;
  const shown = objects.data?.objects.length ?? 0;

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

      <SearchBox
        value={q}
        onSubmit={(next) => setParams(withParam(params, "q", next), { replace: true })}
      />

      <div className="mt-4 grid gap-4 border-t rule pt-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
        <FilterBar
          spaceId={spaceId}
          type={type}
          properties={properties}
          filter={query.filter}
          onChange={setFilter}
        />
        <SortBar columns={choices} sorts={query.sorts} onChange={setSorts} />
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
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[40rem] border-collapse text-left">
            <thead className="sticky top-0 z-10 bg-ground">
              <tr className="border-b rule">
                <th scope="col" className="label w-[12rem] py-2 pr-3 font-medium">
                  Title
                </th>
                {columns.map((key) => {
                  const property = propertyByKey.get(key);
                  return (
                    <th key={key} scope="col" className="label min-w-[6rem] py-2 pr-3 font-medium">
                      <span className="flex items-baseline gap-1.5">
                        <span className="truncate">{property?.name ?? key}</span>
                        <span className="font-mono text-[9px] text-faint normal-case tracking-normal">
                          {key}
                        </span>
                      </span>
                    </th>
                  );
                })}
                <th
                  scope="col"
                  className="sticky right-0 z-20 w-8 border-l rule bg-ground py-2"
                >
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {objects.data?.objects.map((row) => (
                <tr key={row.id} className="border-b rule align-top">
                  <td className="py-1 pr-2">
                    <TitleCell
                      title={row.title}
                      canEdit={canEdit}
                      startEditing={row.id === autoEditId}
                      onCommit={(title) => commitTitle(row, title)}
                      onCancel={() => setAutoEditId(null)}
                    />
                  </td>
                  {columns.map((key) => {
                    const property = propertyByKey.get(key);
                    if (!property) {
                      return (
                        <td key={key} className="py-1 pr-2 font-mono text-[11px] text-faint">
                          {key}
                        </td>
                      );
                    }
                    return (
                      <td key={key} className="py-1 pr-2">
                        <PropertyCell
                          spaceId={spaceId}
                          property={property}
                          cell={row.values[key]}
                          schedule={row.schedule}
                          canEdit={canEdit}
                          onCommit={(cell) => commitCell(row, property, cell)}
                        />
                      </td>
                    );
                  })}
                  <td className="sticky right-0 w-[4.5rem] border-l rule bg-ground py-1 text-right">
                    <div className="flex items-center justify-end gap-0.5">
                      {canEdit && type.schedule && row.schedule?.status !== "done" ? (
                        <button
                          type="button"
                          aria-label={`${verb} ${row.title}`}
                          title={verb}
                          disabled={complete.isPending}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-[3px] text-faint transition-colors hover:bg-raised hover:text-accent disabled:opacity-50 pointer-coarse:h-11 pointer-coarse:w-11"
                          onClick={() => completeRecord(row)}
                        >
                          <Check aria-hidden size={14} />
                        </button>
                      ) : null}
                      <Link
                        to={`/s/${spaceId}/o/${row.id}`}
                        aria-label={`Open ${row.title}`}
                        title="Open record"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-[3px] text-faint transition-colors hover:bg-raised hover:text-accent pointer-coarse:h-11 pointer-coarse:w-11"
                      >
                        <ArrowUpRight aria-hidden size={14} />
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {objects.data?.has_more ? (
            <p className="mt-2 text-[12px] text-muted">
              Showing the first {shown} of {total}; narrow the view to see the rest.
            </p>
          ) : null}
          {update.isPending ? <span className="sr-only">Saving</span> : null}
          {create.error ? <FormError message={readError(create.error)} /> : null}
        </div>
      )}
    </div>
  );
}

function SearchBox({ value, onSubmit }: { value: string; onSubmit: (value: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <form
      role="search"
      className="relative mt-4 max-w-[26rem]"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(text.trim());
      }}
    >
      <Search
        aria-hidden
        size={14}
        className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-faint"
      />
      <input
        aria-label="Search titles and bodies"
        className="h-8 w-full rounded-field border border-line bg-ground pr-2 pl-8 text-[13px] text-ink transition-colors hover:border-line-strong focus:border-accent pointer-coarse:h-11 pointer-coarse:text-[16px]"
        placeholder="Search titles and bodies"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => onSubmit(text.trim())}
      />
    </form>
  );
}
