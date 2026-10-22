import { ArrowUpRight, Check } from "lucide-react";
import { useRef, useState } from "react";
import { Link } from "react-router";

import type {
  ObjectSummary,
  PropertyDef,
  TypeDef,
  ValueJson,
  ViewDef,
} from "@/api/types";
import { PropertyCell, TitleCell } from "@/components/property-cell";
import { completeLabel } from "@/lib/schedule";
import { clampWidth, defaultWidth } from "@/lib/views";

const OPEN_WIDTH = 72;

interface TableViewProps {
  spaceId: string;
  type: TypeDef;
  view: ViewDef;
  rows: ObjectSummary[];
  properties: PropertyDef[];
  canEdit: boolean;
  completing: boolean;
  autoEditId: string | null;
  onTitleCommit: (row: ObjectSummary, title: string) => void;
  onCellCommit: (
    row: ObjectSummary,
    property: PropertyDef,
    cell: { value: unknown; label: string },
  ) => void;
  onComplete: (row: ObjectSummary) => void;
  onResize: (key: string, width: number) => void;
  onCancelAutoEdit: () => void;
}

/** The table renderer: one row per record, saved widths, cells edited in place. */
export function TableView({
  spaceId,
  type,
  view,
  rows,
  properties,
  canEdit,
  completing,
  autoEditId,
  onTitleCommit,
  onCellCommit,
  onComplete,
  onResize,
  onCancelAutoEdit,
}: TableViewProps) {
  const propertyByKey = new Map(properties.map((property) => [property.key, property]));
  const columns = view.columns.filter((key) => key !== "title");
  const [preview, setPreview] = useState<Record<string, number>>({});
  const widthOf = (key: string) => preview[key] ?? defaultWidth(view, key);
  const totalWidth =
    widthOf("title") +
    columns.reduce((sum, key) => sum + widthOf(key), 0) +
    OPEN_WIDTH;
  const verb = completeLabel(type.schedule_labels);

  function resize(key: string, width: number) {
    setPreview((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    onResize(key, width);
  }

  return (
    <div className="mt-6 overflow-x-auto">
      <table
        className="table-fixed border-collapse text-left"
        style={{ width: totalWidth }}
      >
        <colgroup>
          <col style={{ width: widthOf("title") }} />
          {columns.map((key) => (
            <col key={key} style={{ width: widthOf(key) }} />
          ))}
          <col style={{ width: OPEN_WIDTH }} />
        </colgroup>
        <thead className="sticky top-0 z-10 bg-ground">
          <tr className="border-b rule">
            <th scope="col" className="label relative py-2 pr-3 font-medium">
              <span className="flex items-baseline gap-1.5">
                <span className="truncate">Title</span>
                <span className="font-mono text-[9px] text-faint normal-case tracking-normal">
                  title
                </span>
              </span>
              {canEdit ? (
                <ColumnResizer
                  label="Title"
                  width={widthOf("title")}
                  onPreview={(width) =>
                    setPreview((current) => ({ ...current, title: width }))
                  }
                  onCommit={(width) => resize("title", width)}
                />
              ) : null}
            </th>
            {columns.map((key) => {
              const property = propertyByKey.get(key);
              const label = property?.name ?? key;
              return (
                <th
                  key={key}
                  scope="col"
                  className="label relative py-2 pr-3 font-medium"
                >
                  <span className="flex items-baseline gap-1.5">
                    <span className="truncate">{label}</span>
                    <span className="font-mono text-[9px] text-faint normal-case tracking-normal">
                      {key}
                    </span>
                  </span>
                  {canEdit ? (
                    <ColumnResizer
                      label={label}
                      width={widthOf(key)}
                      onPreview={(width) =>
                        setPreview((current) => ({ ...current, [key]: width }))
                      }
                      onCommit={(width) => resize(key, width)}
                    />
                  ) : null}
                </th>
              );
            })}
            <th
              scope="col"
              className="sticky right-0 z-20 border-l rule bg-ground py-2"
            >
              <span className="sr-only">Open</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b rule align-top">
              <td className="py-1 pr-2">
                <TitleCell
                  title={row.title}
                  canEdit={canEdit}
                  startEditing={row.id === autoEditId}
                  onCommit={(title) => onTitleCommit(row, title)}
                  onCancel={onCancelAutoEdit}
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
                      cell={row.values[key] as ValueJson | undefined}
                      schedule={row.schedule}
                      canEdit={canEdit}
                      onCommit={(cell) => onCellCommit(row, property, cell)}
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
                      disabled={completing}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-[3px] text-faint transition-colors hover:bg-raised hover:text-accent disabled:opacity-50 pointer-coarse:h-11 pointer-coarse:w-11"
                      onClick={() => onComplete(row)}
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
    </div>
  );
}

interface ColumnResizerProps {
  label: string;
  width: number;
  onPreview: (width: number) => void;
  onCommit: (width: number) => void;
}

/**
 * A keyboard-focusable column edge. Pointer moves preview continuously; the
 * write happens on release. Arrow keys move 16px, Shift 64px.
 */
function ColumnResizer({ label, width, onPreview, onCommit }: ColumnResizerProps) {
  const drag = useRef<{ x: number; width: number } | null>(null);

  function finish(event: React.PointerEvent<HTMLDivElement>) {
    const start = drag.current;
    if (!start) {
      return;
    }
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    onCommit(clampWidth(start.width + event.clientX - start.x));
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${label}`}
      aria-valuemin={80}
      aria-valuemax={800}
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      className="absolute inset-y-0 right-0 w-2 cursor-col-resize touch-none border-r border-transparent transition-colors hover:border-line-strong focus-visible:border-accent pointer-coarse:w-4"
      onPointerDown={(event) => {
        event.preventDefault();
        drag.current = { x: event.clientX, width };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (start) {
          onPreview(clampWidth(start.width + event.clientX - start.x));
        }
      }}
      onPointerUp={finish}
      onPointerCancel={(event) => {
        drag.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
          return;
        }
        event.preventDefault();
        const step = event.shiftKey ? 64 : 16;
        onCommit(clampWidth(width + (event.key === "ArrowRight" ? step : -step)));
      }}
    />
  );
}
