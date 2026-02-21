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
import ContourExtractNode from "./nodes/ContourExtractNode";
import DebugNode from "./nodes/DebugNode";
import Sidebar from "./Sidebar";

const initialNodes = [
  {
    id: "1",
    type: "brepImport",
    position: { x: 100, y: 100 },
    data: {},
  },
  {
    id: "2",
    type: "contourExtract",
    position: { x: 100, y: 350 },
    data: {},
  },
  {
    id: "3",
    type: "default",
    position: { x: 350, y: 350 },
    data: { label: "Machining Settings" },
  },
  {
    id: "4",
    type: "default",
    position: { x: 250, y: 500 },
    data: { label: "Merge" },
  },
  {
    id: "5",
    type: "default",
    position: { x: 500, y: 500 },
    data: { label: "Post Processor" },
  },
  {
    id: "6",
    type: "default",
    position: { x: 350, y: 650 },
    data: { label: "Toolpath Gen" },
  },
  {
    id: "7",
    type: "default",
    position: { x: 350, y: 800 },
    data: { label: "Preview" },
  },
];

const initialEdges = [
  { id: "e1-2", source: "1", sourceHandle: "1-out", target: "2", targetHandle: "2-brep" },
  { id: "e3-2", source: "3", target: "2", targetHandle: "2-settings" },
  { id: "e2-4", source: "2", sourceHandle: "2-out", target: "4" },
  { id: "e4-6", source: "4", target: "6" },
  { id: "e5-6", source: "5", target: "6" },
  { id: "e6-7", source: "6", target: "7" },
];

const API_URL = "http://localhost:8000";

let nodeCounter = 100;

const nodeTypes = {
  brepImport: BrepImportNode,
  contourExtract: ContourExtractNode,
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
