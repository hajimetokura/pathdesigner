import { useMemo } from "react";
import { useStore } from "@xyflow/react";

type StoreState = {
  edges: { target: string; targetHandle?: string | null; source: string }[];
  nodeLookup: Map<string, { data: Record<string, unknown> }>;
};

function shallowEqual<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null)
    return false;
  const keysA = Object.keys(a as Record<string, unknown>);
  const keysB = Object.keys(b as Record<string, unknown>);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (
      !Object.is(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
      )
    )
      return false;
  }
  return true;
}

/**
 * Subscribe to an upstream node's data via a specific target handle.
 * Uses shallow equality so extract functions returning new objects
 * with the same inner references won't cause unnecessary re-renders.
 */
export function useUpstreamData<T>(
  nodeId: string,
  targetHandle: string,
  extract: (data: Record<string, unknown>) => T | undefined,
): T | undefined {
  const selector = useMemo(
    () => (s: StoreState) => {
      const edge = s.edges.find(
        (e) => e.target === nodeId && e.targetHandle === targetHandle,
      );
      if (!edge) return undefined;
      const node = s.nodeLookup.get(edge.source);
      if (!node?.data) return undefined;
      return extract(node.data);
    },
    [nodeId, targetHandle, extract],
  );
  return useStore(selector, shallowEqual);
}
