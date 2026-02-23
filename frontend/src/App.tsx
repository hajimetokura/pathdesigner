import { useCallback, useEffect, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type OnConnect,
  type Node,
  Background,
  Controls,
  MiniMap,
  Panel,
} from "@xyflow/react";
import { getLayoutedElements } from "./utils/layout";
import "@xyflow/react/dist/style.css";
import BrepImportNode from "./nodes/BrepImportNode";
import SheetNode from "./nodes/SheetNode";
import PlacementNode from "./nodes/PlacementNode";
import OperationNode from "./nodes/OperationNode";
import PostProcessorNode from "./nodes/PostProcessorNode";
import ToolpathGenNode from "./nodes/ToolpathGenNode";
import CncCodeNode from "./nodes/CncCodeNode";
import ToolpathPreviewNode from "./nodes/ToolpathPreviewNode";
import DamNode from "./nodes/DamNode";
import DebugNode from "./nodes/DebugNode";
import Sidebar from "./Sidebar";
import SidePanel, { type PanelTab } from "./components/SidePanel";

const initialNodes: Node[] = [
  { id: "1", type: "brepImport", position: { x: 100, y: 100 }, data: {} },
  { id: "2", type: "sheet", position: { x: 400, y: 100 }, data: {} },
  { id: "9", type: "placement", position: { x: 250, y: 300 }, data: {} },
  { id: "3", type: "operation", position: { x: 100, y: 500 }, data: {} },
  { id: "5", type: "postProcessor", position: { x: 400, y: 500 }, data: {} },
  { id: "6", type: "toolpathGen", position: { x: 250, y: 700 }, data: {} },
  { id: "8", type: "toolpathPreview", position: { x: 150, y: 900 }, data: {} },
  { id: "7", type: "cncCode", position: { x: 400, y: 900 }, data: {} },
];

const initialEdges = [
  { id: "e1-9", source: "1", sourceHandle: "1-out", target: "9", targetHandle: "9-brep" },
  { id: "e2-9", source: "2", sourceHandle: "2-out", target: "9", targetHandle: "9-sheet" },
  { id: "e9-3", source: "9", sourceHandle: "9-out", target: "3", targetHandle: "3-brep" },
  { id: "e3-6", source: "3", sourceHandle: "3-out", target: "6", targetHandle: "6-operations" },
  { id: "e5-6", source: "5", sourceHandle: "5-out", target: "6", targetHandle: "6-postprocessor" },
  { id: "e6-7", source: "6", sourceHandle: "6-output", target: "7", targetHandle: "7-in" },
  { id: "e6-8", source: "6", sourceHandle: "6-toolpath", target: "8", targetHandle: "8-in" },
];

const API_URL = "http://localhost:8000";

let nodeCounter = 100;

const nodeTypes = {
  brepImport: BrepImportNode,
  sheet: SheetNode,
  placement: PlacementNode,
  operation: OperationNode,
  postProcessor: PostProcessorNode,
  toolpathGen: ToolpathGenNode,
  cncCode: CncCodeNode,
  toolpathPreview: ToolpathPreviewNode,
  dam: DamNode,
  debug: DebugNode,
};

function Flow() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [backendStatus, setBackendStatus] = useState<string>("checking...");
  const [panelTabs, setPanelTabs] = useState<PanelTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition, fitView } = useReactFlow();
  const onLayout = useCallback(() => {
    setNodes((nds) => {
      const allMeasured = nds.every((n) => n.measured?.width && n.measured?.height);
      if (!allMeasured) return nds;
      return getLayoutedElements(nds, edges);
    });
    window.requestAnimationFrame(() => fitView({ padding: 0.1 }));
  }, [edges, setNodes, fitView]);

  const openTab = useCallback((tab: PanelTab) => {
    let isNew = false;
    setPanelTabs((prev) => {
      if (prev.some((t) => t.id === tab.id)) {
        // Update existing tab content only — don't change active tab
        return prev.map((t) => (t.id === tab.id ? tab : t));
      }
      isNew = true;
      return [...prev, tab];
    });
    // Only activate newly created tabs
    if (isNew) {
      setActiveTabId(tab.id);
    }
  }, []);

  // Update existing tab content only — does NOT create new tabs
  const updateTab = useCallback((tab: PanelTab) => {
    setPanelTabs((prev) => {
      if (!prev.some((t) => t.id === tab.id)) return prev;
      return prev.map((t) => (t.id === tab.id ? tab : t));
    });
  }, []);

  const closeTab = useCallback((tabId: string) => {
    setPanelTabs((prev) => {
      const next = prev.filter((t) => t.id !== tabId);
      setActiveTabId((prevActive) =>
        prevActive === tabId
          ? (next.length > 0 ? next[next.length - 1].id : null)
          : prevActive
      );
      return next;
    });
  }, []);

  const onConnect: OnConnect = useCallback(
    (params) => {
      setEdges((eds) => {
        const filtered = eds.filter(
          (e) =>
            !(e.target === params.target && e.targetHandle === params.targetHandle) &&
            !(e.source === params.source && e.sourceHandle === params.sourceHandle)
        );
        return addEdge(params, filtered);
      });
    },
    [setEdges]
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer.getData("application/reactflow");
      if (!type) return;

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      nodeCounter += 1;
      setNodes((nds) => [
        ...nds,
        {
          id: `${type}-${nodeCounter}`,
          type,
          position,
          data: { openTab, updateTab, closeTab },
        },
      ]);
    },
    [screenToFlowPosition, setNodes, openTab, updateTab, closeTab]
  );

  useEffect(() => {
    fetch(`${API_URL}/health`)
      .then((res) => res.json())
      .then((data) => setBackendStatus(`${data.status} (v${data.version})`))
      .catch(() => setBackendStatus("offline"));
  }, []);

  // Inject openTab/closeTab into all nodes
  useEffect(() => {
    setNodes((nds) =>
      nds.map((n) => ({
        ...n,
        data: { ...n.data, openTab, updateTab, closeTab },
      }))
    );
  }, [openTab, updateTab, closeTab, setNodes]);

  return (
    <div style={{ display: "flex", width: "100vw", height: "100vh" }}>
      <Sidebar />
      <div ref={wrapperRef} style={{ flex: 1, position: "relative" }}>
        <div style={statusStyle}>
          <strong>PathDesigner</strong> &mdash; Backend: {backendStatus}
        </div>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onDragOver={onDragOver}
          onDrop={onDrop}
          proOptions={{ hideAttribution: true }}
          fitView
        >
          <Background />
          <Controls />
          <MiniMap />
          <Panel position="top-right">
            <button onClick={onLayout} style={layoutBtnStyle}>
              Auto Layout
            </button>
          </Panel>
        </ReactFlow>
      </div>
      <SidePanel
        tabs={panelTabs}
        activeTabId={activeTabId}
        onSelectTab={setActiveTabId}
        onCloseTab={closeTab}
      />
    </div>
  );
}

export default function App() {
  return (
    <ReactFlowProvider>
      <Flow />
    </ReactFlowProvider>
  );
}

const statusStyle: React.CSSProperties = {
  position: "absolute",
  top: 10,
  left: 10,
  zIndex: 10,
  background: "white",
  padding: "8px 16px",
  borderRadius: 8,
  boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
  fontSize: 14,
};

const layoutBtnStyle: React.CSSProperties = {
  background: "white",
  border: "1px solid #ddd",
  borderRadius: 6,
  padding: "6px 12px",
  fontSize: 12,
  cursor: "pointer",
  boxShadow: "0 1px 4px rgba(0,0,0,0.1)",
};
