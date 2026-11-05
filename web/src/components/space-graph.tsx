import { Type } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";

import { useMe } from "@/api/queries";
import type { SpaceGraphEdge, SpaceGraphNode } from "@/api/types";
import { GraphCanvas } from "@/components/graph-canvas";
import { cn } from "@/lib/cn";
import { layoutSpaceGraph } from "@/lib/graph";
import {
  DEFAULT_GRAPH_LABELS,
  graphLabelsKey,
  readGraphLabels,
  shortTitle,
  writeGraphLabels,
} from "@/lib/graph-labels";
import { useCoarsePointer, useCompactWidth } from "@/lib/media";

const WIDE_WIDTH = 640;
/**
 * The phone authors its map at 320 units so the painted 342px scales labels up
 * rather than down: at 390 units a 12px label resolved to 10.5px and names at
 * the frame edge clipped. See `adapt` in the v0.5.2 critique.
 */
const COMPACT_WIDTH = 320;
/** A band, not a canvas: the map sits under the ledger, so it stays shallow. */
const HEIGHT = 320;
/** With no edges the drawing is a scatter, so the band shrinks to the nodes. */
const ZERO_EDGE_HEIGHT = 200;
/**
 * Every node carries an invisible hit circle so a finger can land on it. It is
 * authored in graph units; the painted 316/320 scale means 23 units clears
 * 44 CSS px at 390 (22 fell one pixel short).
 */
const HIT_RADIUS = 23;

interface LabelBox {
  x1: number;
  x2: number;
  y1: number;
  y2: number;
}

/** A node's painted mark, expanded so a name never sits on the dot. */
interface NodeObstacle {
  id: string;
  x: number;
  y: number;
  r: number;
}

/** Every drawn node's mark, in graph units, padded by two. */
const NODE_MARK_RADIUS = 4;
const CENTER_MARK_RADIUS = 7;
const MARK_PADDING = 2;

/** What one name paints, in graph units, read from the shared measurer. */
interface PaintedLabel {
  width: number;
  halfHeight: number;
  /** Painted centre relative to the text's `y`, so the box sits where the ink is. */
  middle: number;
}

/** The painted box of one name, in graph units, used only to avoid overlaps. */
function labelBox(
  point: { x: number; y: number },
  labelWidth: number,
  onLeft: boolean,
  gap: number,
  halfHeight: number,
  middle: number,
  offsetY = 0,
): LabelBox {
  const x1 = onLeft ? point.x - gap - labelWidth : point.x + gap;
  const y = point.y + 1 + middle + offsetY;
  return { x1, x2: x1 + labelWidth, y1: y - halfHeight, y2: y + halfHeight };
}

function overlaps(left: LabelBox, right: LabelBox): boolean {
  return left.x1 < right.x2 && left.x2 > right.x1 && left.y1 < right.y2 && left.y2 > right.y1;
}

/** A name may not cross a node's mark, only the emptiness around it. */
function hitsMark(box: LabelBox, mark: NodeObstacle): boolean {
  const x = Math.min(Math.max(mark.x, box.x1), box.x2);
  const y = Math.min(Math.max(mark.y, box.y1), box.y2);
  return (x - mark.x) ** 2 + (y - mark.y) ** 2 < mark.r ** 2;
}

/** Maple Mono advances every glyph at 0.6em; only a fallback until painted. */
const LABEL_ADVANCE = 0.6;
/** A phone authors the map small, so its names are set a step down to stay in frame. */
const LABEL_SIZE_WIDE = 13;
const LABEL_SIZE_COMPACT = 11;
/** The gap between a node's circle and its name. */
const LABEL_GAP = 8;
/** The ringed current record's label clears its larger mark. */
const CENTER_LABEL_GAP = LABEL_GAP + 4;
/** A name past this length points at the record instead of spelling it out. */
const LABEL_CHARS_WIDE = 22;
const LABEL_CHARS_COMPACT = 18;
/** A label that would collide moves one line up or down before it gives up. */
const LABEL_LINE = 14;
/** Half a label's painted line, just above the type's own ascent and descent. */
const LABEL_HALF_HEIGHT = 0.6;
/** The phone band is shorter than the wide one: it sits under the ledger. */
const COMPACT_HEIGHT = 260;
const COMPACT_ZERO_EDGE_HEIGHT = 180;
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
  const height = compact
    ? edges.length === 0
      ? COMPACT_ZERO_EDGE_HEIGHT
      : COMPACT_HEIGHT
    : edges.length === 0
      ? ZERO_EDGE_HEIGHT
      : HEIGHT;
  const me = useMe();
  const labelsKey = me.data ? graphLabelsKey(me.data.id, spaceId) : null;
  const [labels, setLabels] = useState(DEFAULT_GRAPH_LABELS);

  useEffect(() => {
    setLabels(labelsKey ? readGraphLabels(window.localStorage, labelsKey) : DEFAULT_GRAPH_LABELS);
  }, [labelsKey]);

  const toggleLabels = () => {
    const next = !labels;
    setLabels(next);
    if (labelsKey) {
      writeGraphLabels(window.localStorage, labelsKey, next);
    }
  };

  const layout = useMemo(
    () => layoutSpaceGraph(nodes, edges, width, height, centerId),
    [nodes, edges, width, height, centerId],
  );
  const [active, setActive] = useState<string | null>(null);
  const [offsets, setOffsets] = useState<Record<string, { x: number; y: number }>>({});

  useEffect(() => {
    setOffsets({});
    setActive(null);
  }, [centerId]);

  const labelSize = compact ? LABEL_SIZE_COMPACT : LABEL_SIZE_WIDE;
  const labelChars = compact ? LABEL_CHARS_COMPACT : LABEL_CHARS_WIDE;
  const labelTexts = useMemo(
    () => new Map(nodes.map((node) => [node.id, shortTitle(node.title, labelChars)])),
    [nodes, labelChars],
  );
  const strings = useMemo(
    () => (labels ? [...new Set(labelTexts.values())] : []),
    [labels, labelTexts],
  );
  // A glyph's advance is not its painted width: one shared text element in the
  // same font and size is asked for the box each name actually covers, and the
  // placement below reads those numbers. Until the boxes are read (before the
  // first paint, since this is a layout effect) the advance estimate stands in.
  const [painted, setPainted] = useState<Record<string, PaintedLabel>>({});
  const measureRef = useRef<SVGTextElement>(null);
  const measureKey = `${labelSize}:${strings.join("\u0000")}`;
  useLayoutEffect(() => {
    const element = measureRef.current;
    if (!element) {
      return;
    }
    const read = () => {
      const boxes: Record<string, PaintedLabel> = {};
      for (const text of strings) {
        element.textContent = text;
        const box = element.getBBox();
        if (box.width > 0 && box.height > 0) {
          boxes[`${labelSize}:${text}`] = {
            width: box.width,
            halfHeight: box.height / 2,
            middle: box.y + box.height / 2,
          };
        }
      }
      element.textContent = "";
      setPainted(boxes);
    };
    read();
    let cancelled = false;
    // Maple Mono may arrive after the first paint; re-read once it has, so the
    // boxes describe the face the map is actually drawn in.
    document.fonts?.ready
      .then(() => {
        if (!cancelled) {
          read();
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [measureKey, labelSize, strings]);

  if (nodes.length === 0) {
    return <p className="text-[13px] text-muted">No records yet.</p>;
  }

  const kindByPair = new Map(edges.map((edge) => [`${edge.source}>${edge.target}`, edge]));
  const kinds = new Set(edges.map((edge) => edge.kind));
  // Every drawn node is a candidate for a name; the placement below drops only
  // the ones that cannot fit without covering another name or a node's mark,
  // so the titles toggle never decides which records exist, only which fit.
  const labelBoxes: LabelBox[] = [];
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
  // The marks names must not cross: the painted dot, not the invisible hit
  // circle, so a name sits in the empty space beside a node and never on it.
  const marks: NodeObstacle[] = layout.nodes.map((node) => {
    const point = pointById.get(node.id) ?? node;
    return {
      id: node.id,
      x: point.x,
      y: point.y,
      r:
        (node.id === centerId ? CENTER_MARK_RADIUS : NODE_MARK_RADIUS) + MARK_PADDING,
    };
  });

  return (
    <GraphCanvas
      width={width}
      height={height}
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
      actions={
        <button
          type="button"
          aria-pressed={labels}
          aria-label="Record titles"
          title="Record titles"
          className="inline-flex size-8 items-center justify-center rounded-full border border-line text-muted transition-colors hover:border-line-strong hover:text-ink aria-pressed:border-line-strong aria-pressed:text-ink pointer-coarse:size-11"
          onClick={toggleLabels}
        >
          <Type aria-hidden size={14} />
        </button>
      }
      legend={
        kinds.size === 0 ? (
          <span className="text-muted">
            No links yet — a relation or a mention draws the first line.
          </span>
        ) : (
          <>
            {kinds.has("relation") ? <span aria-hidden>— relation</span> : null}
            {kinds.has("mention") ? <span aria-hidden>-- mention</span> : null}
          </>
        )
      }
    >
      {/* One shared text element in the labels' own font and size; the layout
          effect reads each name's painted box from it. Hidden, never shown. */}
      <text
        ref={measureRef}
        x={0}
        y={0}
        fontSize={labelSize}
        dominantBaseline="middle"
        visibility="hidden"
        aria-hidden
      />
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
        const labelText = labelTexts.get(node.id) ?? shortTitle(node.title, labelChars);
        const labelGap = isCenter ? CENTER_LABEL_GAP : LABEL_GAP;
        // The painted box when it has been read; the advance estimate only
        // stands in until the measurer reports (before the first paint).
        const shape = painted[`${labelSize}:${labelText}`];
        const labelWidth = shape?.width ?? labelText.length * LABEL_ADVANCE * labelSize;
        const halfHeight = shape?.halfHeight ?? labelSize * LABEL_HALF_HEIGHT;
        const middle = shape?.middle ?? 0;
        const roomRight = width - point.x;
        const roomLeft = point.x;
        const footprint = labelWidth + labelGap;
        const preferredLeft = roomRight < footprint && roomLeft > roomRight;
        // Try the natural side first, then the same side one line up or down,
        // then the far side. A tiered phone ring puts names close together;
        // without the lanes half the node labels were dropped. A name that
        // cannot clear every mark and every other name is not drawn: a node
        // without a name beats a name over a node.
        const placement = !labels
          ? null
          : ([
              { left: preferredLeft, dy: 0 },
              { left: preferredLeft, dy: -LABEL_LINE },
              { left: preferredLeft, dy: LABEL_LINE },
              { left: !preferredLeft, dy: 0 },
              { left: !preferredLeft, dy: -LABEL_LINE },
              { left: !preferredLeft, dy: LABEL_LINE },
            ].find((candidate) => {
              const room = candidate.left ? roomLeft : roomRight;
              if (room < footprint) {
                return false;
              }
              const box = labelBox(
                point,
                labelWidth,
                candidate.left,
                labelGap,
                halfHeight,
                middle,
                candidate.dy,
              );
              return (
                !labelBoxes.some((placed) => overlaps(placed, box)) &&
                !marks.some((mark) => mark.id !== node.id && hitsMark(box, mark))
              );
            }) ?? null);
        const label = placement ? labelText : null;
        if (placement) {
          labelBoxes.push(
            labelBox(
              point,
              labelWidth,
              placement.left,
              labelGap,
              halfHeight,
              middle,
              placement.dy,
            ),
          );
        }

        const body = (
          <>
            <title>
              {node.title} · {typeName}
            </title>
            {/* The visible node stays small; the hit circle is what a finger
                lands on, so the drawn mark never lies about its target. */}
            <circle cx={point.x} cy={point.y} r={HIT_RADIUS} fill="transparent" />
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
                x={
                  placement?.left
                    ? point.x - labelGap
                    : point.x + labelGap
                }
                y={point.y + 1 + (placement?.dy ?? 0)}
                textAnchor={placement?.left ? "end" : "start"}
                dominantBaseline="middle"
                fill="currentColor"
                fontSize={labelSize}
                className={cn(
                  "group-hover:text-accent group-focus-visible:text-accent",
                  isCenter ? "text-ink" : "text-muted",
                )}
              >
                {label}
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
