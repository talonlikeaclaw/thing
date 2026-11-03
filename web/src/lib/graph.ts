import type {
  Backlink,
  ObjectLink,
  OutgoingLink,
  SpaceGraphEdge,
  SpaceGraphNode,
} from "@/api/types";

/** How many neighbours the drawing holds before it reports the overflow. */
export const GRAPH_NODE_LIMIT = 24;

/** The most neighbours one ring can carry before a second ring opens. */
export const GRAPH_RING_LIMIT = 12;

/** The record the graph is drawn around. */
export interface GraphCenter {
  id: string;
  title: string;
  type: string;
  icon?: string;
}

/** One neighbour, named by the strongest fact that connects it. */
export interface GraphNode extends GraphCenter {
  kind: "relation" | "link" | "mention";
}

/**
 * One radial edge. `kind` is the fact that decides the stroke — a property
 * relation is solid, a body link is dashed — and `mention` marks a relation
 * edge whose source also writes the centre's name, so both facts stay visible
 * without a second line.
 */
export interface GraphEdge {
  target: string;
  kind: "relation" | "mention";
  mention: boolean;
}

export interface LocalGraph {
  center: GraphCenter;
  /** Every drawn neighbour, strongest first, at most `GRAPH_NODE_LIMIT`. */
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Neighbours left out by the cap. */
  hidden: number;
}

export interface BuildLocalGraphInput {
  center: GraphCenter;
  links?: ObjectLink[];
  linksTo?: OutgoingLink[];
  backlinks?: Backlink[];
}

interface Candidate {
  id: string;
  title: string;
  type: string;
  icon?: string;
  relation: boolean;
  link: boolean;
  mention: boolean;
}

function priority(candidate: Candidate): number {
  if (candidate.relation) {
    return 0;
  }
  return candidate.link ? 1 : 2;
}

/** Title then id, both plain string order so the same data always sorts alike. */
function compareNodes(left: Candidate, right: Candidate): number {
  const byPriority = priority(left) - priority(right);
  if (byPriority !== 0) {
    return byPriority;
  }
  const leftTitle = left.title.toLowerCase();
  const rightTitle = right.title.toLowerCase();
  if (leftTitle !== rightTitle) {
    return leftTitle < rightTitle ? -1 : 1;
  }
  if (left.title !== right.title) {
    return left.title < right.title ? -1 : 1;
  }
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

/**
 * The centre, its resolved outgoing links and every record that points at it,
 * deduplicated and capped. Only a resolved outgoing link becomes a node; an
 * unknown or ambiguous one is already a warning in the body. Outgoing relation
 * and mention rows from `links_to` join the same candidate map as incoming
 * rows, so one target keeps every fact in one node and one edge.
 */
export function buildLocalGraph({
  center,
  links,
  linksTo,
  backlinks,
}: BuildLocalGraphInput): LocalGraph {
  const candidates = new Map<string, Candidate>();

  const add = (
    record: GraphCenter,
    fact: "relation" | "link" | "mention",
  ): void => {
    if (record.id === center.id) {
      return;
    }
    let candidate = candidates.get(record.id);
    if (!candidate) {
      candidate = {
        id: record.id,
        title: record.title,
        type: record.type,
        icon: record.icon,
        relation: false,
        link: false,
        mention: false,
      };
      candidates.set(record.id, candidate);
    }
    candidate[fact] = true;
  };

  for (const row of backlinks ?? []) {
    if (row.kind === "relation") {
      add({ id: row.id, title: row.title, type: row.type, icon: row.icon }, "relation");
    } else {
      add({ id: row.id, title: row.title, type: row.type, icon: row.icon }, "mention");
    }
  }
  for (const row of linksTo ?? []) {
    if (row.kind === "relation") {
      add({ id: row.id, title: row.title, type: row.type, icon: row.icon }, "relation");
    } else {
      add({ id: row.id, title: row.title, type: row.type, icon: row.icon }, "mention");
    }
  }
  for (const link of links ?? []) {
    if (link.status === "ok" && link.id) {
      add({ id: link.id, title: link.title, type: link.type }, "link");
    }
  }

  const sorted = [...candidates.values()].sort(compareNodes);
  const drawn = sorted.slice(0, GRAPH_NODE_LIMIT);
  const nodes: GraphNode[] = drawn.map((candidate) => ({
    id: candidate.id,
    title: candidate.title,
    type: candidate.type,
    ...(candidate.icon === undefined ? {} : { icon: candidate.icon }),
    kind: candidate.relation ? "relation" : candidate.link ? "link" : "mention",
  }));
  const edges: GraphEdge[] = drawn.map((candidate) => ({
    target: candidate.id,
    kind: candidate.relation ? "relation" : "mention",
    mention: candidate.relation && (candidate.link || candidate.mention),
  }));

  return {
    center,
    nodes,
    edges,
    hidden: sorted.length - nodes.length,
  };
}

export interface GraphPoint {
  x: number;
  y: number;
}

export interface LaidOutNode extends GraphPoint {
  id: string;
}

export interface LaidOutEdge {
  target: string;
  from: GraphPoint;
  to: GraphPoint;
}

export interface LocalGraphLayout {
  center: GraphPoint;
  nodes: LaidOutNode[];
  edges: LaidOutEdge[];
}

/** Space between the centre dot's rim and its first edge pixel. */
const CENTER_GAP = 2;
/** Space between a neighbour's rim and the edge that reaches it. */
const NODE_GAP = 3;
/** How far an edge stops short of the centre and the neighbour circles. */
const CENTER_CLEARANCE = 9 + CENTER_GAP;
const NODE_CLEARANCE = 5 + NODE_GAP;

/**
 * Rings by node order, never a simulation: the same record always draws the
 * same picture. Twelve neighbours fit one ring; the rest open a wider second
 * ring, and both fill clockwise from the top.
 */
export function layoutLocalGraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
  width: number,
  height: number,
): LocalGraphLayout {
  const center: GraphPoint = { x: width / 2, y: height / 2 };
  const fit = Math.max(40, Math.min(width, height) / 2 - 36);
  const twoRings = nodes.length > GRAPH_RING_LIMIT;
  const inner = twoRings ? fit * 0.62 : fit * 0.82;

  const placed: LaidOutNode[] = nodes.map((node, index) => {
    const onOuter = twoRings && index >= GRAPH_RING_LIMIT;
    const ringIndex = onOuter ? index - GRAPH_RING_LIMIT : index;
    const ringCount = onOuter
      ? nodes.length - GRAPH_RING_LIMIT
      : Math.min(nodes.length, GRAPH_RING_LIMIT);
    const radius = onOuter ? fit : inner;
    const angle = -Math.PI / 2 + (2 * Math.PI * ringIndex) / ringCount;
    return {
      id: node.id,
      x: center.x + radius * Math.cos(angle),
      y: center.y + radius * Math.sin(angle),
    };
  });

  const byId = new Map(placed.map((node) => [node.id, node]));
  const drawn: LaidOutEdge[] = [];
  for (const edge of edges) {
    const target = byId.get(edge.target);
    if (!target) {
      continue;
    }
    const dx = target.x - center.x;
    const dy = target.y - center.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) {
      continue;
    }
    const ux = dx / length;
    const uy = dy / length;
    drawn.push({
      target: edge.target,
      from: {
        x: center.x + ux * CENTER_CLEARANCE,
        y: center.y + uy * CENTER_CLEARANCE,
      },
      to: {
        x: target.x - ux * NODE_CLEARANCE,
        y: target.y - uy * NODE_CLEARANCE,
      },
    });
  }

  return { center, nodes: placed, edges: drawn };
}

export interface SpaceLayoutEdge {
  source: string;
  target: string;
  from: GraphPoint;
  to: GraphPoint;
}

export interface SpaceGraphLayout {
  nodes: LaidOutNode[];
  edges: SpaceLayoutEdge[];
}

/** Space between a global edge's end and the node circles. */
const SPACE_NODE_CLEARANCE = 6;
/** Nodes beyond this count share the next ring outward. */
const SPACE_RING_CAPACITY = 12;

/**
 * The whole space as rings, ordered by connectivity.
 *
 * The current record sits at the centre, then its most connected peers fill the
 * first ring with room to spare, and each further ring is wider and holds more.
 * Records without an edge still appear on a ring, so the map is the whole
 * space, not just the current component. Deterministic: degree, then title,
 * then id decide every position.
 */
export function layoutSpaceGraph(
  nodes: SpaceGraphNode[],
  edges: SpaceGraphEdge[],
  width: number,
  height: number,
  centerId?: string,
): SpaceGraphLayout {
  if (nodes.length === 0) {
    return { nodes: [], edges: [] };
  }

  const degree = new Map<string, number>();
  for (const node of nodes) {
    degree.set(node.id, 0);
  }
  for (const edge of edges) {
    if (degree.has(edge.source)) {
      degree.set(edge.source, degree.get(edge.source)! + 1);
    }
    if (degree.has(edge.target)) {
      degree.set(edge.target, degree.get(edge.target)! + 1);
    }
  }

  const byConnectivity = (left: SpaceGraphNode, right: SpaceGraphNode): number => {
    const difference = (degree.get(right.id) ?? 0) - (degree.get(left.id) ?? 0);
    if (difference !== 0) {
      return difference;
    }
    const leftTitle = left.title.toLowerCase();
    const rightTitle = right.title.toLowerCase();
    if (leftTitle !== rightTitle) {
      return leftTitle < rightTitle ? -1 : 1;
    }
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  };

  const current = centerId ? nodes.find((node) => node.id === centerId) : undefined;
  const ordered = [
    ...(current ? [current] : []),
    ...nodes.filter((node) => node !== current).sort(byConnectivity),
  ];

  const rings: SpaceGraphNode[][] = [];
  for (const node of ordered.slice(1)) {
    const index = rings.length - 1;
    if (index < 0 || rings[index]!.length === SPACE_RING_CAPACITY + index * 8) {
      rings.push([]);
    }
    rings[rings.length - 1]!.push(node);
  }

  const center = { x: width / 2, y: height / 2 };
  const maxRadius = Math.max(30, Math.min(width, height) / 2 - 28);
  const placed: LaidOutNode[] = [];
  const middle = ordered[0];
  if (middle) {
    placed.push({ id: middle.id, x: center.x, y: center.y });
  }
  rings.forEach((ring, ringIndex) => {
    const radius = maxRadius * ((ringIndex + 1) / rings.length);
    for (let at = 0; at < ring.length; at += 1) {
      const node = ring[at]!;
      const angle = -Math.PI / 2 + (2 * Math.PI * at) / ring.length;
      placed.push({
        id: node.id,
        x: center.x + radius * Math.cos(angle),
        y: center.y + radius * Math.sin(angle),
      });
    }
  });

  const placedById = new Map(placed.map((node) => [node.id, node]));
  const drawn: SpaceLayoutEdge[] = [];
  for (const edge of edges) {
    const source = placedById.get(edge.source);
    const target = placedById.get(edge.target);
    if (!source || !target || source.id === target.id) {
      continue;
    }
    const deltaX = target.x - source.x;
    const deltaY = target.y - source.y;
    const length = Math.hypot(deltaX, deltaY);
    if (length === 0) {
      continue;
    }
    const unitX = deltaX / length;
    const unitY = deltaY / length;
    drawn.push({
      source: edge.source,
      target: edge.target,
      from: {
        x: source.x + unitX * SPACE_NODE_CLEARANCE,
        y: source.y + unitY * SPACE_NODE_CLEARANCE,
      },
      to: {
        x: target.x - unitX * SPACE_NODE_CLEARANCE,
        y: target.y - unitY * SPACE_NODE_CLEARANCE,
      },
    });
  }

  return { nodes: placed, edges: drawn };
}
