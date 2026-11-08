import { FileText, Images } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router";

import { useLibrary, useSpace, useTypes } from "@/api/queries";
import type { LibraryItem, LibraryRecord, TypeSummary } from "@/api/types";
import { AGENDA_SEGMENT, AGENDA_TOOLBAR } from "@/components/agenda/toolbar";
import { TypeFilter } from "@/components/agenda/type-filter";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { ErrorState } from "@/components/error-state";
import { ThumbRow } from "@/components/handedness";
import { ImageLightbox } from "@/components/image-lightbox";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { cn } from "@/lib/cn";
import { formatBytes } from "@/lib/format";
import { fileUrl, thumbnailUrl } from "@/lib/files";
import {
  EMPTY_LIBRARY_FILTER,
  filterLibrary,
  sortLibrary,
  type LibraryKind,
  type LibrarySort,
} from "@/lib/library";
import { useRouteMeta } from "@/lib/route";

const KINDS: { value: LibraryKind; label: string }[] = [
  { value: "all", label: "All" },
  { value: "image", label: "Photos" },
  { value: "file", label: "Files" },
];

const SORTS: { value: LibrarySort; label: string }[] = [
  { value: "recent", label: "Recent" },
  { value: "name", label: "Name" },
  { value: "size", label: "Size" },
];

const SEARCH =
  "h-9 min-w-0 rounded-full border border-line bg-surface/70 px-3 text-[13px] text-ink transition-colors placeholder:text-faint hover:border-line-strong focus:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent pointer-coarse:h-11 pointer-coarse:text-[16px]";

/**
 * `/s/:spaceId/library` — every file and photo the space stores, one card per
 * path, each naming the records that use it. Owner and viewer read the same
 * list; only Settings collects unused bytes.
 */
export function LibraryPage() {
  const { spaceId } = useParams();
  const space = useSpace(spaceId);
  const library = useLibrary(spaceId);
  const types = useTypes(spaceId);

  useRouteMeta("Library");

  if (space.isPending || library.isPending || types.isPending) {
    return <p className="text-[13px] text-muted">Reading the library…</p>;
  }

  const error = space.error ?? library.error ?? types.error;
  if (error) {
    return (
      <ErrorState
        error={error}
        subject="Library"
        onRetry={() => {
          void space.refetch();
          void library.refetch();
          void types.refetch();
        }}
      />
    );
  }

  const detail = space.data;
  const data = library.data;
  const typeList = types.data;
  if (!detail || !data || !typeList) {
    return <p className="text-[13px] text-muted">Reading the library…</p>;
  }

  return (
    <div className="settle">
      <Breadcrumbs
        items={[{ label: detail.name, to: `/s/${detail.id}` }, { label: "Library" }]}
      />
      <PageHeader
        title="Library"
        sentence="Every file and photo in this space."
        meta={`${data.items.length} files · ${formatBytes(data.total_bytes)}`}
      />
      <LibraryGrid spaceId={detail.id} items={data.items} types={typeList} />
    </div>
  );
}

function LibraryGrid({
  spaceId,
  items,
  types,
}: {
  spaceId: string;
  items: LibraryItem[];
  types: TypeSummary[];
}) {
  const [kind, setKind] = useState<LibraryKind>("all");
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<LibrarySort>("recent");
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const opener = useRef<HTMLElement | null>(null);

  const filter = { kind, types: selectedTypes, query };
  const visible = useMemo(
    () => sortLibrary(filterLibrary(items, filter), sort),
    // The filter object is rebuilt each render; its fields are the real inputs.
    [items, kind, selectedTypes, query, sort],
  );
  const photos = visible.filter((item) => item.kind === "image");

  function clear() {
    setKind(EMPTY_LIBRARY_FILTER.kind);
    setSelectedTypes([...EMPTY_LIBRARY_FILTER.types]);
    setQuery(EMPTY_LIBRARY_FILTER.query);
  }

  return (
    <>
      <div
        role="group"
        aria-label="Library controls"
        className="mt-6 flex flex-wrap items-center gap-2"
      >
        <div className={AGENDA_TOOLBAR}>
          {KINDS.map((choice) => (
            <button
              key={choice.value}
              type="button"
              aria-pressed={kind === choice.value}
              className={AGENDA_SEGMENT}
              onClick={() => setKind(choice.value)}
            >
              {choice.label}
            </button>
          ))}
        </div>
        <TypeFilter types={types} selected={selectedTypes} onChange={setSelectedTypes} />
        <select
          aria-label="Sort files"
          className={cn(SEARCH, "shrink-0 pr-2")}
          value={sort}
          onChange={(event) => setSort(event.target.value as LibrarySort)}
        >
          {SORTS.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
        <input
          type="search"
          aria-label="Search files by name"
          className={cn(SEARCH, "w-full sm:w-[13rem]")}
          placeholder="Search names"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {items.length === 0 ? (
        <EmptyState sentence="No files yet. Add one from a record." />
      ) : visible.length === 0 ? (
        <EmptyState
          sentence="No files match these filters."
          action={
            <button
              type="button"
              className="inline-flex min-h-10 w-fit items-center rounded-full border border-line-interactive/70 bg-raised/40 px-4 text-sm text-ink transition-colors hover:border-line-strong pointer-coarse:min-h-11"
              onClick={clear}
            >
              Clear filters
            </button>
          }
        />
      ) : (
        <ul
          aria-label="Library files"
          className="mt-6 columns-2 gap-3 sm:columns-3 xl:columns-4"
        >
          {visible.map((item) => (
            <li key={item.path} className="mb-3 break-inside-avoid">
              <LibraryCard
                spaceId={spaceId}
                item={item}
                onOpen={(event) => {
                  const index = photos.findIndex((photo) => photo.path === item.path);
                  if (index === -1) {
                    return;
                  }
                  opener.current = event.currentTarget;
                  setOpenIndex(index);
                }}
              />
            </li>
          ))}
        </ul>
      )}

      {openIndex !== null && photos[openIndex] ? (
        <ImageLightbox
          spaceId={spaceId}
          images={photos.map((photo) => ({ path: photo.path, title: photo.name }))}
          index={openIndex}
          onIndexChange={setOpenIndex}
          returnFocus={opener}
          onClose={() => setOpenIndex(null)}
        />
      ) : null}
    </>
  );
}

function LibraryCard({
  spaceId,
  item,
  onOpen,
}: {
  spaceId: string;
  item: LibraryItem;
  onOpen: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  const image = item.kind === "image";
  return (
    <div className="overflow-hidden rounded-card border border-line bg-surface transition-colors hover:border-line-strong">
      {image ? (
        <button
          type="button"
          aria-label={`Open image ${item.name}`}
          className="block w-full border-b rule bg-raised transition-opacity hover:opacity-95 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
          onClick={onOpen}
        >
          <img
            src={thumbnailUrl(spaceId, item.path, 512)}
            alt=""
            loading="lazy"
            className="block w-full"
          />
        </button>
      ) : null}
      <div className="grid gap-1.5 p-2.5">
        <div className="flex items-baseline gap-2">
          {image ? null : (
            <FileText aria-hidden size={13} className="shrink-0 text-faint" />
          )}
          <span className="min-w-0 flex-1 truncate text-[13px] text-ink" title={item.name}>
            {item.name}
          </span>
          {item.unused ? (
            <span className="label shrink-0 rounded-full border border-line px-1.5 py-0.5 text-[10px] text-muted">
              Unused
            </span>
          ) : null}
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[11px] text-faint">{formatBytes(item.size)}</span>
          {image ? null : (
            <a
              href={fileUrl(spaceId, item.path)}
              download={item.name}
              aria-label={`Download ${item.name}`}
              className="inline-flex min-h-6 items-center gap-1 rounded-full border border-line px-2 text-[11px] text-muted transition-colors hover:border-line-strong hover:text-ink"
            >
              <Images aria-hidden size={11} />
              Download
            </a>
          )}
        </div>
        {item.records.length > 0 ? (
          <RecordChips spaceId={spaceId} records={item.records} />
        ) : null}
      </div>
    </div>
  );
}

/** One chip per record that names these bytes; a trashed use never navigates. */
function RecordChips({
  spaceId,
  records,
}: {
  spaceId: string;
  records: LibraryRecord[];
}) {
  return (
    <ThumbRow className="flex-wrap items-center gap-1">
      {records.map((record) =>
        record.trashed ? (
          <span
            key={record.id}
            title={`${record.type_name} · ${record.field_name}`}
            className="inline-flex min-h-6 items-center gap-1 rounded-full border border-line px-2 text-[11px] text-faint"
          >
            <span className="max-w-[9rem] truncate">{record.title}</span>
            <span className="label">In trash</span>
          </span>
        ) : (
          <Link
            key={record.id}
            to={`/s/${spaceId}/o/${record.id}`}
            title={`${record.type_name} · ${record.field_name}`}
            className="inline-flex min-h-6 items-center gap-1 rounded-full border border-line bg-raised/40 px-2 text-[11px] text-ink transition-colors hover:border-line-strong"
          >
            {record.icon ? <span aria-hidden>{record.icon}</span> : null}
            <span className="max-w-[9rem] truncate">{record.title}</span>
          </Link>
        ),
      )}
    </ThumbRow>
  );
}
