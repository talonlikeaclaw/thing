import { describe, expect, it } from "vitest";

import type { Backlink, ObjectLink, OutgoingLink } from "@/api/types";
import {
  buildLocalGraph,
  GRAPH_NODE_LIMIT,
  GRAPH_RING_LIMIT,
  layoutLocalGraph,
  layoutSpaceGraph,
  type GraphCenter,
} from "@/lib/graph";
import type { SpaceGraphEdge, SpaceGraphNode } from "@/api/types";

const center: GraphCenter = { id: "centre", title: "Monstera", type: "plant" };

function mention(id: string, title: string, count = 1): Backlink {
  return { kind: "mention", id, title, type: "chore", snippet: `${title} watered it.`, count };
}

function relation(id: string, title: string, property = "related_plant"): Backlink {
  return {
    kind: "relation",
    id,
    title,
    type: "plant",
    property,
    property_name: "Related plant",
  };
}

function outgoingRelation(id: string, title: string, property = "related_plant"): OutgoingLink {
  return {
    kind: "relation",
    id,
    title,
    type: "plant",
    property,
    property_name: "Related plant",
  };
}

function outgoingMention(id: string, title: string): OutgoingLink {
  return { kind: "mention", id, title, type: "plant" };
}

function link(id: string, title: string, status: ObjectLink["status"] = "ok"): ObjectLink {
  return { raw: `plant/${title}`, type: "plant", title, status, ...(status === "ok" ? { id } : {}) };
}

describe("buildLocalGraph", () => {
  it("returns only the centre when nothing points at it", () => {
    const graph = buildLocalGraph({ center });
    expect(graph.center).toBe(center);
    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
    expect(graph.hidden).toBe(0);
  });

  it("orders relations, then outgoing links, then mentions", () => {
    const graph = buildLocalGraph({
      center,
      links: [link("l", "Apple")],
      backlinks: [mention("m", "Mango"), relation("r", "Zebra")],
    });
    expect(graph.nodes.map((node) => node.id)).toEqual(["r", "l", "m"]);
    expect(graph.nodes.map((node) => node.kind)).toEqual(["relation", "link", "mention"]);
  });

  it("sorts equal ranks by title, then id", () => {
    const graph = buildLocalGraph({
      center,
      backlinks: [mention("b", "Same"), mention("a", "Same"), mention("c", "Alpha")],
    });
    expect(graph.nodes.map((node) => node.id)).toEqual(["c", "a", "b"]);
  });

  it("deduplicates one source into one node and keeps both facts on the edge", () => {
    const graph = buildLocalGraph({
      center,
      links: [link("source", "Water the monstera")],
      backlinks: [relation("source", "Water the monstera"), mention("source", "Water the monstera")],
    });
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0]!.kind).toBe("relation");
    expect(graph.edges).toEqual([{ target: "source", kind: "relation", mention: true }]);
  });

  it("draws an outgoing relation and an outgoing mention", () => {
    const graph = buildLocalGraph({
      center,
      linksTo: [outgoingRelation("r", "Ivy"), outgoingMention("m", "Fern")],
    });
    expect(graph.nodes.map((node) => node.id)).toEqual(["r", "m"]);
    expect(graph.nodes.map((node) => node.kind)).toEqual(["relation", "mention"]);
    expect(graph.edges).toEqual([
      { target: "r", kind: "relation", mention: false },
      { target: "m", kind: "mention", mention: false },
    ]);
  });

  it("keeps one target with an outgoing relation and an incoming mention", () => {
    const graph = buildLocalGraph({
      center,
      linksTo: [outgoingRelation("source", "Water the monstera")],
      backlinks: [mention("source", "Water the monstera")],
    });
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0]!.kind).toBe("relation");
    expect(graph.edges).toEqual([{ target: "source", kind: "relation", mention: true }]);
  });

  it("drops an outgoing row that points at the centre", () => {
    const graph = buildLocalGraph({
      center,
      linksTo: [outgoingRelation(center.id, center.title), outgoingMention(center.id, center.title)],
    });
    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
  });

  it("draws a relation-only edge solid and an outgoing link dashed", () => {
    const graph = buildLocalGraph({ center, links: [link("l", "Fern")], backlinks: [relation("r", "Ivy")] });
    expect(graph.edges).toEqual([
      { target: "r", kind: "relation", mention: false },
      { target: "l", kind: "mention", mention: false },
    ]);
  });

  it("drops an unresolved outgoing link and a self reference", () => {
    const graph = buildLocalGraph({
      center,
      links: [
        link("unknown", "Ghost", "unknown"),
        { raw: "plant/Ghost", type: "plant", title: "Ghost", status: "ambiguous" },
        link(center.id, center.title),
      ],
    });
    expect(graph.nodes).toEqual([]);
  });

  it("caps the drawn nodes and reports the overflow", () => {
    const backlinks = Array.from({ length: 30 }, (_, index) =>
      mention(`m${String(index).padStart(2, "0")}`, `Chore ${String(index).padStart(2, "0")}`),
    );
    const graph = buildLocalGraph({ center, backlinks });
    expect(graph.nodes).toHaveLength(GRAPH_NODE_LIMIT);
    expect(graph.hidden).toBe(6);
    expect(graph.edges).toHaveLength(GRAPH_NODE_LIMIT);
    expect(graph.nodes[0]!.title).toBe("Chore 00");
    expect(graph.nodes.at(-1)!.title).toBe("Chore 23");
  });

  it("carries an icon only when the source row has one", () => {
    const graph = buildLocalGraph({
      center,
      backlinks: [{ ...mention("m", "Misty"), icon: "💧", type_icon: "🌱" }],
      links: [link("l", "Fern")],
    });
    expect(graph.nodes[0]!).toMatchObject({ id: "l" });
    expect(graph.nodes[1]).toMatchObject({ id: "m", icon: "💧" });
  });
});

describe("layoutLocalGraph", () => {
  function graphOf(count: number) {
    return buildLocalGraph({
      center,
      backlinks: Array.from({ length: count }, (_, index) =>
        mention(`m${String(index).padStart(2, "0")}`, `Chore ${String(index).padStart(2, "0")}`),
      ),
    });
  }

  it("places the centre at the box centre and nothing else when empty", () => {
    const layout = layoutLocalGraph([], [], 640, 320);
    expect(layout.center).toEqual({ x: 320, y: 160 });
    expect(layout.nodes).toEqual([]);
    expect(layout.edges).toEqual([]);
  });

  it("puts one ring's nodes at one radius, starting at the top", () => {
    const graph = graphOf(4);
    const layout = layoutLocalGraph(graph.nodes, graph.edges, 640, 320);
    const radius = Math.hypot(layout.nodes[0]!.x - 320, layout.nodes[0]!.y - 160);
    expect(layout.nodes[0]!.x).toBeCloseTo(320);
    expect(layout.nodes[0]!.y).toBeLessThan(160);
    for (const node of layout.nodes) {
      expect(Math.hypot(node.x - 320, node.y - 160)).toBeCloseTo(radius);
    }
  });

  it("opens a second, wider ring past twelve nodes", () => {
    const graph = graphOf(GRAPH_RING_LIMIT + 3);
    const layout = layoutLocalGraph(graph.nodes, graph.edges, 640, 320);
    const radius = (node: { x: number; y: number }) => Math.hypot(node.x - 320, node.y - 160);
    const inner = radius(layout.nodes[0]!);
    const outer = radius(layout.nodes[GRAPH_RING_LIMIT]!);
    expect(outer).toBeGreaterThan(inner);
    for (let index = 0; index < GRAPH_RING_LIMIT; index += 1) {
      expect(radius(layout.nodes[index]!)).toBeCloseTo(inner);
    }
    for (let index = GRAPH_RING_LIMIT; index < layout.nodes.length; index += 1) {
      expect(radius(layout.nodes[index]!)).toBeCloseTo(outer);
    }
  });

  it("clips each edge to the centre and the neighbour", () => {
    const graph = graphOf(3);
    const layout = layoutLocalGraph(graph.nodes, graph.edges, 640, 320);
    const target = layout.nodes[0]!;
    const edge = layout.edges[0]!;
    expect(Math.hypot(edge.from.x - 320, edge.from.y - 160)).toBeCloseTo(11);
    expect(Math.hypot(edge.to.x - target.x, edge.to.y - target.y)).toBeCloseTo(8);
  });

  it("draws the same records identically every time", () => {
    const graph = graphOf(5);
    const first = layoutLocalGraph(graph.nodes, graph.edges, 640, 320);
    const second = layoutLocalGraph(graph.nodes, graph.edges, 640, 320);
    expect(second).toEqual(first);
  });
});

describe("layoutSpaceGraph", () => {
  const nodes: SpaceGraphNode[] = [
    { id: "a", title: "A", type: "plant" },
    { id: "b", title: "B", type: "plant" },
    { id: "c", title: "C", type: "chore" },
  ];
  const edges: SpaceGraphEdge[] = [
    { source: "a", target: "b", kind: "mention", mention: true },
    { source: "c", target: "a", kind: "relation", mention: false },
  ];

  it("returns nothing for an empty space", () => {
    expect(layoutSpaceGraph([], [], 640, 420)).toEqual({ nodes: [], edges: [] });
  });

  it("places one record in the middle", () => {
    const layout = layoutSpaceGraph([nodes[0]!], [], 640, 420);
    expect(layout.nodes[0]).toMatchObject({ id: "a", x: 320, y: 210 });
  });

  it("centres the current record and orders the ring by connectivity", () => {
    const layout = layoutSpaceGraph(nodes, edges, 640, 420, "b");
    expect(layout.nodes[0]).toEqual({ id: "b", x: 320, y: 210 });
    expect(layout.nodes.map((node) => node.id)).toEqual(["b", "a", "c"]);
  });

  it("keeps every node inside the box and every edge between two nodes", () => {
    const layout = layoutSpaceGraph(nodes, edges, 640, 420);
    for (const node of layout.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(23.9);
      expect(node.x).toBeLessThanOrEqual(616.1);
      expect(node.y).toBeGreaterThanOrEqual(23.9);
      expect(node.y).toBeLessThanOrEqual(396.1);
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
    }
    expect(layout.edges).toHaveLength(2);
    const byId = new Map(layout.nodes.map((node) => [node.id, node]));
    for (const edge of layout.edges) {
      const source = byId.get(edge.source)!;
      const target = byId.get(edge.target)!;
      expect(Math.hypot(edge.from.x - source.x, edge.from.y - source.y)).toBeCloseTo(6);
      expect(Math.hypot(edge.to.x - target.x, edge.to.y - target.y)).toBeCloseTo(6);
    }
  });

  it("draws the same space identically every time", () => {
    const first = layoutSpaceGraph(nodes, edges, 640, 420);
    const second = layoutSpaceGraph(nodes, edges, 640, 420);
    expect(second).toEqual(first);
  });
});
