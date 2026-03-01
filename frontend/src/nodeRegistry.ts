/**
 * Central registry for all React Flow custom nodes.
 * Single source of truth for node components, labels, and categories.
 */
import type { NodeCategory } from "./components/NodeShell";
import AiCadNode from "./nodes/AiCadNode";
import SnippetDbNode from "./nodes/SnippetDbNode";
import CodeNode from "./nodes/CodeNode";
import AlignNode from "./nodes/AlignNode";
import BrepImportNode from "./nodes/BrepImportNode";
import SheetNode from "./nodes/SheetNode";
import PlacementNode from "./nodes/PlacementNode";
import OperationNode from "./nodes/OperationNode";
import PostProcessorNode from "./nodes/PostProcessorNode";
import ToolpathGenNode from "./nodes/ToolpathGenNode";
import CncCodeNode from "./nodes/CncCodeNode";
import ToolpathPreviewNode from "./nodes/ToolpathPreviewNode";
import DamNode from "./nodes/DamNode";
import { PreviewNode } from "./nodes/PreviewNode";
import DebugNode from "./nodes/DebugNode";
import MergeNode from "./nodes/MergeNode";
import SketchNode from "./nodes/SketchNode";
import TextNode from "./nodes/TextNode";

interface NodeRegistryEntry {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component: React.ComponentType<any>;
  label: string;
  category: NodeCategory;
}

const NODE_REGISTRY: Record<string, NodeRegistryEntry> = {
  aiCad: { component: AiCadNode, label: "AI CAD", category: "cad" },
  snippetDb: { component: SnippetDbNode, label: "Code Library", category: "cad" },
  codeNode: { component: CodeNode, label: "Code", category: "cad" },
  preview: { component: PreviewNode, label: "3D Preview", category: "cad" },
  brepImport: { component: BrepImportNode, label: "BREP Import", category: "cad" },
  align: { component: AlignNode, label: "Align", category: "cam" },
  sheet: { component: SheetNode, label: "Sheet", category: "cam" },
  placement: { component: PlacementNode, label: "Placement", category: "cam" },
  operation: { component: OperationNode, label: "Operation", category: "cam" },
  postProcessor: { component: PostProcessorNode, label: "Post Processor", category: "cam" },
  toolpathGen: { component: ToolpathGenNode, label: "Toolpath Gen", category: "cam" },
  cncCode: { component: CncCodeNode, label: "CNC Code", category: "cam" },
  toolpathPreview: { component: ToolpathPreviewNode, label: "Toolpath Preview", category: "cam" },
  sketchNode: { component: SketchNode, label: "Sketch", category: "utility" },
  textNode: { component: TextNode, label: "Text", category: "utility" },
  merge: { component: MergeNode, label: "Merge", category: "utility" },
  dam: { component: DamNode, label: "Dam", category: "utility" },
  debug: { component: DebugNode, label: "Debug", category: "utility" },
};

/** nodeTypes object for React Flow */
export const nodeTypes = Object.fromEntries(
  Object.entries(NODE_REGISTRY).map(([key, entry]) => [key, entry.component]),
);

/** Grouped node list for the sidebar */
export function getSidebarGroups(): {
  category: NodeCategory;
  label: string;
  items: { type: string; label: string }[];
}[] {
  const grouped = new Map<NodeCategory, { type: string; label: string }[]>();
  for (const [type, entry] of Object.entries(NODE_REGISTRY)) {
    if (!grouped.has(entry.category)) grouped.set(entry.category, []);
    grouped.get(entry.category)!.push({ type, label: entry.label });
  }

  const categoryLabels: Record<NodeCategory, string> = {
    cad: "CAD",
    cam: "CAM",
    utility: "Utility",
  };
  const order: NodeCategory[] = ["cad", "cam", "utility"];

  return order
    .filter((cat) => grouped.has(cat))
    .map((cat) => ({
      category: cat,
      label: categoryLabels[cat],
      items: grouped.get(cat)!,
    }));
}
