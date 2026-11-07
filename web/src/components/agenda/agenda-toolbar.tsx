import type { TypeSummary } from "@/api/types";
import { AgendaHorizons } from "@/components/agenda/agenda-list";
import { TypeFilter } from "@/components/agenda/type-filter";
import { useThumbHandedness } from "@/components/handedness";
import type { AgendaHorizon, AgendaView } from "@/lib/agenda";
import { cn } from "@/lib/cn";

/**
 * The Schedule's controls: the range switch and the filter as two separate
 * pills of one size — each owns its frame, so neither sits inside the other's
 * border and their heights still agree. `stretch` is the phone layout: the
 * range pill takes the row, the filter stays at the thumb edge.
 */
export function AgendaToolbar({
  view,
  horizon,
  onHorizonChange,
  types,
  selected,
  onTypesChange,
  stretch,
}: {
  view: AgendaView;
  horizon: AgendaHorizon;
  onHorizonChange: (horizon: AgendaHorizon) => void;
  /** Every type the space schedules; empty means no filter is offered. */
  types: readonly TypeSummary[];
  selected: readonly string[];
  onTypesChange: (types: string[]) => void;
  /** The phone layout: the range pill takes the row's width. */
  stretch: boolean;
}) {
  const handedness = useThumbHandedness();
  const left = stretch && handedness === "left";
  const range =
    view === "list" ? (
      <AgendaHorizons horizon={horizon} onChange={onHorizonChange} stretch={stretch} />
    ) : null;
  const filter =
    types.length > 0 ? (
      <TypeFilter types={types} selected={selected} onChange={onTypesChange} />
    ) : null;
  if (!range && !filter) {
    return null;
  }
  // The filter is the primary control, so it sits at the thumb edge: it trails
  // in right-handed mode and leads in left-handed mode.
  return (
    <div
      role="group"
      aria-label="Schedule controls"
      className={cn(
        "flex min-w-0 items-center gap-2",
        // A phone stretches the row. With no range switch (Calendar), the
        // filter is the only child, so it must still sit at the thumb edge
        // instead of at the start of a full-width row.
        stretch && "w-full",
        stretch && (left ? "justify-start" : "justify-end"),
      )}
    >
      {left ? (
        <>
          {filter}
          {range}
        </>
      ) : (
        <>
          {range}
          {filter}
        </>
      )}
    </div>
  );
}
