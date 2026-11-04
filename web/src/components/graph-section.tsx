import { ChevronDown, Network } from "lucide-react";
import { useState } from "react";

import { useSpaceGraph } from "@/api/queries";
import { useHandedness } from "@/components/handedness";
import type { Backlink, ObjectLink, OutgoingLink } from "@/api/types";
import { LocalGraph } from "@/components/local-graph";
import { SpaceGraph } from "@/components/space-graph";
import { cn } from "@/lib/cn";
import type { GraphCenter } from "@/lib/graph";

type Scope = "local" | "space";

interface GraphSectionProps {
  spaceId: string;
  center: GraphCenter;
  links?: ObjectLink[];
  linksTo?: OutgoingLink[];
  backlinks?: Backlink[];
  typeNames: ReadonlyMap<string, string>;
}

/**
 * The graph area with its scope switch. Local is the record's one-hop
 * neighbourhood; Space is every record, so the current one's place is visible.
 * Space is fetched only when chosen, and both scopes share one disclosure on a
 * phone or a touch screen.
 */
export function GraphSection({
  spaceId,
  center,
  links,
  linksTo,
  backlinks,
  typeNames,
}: GraphSectionProps) {
  const { handedness } = useHandedness();
  const leftHanded = handedness === "left";
  const [scope, setScope] = useState<Scope>("local");
  const spaceGraph = useSpaceGraph(spaceId, scope === "space");

  const toggle = (
    <div className={cn("flex", leftHanded ? "justify-start" : "justify-end")}>
      <div role="group" aria-label="Graph scope" className="flex items-center gap-1">
        {(["local", "space"] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={scope === value}
            className={cn(
              "label rounded-[8px] px-2 py-1 transition-colors hover:text-ink aria-pressed:bg-raised aria-pressed:text-ink pointer-coarse:min-h-11 pointer-coarse:min-w-11",
              scope === value ? "" : "text-faint",
            )}
            onClick={() => setScope(value)}
          >
            {value === "local" ? "Local" : "Space"}
          </button>
        ))}
      </div>
    </div>
  );

  const body = (
    <div className="grid gap-2">
      {toggle}
      {scope === "local" ? (
        <LocalGraph
          spaceId={spaceId}
          center={center}
          links={links}
          linksTo={linksTo}
          backlinks={backlinks}
          typeNames={typeNames}
        />
      ) : spaceGraph.isError ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-[13px] text-muted">The space graph could not be read.</p>
          <button
            type="button"
            className="min-h-11 text-[12px] text-muted underline decoration-line-strong hover:text-ink pointer-fine:min-h-0"
            onClick={() => void spaceGraph.refetch()}
          >
            Retry
          </button>
        </div>
      ) : spaceGraph.data ? (
        <SpaceGraph
          spaceId={spaceId}
          centerId={center.id}
          nodes={spaceGraph.data.nodes}
          edges={spaceGraph.data.edges}
          typeNames={typeNames}
        />
      ) : (
        <p className="text-[13px] text-muted">Reading the space…</p>
      )}
    </div>
  );

  const summaryLabel = (
    <span className="label flex items-center gap-1.5">
      <Network aria-hidden size={13} strokeWidth={1.5} className="text-muted" />
      <span className="group-open:hidden">Graph</span>
      <span className="hidden group-open:inline">Hide graph</span>
    </span>
  );
  const chevron = (
    <ChevronDown
      aria-hidden
      size={14}
      className="shrink-0 text-muted motion-safe:transition-transform group-open:rotate-180"
    />
  );

  return (
    <details className="group mt-3">
      <summary className="flex min-h-11 w-full cursor-pointer list-none items-center justify-between gap-3 border-y rule py-2 transition-colors hover:text-ink [&::-webkit-details-marker]:hidden">
        {summaryLabel}
        {chevron}
      </summary>
      <div className="mt-2">{body}</div>
    </details>
  );
}
