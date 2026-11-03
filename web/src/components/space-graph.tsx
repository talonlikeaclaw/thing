import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";

import type { SpaceGraphEdge, SpaceGraphNode } from "@/api/types";
import { GraphCanvas } from "@/components/graph-canvas";
import { cn } from "@/lib/cn";
import { layoutSpaceGraph } from "@/lib/graph";
import { useCoarsePointer, useCompactWidth } from "@/lib/media";

const WIDE_WIDTH = 640;
const COMPACT_WIDTH = 390;
const HEIGHT = 420;
/** Past this many records the labels would bury the drawing; hover still names them. */
const LABEL_ALL = 10;
/** Space an edge keeps from each node's circle, in graph units. */
const NODE_CLEARANCE = 6;

interface SpaceGraphProps {
  spaceId: string;
  /**
   * The record the page shows, marked so its place in the space is visible.
   * Absent on the space home, where no record is current: the layout then takes
   * its own middle instead of centring a record the page is not about.
   */
  centerId?: string;
  nodes: SpaceGraphNode[];
  edges: SpaceGraphEdge[];
  typeNames: ReadonlyMap<string, string>;
}

function edgeEnds(
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
    x1: from.x + ux * NODE_CLEARANCE,
    y1: from.y + uy * NODE_CLEARANCE,
    x2: to.x - ux * NODE_CLEARANCE,
    y2: to.y - uy * NODE_CLEARANCE,
  };
}

/**
 * Every record in the space, with the current one ringed. The layout is the
 * deterministic force map in `lib/graph.ts`, so reopening a space draws the
 * same shape.
 */
export function SpaceGraph({ spaceId, centerId, nodes, edges, typeNames }: SpaceGraphProps) {
  const compact = useCompactWidth();
  const coarse = useCoarsePointer();
  const width = compact ? COMPACT_WIDTH : WIDE_WIDTH;
  const layout = useMemo(
    () => layoutSpaceGraph(nodes, edges, width, HEIGHT, centerId),
    [nodes, edges, width, centerId],
  );
  const [active, setActive] = useState<string | null>(null);
  const [offsets, setOffsets] = useState<Record<string, { x: number; y: number }>>({});

  useEffect(() => {
    setOffsets({});
    setActive(null);
  }, [centerId]);

  if (nodes.length === 0) {
    return <p className="text-[13px] text-muted">No records yet.</p>;
  }

  const kindByPair = new Map(edges.map((edge) => [`${edge.source}>${edge.target}`, edge]));
  const showAll = nodes.length <= LABEL_ALL;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const position = (
    id: string,
    base: { x: number; y: number },
  ): { x: number; y: number } => ({
    x: base.x + (offsets[id]?.x ?? 0),
    y: base.y + (offsets[id]?.y ?? 0),
  });
  const pointById = new Map(
    layout.nodes.map((node) => [node.id, position(node.id, node)]),
  );

  return (
    <GraphCanvas
      width={width}
      height={HEIGHT}
      label="Every record in this space and how they connect"
      resetKey={centerId ?? "space"}
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
        {layout.edges.map((edge) => {
          const kind = kindByPair.get(`${edge.source}>${edge.target}`);
          const lit = active === edge.source || active === edge.target;
          const source = pointById.get(edge.source);
          const target = pointById.get(edge.target);
          if (!source || !target) {
            return null;
          }
          const ends = edgeEnds(source, target);
          if (!ends) {
            return null;
          }
          return (
            <line
              key={`edge:${edge.source}:${edge.target}`}
              x1={ends.x1}
              y1={ends.y1}
              x2={ends.x2}
              y2={ends.y2}
              stroke="currentColor"
              strokeWidth={lit ? 1.5 : 0.75}
              strokeDasharray={kind?.kind === "mention" ? "4 4" : undefined}
              className={cn(
                "transition-colors",
                kind?.kind === "relation" ? "text-line-strong" : "text-line-interactive",
                lit ? "text-accent" : "opacity-70",
              )}
            />
          );
        })}
      </g>

      {layout.nodes.map((base) => {
        const node = byId.get(base.id);
        const point = pointById.get(base.id);
        if (!node || !point) {
          return null;
        }
        const typeName = typeNames.get(node.type) ?? node.type;
        const isCenter = node.id === centerId;
        const label = showAll || isCenter || active === node.id;
        // Keep a label inside the frame: at an edge it points inward, elsewhere
        // it points away from the centre.
        const onLeft =
          point.x >= width - 88 ? true : point.x <= 88 ? false : point.x < width / 2;

        const body = (
          <>
            <title>
              {node.title} · {typeName}
            </title>
            <circle
              cx={point.x}
              cy={point.y}
              r={isCenter ? 7 : 4}
              fill="currentColor"
              className="text-ground"
            />
            <circle
              cx={point.x}
              cy={point.y}
              r={isCenter ? 7 : 4}
              fill="none"
              stroke="currentColor"
              strokeWidth={isCenter ? 2 : 1}
              className={cn(
                "transition-colors",
                isCenter
                  ? "text-accent"
                  : "text-line-interactive group-hover:text-accent group-focus-visible:text-accent group-focus-visible:stroke-2",
              )}
            />
            {label ? (
              <text
                x={onLeft ? point.x - (isCenter ? 12 : 8) : point.x + (isCenter ? 12 : 8)}
                y={point.y + 1}
                textAnchor={onLeft ? "end" : "start"}
                dominantBaseline="middle"
                fill="currentColor"
                className={cn(
                  "text-[12px] group-hover:text-accent group-focus-visible:text-accent",
                  isCenter ? "text-ink" : "text-muted",
                )}
              >
                {node.title.length > 22 ? `${node.title.slice(0, 21)}…` : node.title}
              </text>
            ) : null}
          </>
        );

        if (isCenter) {
          return (
            <g
              key={node.id}
              aria-current="page"
              aria-label={`${node.title}, this record`}
              data-node-id={node.id}
              className="touch-none"
              onPointerEnter={() => setActive(node.id)}
              onPointerLeave={() => setActive(null)}
            >
              {body}
            </g>
          );
        }

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
            {body}
          </Link>
        );
      })}
    </GraphCanvas>
  );
}
