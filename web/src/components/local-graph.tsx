import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";

import type { Backlink, ObjectLink, OutgoingLink } from "@/api/types";
import { GraphCanvas } from "@/components/graph-canvas";
import {
  buildLocalGraph,
  GRAPH_RING_LIMIT,
  layoutLocalGraph,
  type GraphCenter,
} from "@/lib/graph";
import { cn } from "@/lib/cn";
import { useCoarsePointer, useCompactWidth } from "@/lib/media";

const WIDE_WIDTH = 640;
/** A phone keeps the viewBox at its own width, so 12px labels stay 12px. */
const COMPACT_WIDTH = 390;
const HEIGHT = 320;
/** Long titles would run off the ring; the tooltip and the row keep the rest. */
const LABEL_CHARS = 26;
/** A dense ring alternates labels between two vertical tracks and shortens them. */
const DENSE_LABEL_CHARS = 12;
/** Edge space on either side of a dragged node, in graph units. */
const CENTER_CLEARANCE = 11;
const NODE_CLEARANCE = 8;

interface LocalGraphProps {
  spaceId: string;
  center: GraphCenter;
  links?: ObjectLink[];
  linksTo?: OutgoingLink[];
  backlinks?: Backlink[];
  /** Display names keyed by type key, for the visible labels and aria names. */
  typeNames: ReadonlyMap<string, string>;
}

function clipLabel(title: string, limit = LABEL_CHARS): string {
  return title.length > limit ? `${title.slice(0, limit - 1)}…` : title;
}

/** One edge trimmed off both circles, or null when the nodes sit on top. */
function edgeLine(
  from: { x: number; y: number },
  to: { x: number; y: number },
): { x1: number; y1: number; x2: number; y2: number } | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) {
    return null;
  }
  const ux = dx / length;
  const uy = dy / length;
  return {
    x1: from.x + ux * CENTER_CLEARANCE,
    y1: from.y + uy * CENTER_CLEARANCE,
    x2: to.x - ux * NODE_CLEARANCE,
    y2: to.y - uy * NODE_CLEARANCE,
  };
}

/**
 * The record and its one-hop neighbourhood as rings. The panel's rows above
 * carry the same nodes, so the drawing adds a shape, never a second place to
 * look for a link.
 */
export function LocalGraph({
  spaceId,
  center,
  links,
  linksTo,
  backlinks,
  typeNames,
}: LocalGraphProps) {
  const compact = useCompactWidth();
  const coarse = useCoarsePointer();
  const width = compact ? COMPACT_WIDTH : WIDE_WIDTH;
  const graph = useMemo(
    () => buildLocalGraph({ center, links, linksTo, backlinks }),
    [center, links, linksTo, backlinks],
  );
  const layout = useMemo(
    () => layoutLocalGraph(graph.nodes, graph.edges, width, HEIGHT),
    [graph, width],
  );
  const [active, setActive] = useState<string | null>(null);
  const [offsets, setOffsets] = useState<Record<string, { x: number; y: number }>>({});

  useEffect(() => {
    setOffsets({});
    setActive(null);
  }, [center.id]);

  if (graph.edges.length === 0) {
    return null;
  }

  const edgeKind = new Map(graph.edges.map((edge) => [edge.target, edge]));
  const position = (
    id: string,
    base: { x: number; y: number },
  ): { x: number; y: number } => ({
    x: base.x + (offsets[id]?.x ?? 0),
    y: base.y + (offsets[id]?.y ?? 0),
  });
  const centerPoint = position(center.id, layout.center);
  const pointById = new Map(
    layout.nodes.map((node) => [node.id, position(node.id, node)]),
  );
  const dense = graph.nodes.length > 8;
  const crowded = graph.nodes.length > GRAPH_RING_LIMIT;
  const labelLimit = graph.nodes.length > 16 ? DENSE_LABEL_CHARS - 2 : DENSE_LABEL_CHARS;

  return (
    <div>
      <GraphCanvas
        width={width}
        height={HEIGHT}
        label={`The records linked to and from ${center.title}`}
        resetKey={center.id}
        hint={
          coarse
            ? "drag to pan · tap a record · ± to zoom"
            : "drag to pan · drag a node to move · scroll to zoom"
        }
        onNodeDrag={(id, dx, dy) =>
          setOffsets((current) => {
            const at = current[id] ?? { x: 0, y: 0 };
            return { ...current, [id]: { x: at.x + dx, y: at.y + dy } };
          })
        }
        legend={
          <>
            <span aria-hidden>— relation</span>
            <span aria-hidden>-- mention</span>
          </>
        }
      >
        <g aria-hidden>
          {graph.nodes.map((node) => {
            const point = pointById.get(node.id);
            const kind = edgeKind.get(node.id);
            if (!point) {
              return null;
            }
            const line = edgeLine(centerPoint, point);
            if (!line) {
              return null;
            }
            const lit = active === node.id;
            return (
              <line
                key={`edge:${node.id}`}
                x1={line.x1}
                y1={line.y1}
                x2={line.x2}
                y2={line.y2}
                stroke="currentColor"
                strokeWidth={lit ? 1.5 : 1}
                strokeDasharray={kind?.kind === "mention" ? "4 4" : undefined}
                className={cn(
                  "transition-colors",
                  kind?.kind === "relation" ? "text-line-strong" : "text-line-interactive",
                  lit && "text-accent",
                )}
              />
            );
          })}
        </g>

        <g
          aria-current="page"
          aria-label={`${center.title}, this record`}
          data-node-id={center.id}
          className="touch-none"
        >
          <title>{center.title} — this record</title>
          <circle
            cx={centerPoint.x}
            cy={centerPoint.y}
            r={9}
            fill="currentColor"
            className="text-ground"
          />
          <circle
            cx={centerPoint.x}
            cy={centerPoint.y}
            r={9}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            className="text-accent"
          />
          <text
            x={centerPoint.x}
            y={centerPoint.y + 26}
            textAnchor="middle"
            fill="currentColor"
            className="text-[12px] text-ink"
          >
            {clipLabel(center.title)}
          </text>
        </g>

        {graph.nodes.map((node, index) => {
          const base = layout.nodes[index];
          const point = base ? pointById.get(node.id) : undefined;
          if (!point) {
            return null;
          }
          const typeName = typeNames.get(node.type) ?? node.type;
          const onLeft = point.x < layout.center.x;
          return (
            <Link
              key={node.id}
              to={`/s/${spaceId}/o/${node.id}`}
              aria-label={`${node.title}, ${typeName}`}
              data-node-id={node.id}
              className="group cursor-grab touch-none text-ink transition-colors hover:text-accent"
              onPointerEnter={() => setActive(node.id)}
              onPointerLeave={() => setActive(null)}
              onFocus={() => setActive(node.id)}
              onBlur={() => setActive(null)}
            >
              <title>
                {node.title} · {typeName}
              </title>
              <circle
                cx={point.x}
                cy={point.y}
                r={5}
                fill="currentColor"
                className="text-ground"
              />
              <circle
                cx={point.x}
                cy={point.y}
                r={5}
                fill="none"
                stroke="currentColor"
                strokeWidth={1}
                className="text-line-interactive group-hover:text-accent group-focus-visible:text-accent group-focus-visible:stroke-2"
              />
              {crowded && index < GRAPH_RING_LIMIT ? null : (
                <text
                  x={onLeft ? point.x - 9 : point.x + 9}
                  y={point.y + 1 + (dense ? (index % 2 === 0 ? -6 : 6) : 0)}
                  textAnchor={onLeft ? "end" : "start"}
                  dominantBaseline="middle"
                  fill="currentColor"
                  className="text-[12px] text-muted group-hover:text-accent group-focus-visible:text-accent"
                >
                  {clipLabel(node.title, dense ? labelLimit : LABEL_CHARS)}
                </text>
              )}
            </Link>
          );
        })}
      </GraphCanvas>

      {graph.hidden > 0 ? (
        <button
          type="button"
          className="mt-1 min-h-11 text-left text-[12px] text-muted underline decoration-line-strong transition-colors hover:text-ink pointer-fine:min-h-0"
          onClick={() => {
            const rows = document.getElementById("links-rows");
            rows?.scrollIntoView({ behavior: "smooth", block: "start" });
            rows?.querySelector<HTMLElement>("ul a")?.focus({ preventScroll: true });
          }}
        >
          +{graph.hidden} more
        </button>
      ) : null}
    </div>
  );
}
