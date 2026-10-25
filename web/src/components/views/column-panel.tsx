import { ChevronLeft, ChevronRight, Plus, X } from "lucide-react";

import type { PropertyDef, ViewDef } from "@/api/types";
import { SmallButton } from "@/components/schema/small-button";
import { Button } from "@/components/ui/controls";
import { moveViewColumn, withColumn, withoutColumn } from "@/lib/views";

interface ColumnPanelProps {
  view: ViewDef;
  properties: PropertyDef[];
  disabled: boolean;
  onPatch: (change: { columns: string[]; widths: Record<string, number> }) => void;
  /** Opens the add-property dialog shared with the table header. */
  onAddProperty: () => void;
}

/** Column visibility and order for one view; every change writes immediately. */
export function ColumnPanel({
  view,
  properties,
  disabled,
  onPatch,
  onAddProperty,
}: ColumnPanelProps) {
  const propertyByKey = new Map(properties.map((property) => [property.key, property]));
  const nameOf = (key: string) => propertyByKey.get(key)?.name ?? key;
  const shown = view.columns.filter((key) => key !== "title");
  const hidden = properties.filter((property) => !view.columns.includes(property.key));

  function move(key: string, delta: number) {
    const columns = moveViewColumn(view, key, delta);
    onPatch({ columns, widths: { ...view.widths } });
  }

  function hide(key: string) {
    onPatch(withoutColumn(view, key));
  }

  function show(key: string) {
    onPatch(withColumn(view, key, true));
  }

  return (
    <section
      aria-label="Columns"
      className="mt-3 border-y rule py-3"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="label">Columns</span>
        <span className="text-[12px] text-faint">
          Drag a header edge in the table to set its width.
        </span>
      </div>

      <ul className="mt-2">
        <li className="flex items-center justify-between border-b rule py-1.5">
          <span className="flex items-baseline gap-2">
            <span className="font-mono text-[11px] text-faint">title</span>
            <span className="text-[14px]">Title</span>
          </span>
          <span className="label">fixed first</span>
        </li>
        {shown.map((key) => (
          <li
            key={key}
            className="flex items-center justify-between gap-2 border-b rule py-1.5"
          >
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="font-mono text-[11px] text-faint">{key}</span>
              <span className="truncate text-[14px]">{nameOf(key)}</span>
            </span>
            <span className="flex items-center gap-1">
              <SmallButton
                label={`Move ${nameOf(key)} left`}
                disabled={disabled || view.columns.indexOf(key) <= 1}
                onClick={() => move(key, -1)}
              >
                <ChevronLeft aria-hidden size={15} />
              </SmallButton>
              <SmallButton
                label={`Move ${nameOf(key)} right`}
                disabled={disabled || view.columns.indexOf(key) === view.columns.length - 1}
                onClick={() => move(key, 1)}
              >
                <ChevronRight aria-hidden size={15} />
              </SmallButton>
              <SmallButton
                label={`Hide ${nameOf(key)}`}
                disabled={disabled}
                onClick={() => hide(key)}
              >
                <X aria-hidden size={15} />
              </SmallButton>
            </span>
          </li>
        ))}
      </ul>

      {hidden.length > 0 ? (
        <div className="mt-3">
          <span className="label">Hidden</span>
          <ul className="mt-1">
            {hidden.map((property) => (
              <li
                key={property.key}
                className="flex items-center justify-between gap-2 border-b rule py-1.5"
              >
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="font-mono text-[11px] text-faint">{property.key}</span>
                  <span className="truncate text-[14px]">{property.name}</span>
                </span>
                <SmallButton
                  label={`Show ${property.name}`}
                  disabled={disabled}
                  onClick={() => show(property.key)}
                >
                  <Plus aria-hidden size={15} />
                </SmallButton>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Button
        type="button"
        variant="ghost"
        className="mt-3 min-h-9 w-full justify-start px-3 text-[13px] pointer-coarse:min-h-11"
        disabled={disabled}
        onClick={onAddProperty}
      >
        <Plus aria-hidden size={15} />
        Add property
      </Button>
    </section>
  );
}
