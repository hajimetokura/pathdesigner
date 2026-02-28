import { useMemo } from "react";
import { useStore } from "@xyflow/react";

type StoreState = {
  edges: { target: string; targetHandle?: string | null; source: string }[];
  nodeLookup: Map<string, { data: Record<string, unknown> }>;
};

/**
 * Subscribe to multiple upstream nodes' data via dynamically numbered target handles.
 * Returns an array of extracted data (one per connected handle), skipping unconnected ones.
 */
export function useMultiUpstreamData<T>(
  nodeId: string,
  handlePrefix: string,
  handleCount: number,
  extract: (data: Record<string, unknown>) => T | undefined,
): T[] {
  const selector = useMemo(
    () => (s: StoreState) => {
      const results: T[] = [];
      for (let i = 0; i < handleCount; i++) {
        const handleId = `${handlePrefix}-${i}`;
        const edge = s.edges.find(
          (e) => e.target === nodeId && e.targetHandle === handleId,
        );
        if (!edge) continue;
        const node = s.nodeLookup.get(edge.source);
        if (!node?.data) continue;
        const val = extract(node.data);
        if (val !== undefined) results.push(val);
      }
      return results;
    },
    [nodeId, handlePrefix, handleCount, extract],
  );

  return useStore(selector, arrShallowEqual);
}

function arrShallowEqual<T>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!Object.is(a[i], b[i])) return false;
  }
  return true;
}
