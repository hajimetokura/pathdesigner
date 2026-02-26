import Dagre from "@dagrejs/dagre";
import type { Node, Edge } from "@xyflow/react";

interface LayoutOptions {
  direction?: "TB" | "LR";
  nodesep?: number;
  ranksep?: number;
}

// Handle render index (left=0, right=1) from each node component's JSX order.
// Update this when adding new multi-handle nodes.
const HANDLE_INDEX: Record<string, number> = {
  brep: 0, sheet: 1,               // PlacementNode inputs
  operations: 0, postprocessor: 1,  // ToolpathGenNode inputs
  toolpath: 0, output: 1,          // ToolpathGenNode outputs
};

function handleIndex(handleId: string): number {
  const suffix = handleId.split("-").slice(1).join("-");
  return HANDLE_INDEX[suffix] ?? 0;
}

/**
 * After dagre layout, swap sibling node x-positions so edges
 * don't cross between nodes sharing the same target or source.
 * Only swaps nodes at the same rank (same y position) to avoid
 * causing overlaps with other nodes at different ranks.
 */
function uncrossEdges(nodes: Node[], edges: Edge[], direction: "TB" | "LR"): void {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  // In TB mode, same-rank nodes share y; in LR mode they share x
  const rankPos = (n: Node) =>
    direction === "TB"
      ? n.position.y + (n.measured?.height ?? 100) / 2
      : n.position.x + (n.measured?.width ?? 200) / 2;
  const sameRank = (ids: string[]): boolean => {
    const ns = ids.map((id) => nodeMap.get(id)).filter(Boolean) as Node[];
    if (ns.length < 2) return false;
    const r0 = rankPos(ns[0]);
    return ns.every((n) => Math.abs(rankPos(n) - r0) < 1);
  };

  // The cross axis is x for TB, y for LR
  const getCross = (n: Node) => (direction === "TB" ? n.position.x : n.position.y);
  const setCross = (n: Node, v: number) => {
    n.position = direction === "TB"
      ? { ...n.position, x: v }
      : { ...n.position, y: v };
  };

  // Fix source node ordering for edges sharing the same TARGET
  const byTarget = new Map<string, Edge[]>();
  for (const edge of edges) {
    if (!edge.targetHandle) continue;
    const group = byTarget.get(edge.target) ?? [];
    group.push(edge);
    byTarget.set(edge.target, group);
  }

  for (const [, group] of byTarget) {
    if (group.length < 2) continue;
    const sourceIds = group.map((e) => e.source);
    if (!sameRank(sourceIds)) continue;
    const sorted = [...group].sort(
      (a, b) => handleIndex(a.targetHandle!) - handleIndex(b.targetHandle!),
    );
    const positions = sorted
      .map((e) => nodeMap.get(e.source))
      .filter(Boolean)
      .map((n) => getCross(n!))
      .sort((a, b) => a - b);
    sorted.forEach((edge, i) => {
      const node = nodeMap.get(edge.source);
      if (node && positions[i] !== undefined) setCross(node, positions[i]);
    });
  }

  // Fix target node ordering for edges sharing the same SOURCE
  const bySource = new Map<string, Edge[]>();
  for (const edge of edges) {
    if (!edge.sourceHandle) continue;
    const group = bySource.get(edge.source) ?? [];
    group.push(edge);
    bySource.set(edge.source, group);
  }

  for (const [, group] of bySource) {
    if (group.length < 2) continue;
    const targetIds = group.map((e) => e.target);
    if (!sameRank(targetIds)) continue;
    const sorted = [...group].sort(
      (a, b) => handleIndex(a.sourceHandle!) - handleIndex(b.sourceHandle!),
    );
    const positions = sorted
      .map((e) => nodeMap.get(e.target))
      .filter(Boolean)
      .map((n) => getCross(n!))
      .sort((a, b) => a - b);
    sorted.forEach((edge, i) => {
      const node = nodeMap.get(edge.target);
      if (node && positions[i] !== undefined) setCross(node, positions[i]);
    });
  }
}

export function getLayoutedElements(
  nodes: Node[],
  edges: Edge[],
  options: LayoutOptions = {},
): Node[] {
  const { direction = "TB", nodesep = 50, ranksep = 80 } = options;

  const g = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: direction, nodesep, ranksep });

  nodes.forEach((node) => {
    g.setNode(node.id, {
      width: node.measured?.width ?? 200,
      height: node.measured?.height ?? 100,
    });
  });

  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  Dagre.layout(g);

  const result = nodes.map((node) => {
    const pos = g.node(node.id);
    return {
      ...node,
      position: {
        x: pos.x - (node.measured?.width ?? 200) / 2,
        y: pos.y - (node.measured?.height ?? 100) / 2,
      },
    };
  });

  uncrossEdges(result, edges, direction);
  return result;
}
