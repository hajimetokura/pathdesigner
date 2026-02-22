import { useCallback, useEffect, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type OnConnect,
  Background,
  Controls,
  MiniMap,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import BrepImportNode from "./nodes/BrepImportNode";
import StockNode from "./nodes/StockNode";
import OperationNode from "./nodes/OperationNode";
import PostProcessorNode from "./nodes/PostProcessorNode";
import ToolpathGenNode from "./nodes/ToolpathGenNode";
import CncCodeNode from "./nodes/CncCodeNode";
import ToolpathPreviewNode from "./nodes/ToolpathPreviewNode";
import DebugNode from "./nodes/DebugNode";
import Sidebar from "./Sidebar";

const initialNodes = [
  { id: "1", type: "brepImport", position: { x: 100, y: 100 }, data: {} },
  { id: "2", type: "stock", position: { x: 400, y: 100 }, data: {} },
  { id: "3", type: "operation", position: { x: 100, y: 350 }, data: {} },
  { id: "5", type: "postProcessor", position: { x: 400, y: 350 }, data: {} },
  { id: "6", type: "toolpathGen", position: { x: 250, y: 600 }, data: {} },
  { id: "7", type: "cncCode", position: { x: 150, y: 800 }, data: {} },
  { id: "8", type: "toolpathPreview", position: { x: 400, y: 800 }, data: {} },
];

const initialEdges = [
  { id: "e1-3", source: "1", sourceHandle: "1-out", target: "3", targetHandle: "3-brep" },
  { id: "e2-3", source: "2", sourceHandle: "2-out", target: "3", targetHandle: "3-stock" },
  { id: "e3-6", source: "3", sourceHandle: "3-out", target: "6", targetHandle: "6-operations" },
  { id: "e5-6", source: "5", sourceHandle: "5-out", target: "6", targetHandle: "6-postprocessor" },
  { id: "e6-7", source: "6", sourceHandle: "6-output", target: "7", targetHandle: "7-in" },
  { id: "e6-8", source: "6", sourceHandle: "6-toolpath", target: "8", targetHandle: "8-in" },
];

const API_URL = "http://localhost:8000";

let nodeCounter = 100;

const nodeTypes = {
  brepImport: BrepImportNode,
  stock: StockNode,
  operation: OperationNode,
  postProcessor: PostProcessorNode,
  toolpathGen: ToolpathGenNode,
  cncCode: CncCodeNode,
  toolpathPreview: ToolpathPreviewNode,
  debug: DebugNode,
};

function Flow() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [backendStatus, setBackendStatus] = useState<string>("checking...");
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition } = useReactFlow();

  const onConnect: OnConnect = useCallback(
    (params) => setEdges((eds) => addEdge(params, eds)),
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
          data: {},
        },
      ]);
    },
    [screenToFlowPosition, setNodes]
  );

  useEffect(() => {
    fetch(`${API_URL}/health`)
      .then((res) => res.json())
      .then((data) => setBackendStatus(`${data.status} (v${data.version})`))
      .catch(() => setBackendStatus("offline"));
  }, []);

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
        </ReactFlow>
      </div>
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
