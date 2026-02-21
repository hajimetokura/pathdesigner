import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  addEdge,
  useNodesState,
  useEdgesState,
  type OnConnect,
  Background,
  Controls,
  MiniMap,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import BrepImportNode from "./nodes/BrepImportNode";

const initialNodes = [
  {
    id: "1",
    type: "brepImport",
    position: { x: 100, y: 100 },
    data: {},
  },
  {
    id: "2",
    type: "default",
    position: { x: 100, y: 350 },
    data: { label: "Contour Extract" },
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
  { id: "e1-2", source: "1", target: "2" },
  { id: "e3-2", source: "3", target: "2" },
  { id: "e2-4", source: "2", target: "4" },
  { id: "e4-6", source: "4", target: "6" },
  { id: "e5-6", source: "5", target: "6" },
  { id: "e6-7", source: "6", target: "7" },
];

const API_URL = "http://localhost:8000";

export default function App() {
  const nodeTypes = useMemo(() => ({ brepImport: BrepImportNode }), []);
  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [backendStatus, setBackendStatus] = useState<string>("checking...");

  const onConnect: OnConnect = useCallback(
    (params) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  useEffect(() => {
    fetch(`${API_URL}/health`)
      .then((res) => res.json())
      .then((data) => setBackendStatus(`${data.status} (v${data.version})`))
      .catch(() => setBackendStatus("offline"));
  }, []);

  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      <div
        style={{
          position: "absolute",
          top: 10,
          left: 10,
          zIndex: 10,
          background: "white",
          padding: "8px 16px",
          borderRadius: 8,
          boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
          fontSize: 14,
        }}
      >
        <strong>PathDesigner</strong> &mdash; Backend: {backendStatus}
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        fitView
      >
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
    </div>
  );
}
