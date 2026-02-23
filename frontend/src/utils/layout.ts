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
function uncrossEdges(nodes: Node[], edges: Edge[]): void {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  // Compare center-y (dagre aligns centers, not top-left corners)
  const centerY = (n: Node) => n.position.y + (n.measured?.height ?? 100) / 2;
  const sameRank = (ids: string[]): boolean => {
    const nodes = ids.map((id) => nodeMap.get(id)).filter(Boolean) as Node[];
    if (nodes.length < 2) return false;
    const cy0 = centerY(nodes[0]);
    return nodes.every((n) => Math.abs(centerY(n) - cy0) < 1);
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
    const xPositions = sorted
      .map((e) => nodeMap.get(e.source))
      .filter(Boolean)
      .map((n) => n!.position.x)
      .sort((a, b) => a - b);
    sorted.forEach((edge, i) => {
      const node = nodeMap.get(edge.source);
      if (node && xPositions[i] !== undefined) {
        node.position = { ...node.position, x: xPositions[i] };
      }
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
    const xPositions = sorted
      .map((e) => nodeMap.get(e.target))
      .filter(Boolean)
      .map((n) => n!.position.x)
      .sort((a, b) => a - b);
    sorted.forEach((edge, i) => {
      const node = nodeMap.get(edge.target);
      if (node && xPositions[i] !== undefined) {
        node.position = { ...node.position, x: xPositions[i] };
      }
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

  uncrossEdges(result, edges);
  return result;
}
