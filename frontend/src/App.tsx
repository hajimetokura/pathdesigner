import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  Panel,
} from "@xyflow/react";
import { getLayoutedElements } from "./utils/layout";
import "@xyflow/react/dist/style.css";
import { nodeTypes } from "./nodeRegistry";
import Sidebar from "./Sidebar";
import SidePanel, { type PanelTab } from "./components/SidePanel";
import { PanelTabsContext } from "./contexts/PanelTabsContext";
import { API_BASE_URL } from "./config";
import { ThemeProvider, useTheme } from "./contexts/ThemeContext";
import { LayoutDirectionProvider, useLayoutDirection } from "./contexts/LayoutDirectionContext";

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

let nodeCounter = 100;


function Flow() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [backendStatus, setBackendStatus] = useState<string>("checking...");
  const [panelTabs, setPanelTabs] = useState<PanelTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  /** LRモード: 表示中パネルID一覧 (最大3) */
  const [visibleTabIds, setVisibleTabIds] = useState<string[]>([]);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition, fitView } = useReactFlow();
  const { theme, setTheme } = useTheme();
  const { direction, setDirection } = useLayoutDirection();
  const toggleTheme = useCallback(() => {
    setTheme(theme === "clean" ? "terracotta" : "clean");
  }, [theme, setTheme]);

  const onLayout = useCallback((dir?: "TB" | "LR") => {
    const d = dir ?? direction;
    setNodes((nds) => {
      const allMeasured = nds.every((n) => n.measured?.width && n.measured?.height);
      if (!allMeasured) return nds;
      return getLayoutedElements(nds, edges, { direction: d });
    });
    window.requestAnimationFrame(() => fitView({ padding: 0.1 }));
  }, [edges, setNodes, fitView, direction]);

  const toggleDirection = useCallback(() => {
    const next = direction === "TB" ? "LR" : "TB";
    setDirection(next);
    onLayout(next);
  }, [direction, setDirection, onLayout]);

  const openTab = useCallback((tab: PanelTab) => {
    setPanelTabs((prev) => {
      if (prev.some((t) => t.id === tab.id)) {
        // Tab already exists — don't update content (prevents remount / state loss)
        return prev;
      }
      return [...prev, tab];
    });
    // Always activate the tab (new or existing)
    setActiveTabId(tab.id);
    // LRモード: visibleTabIds にも追加 (最大3)
    setVisibleTabIds((prev) => {
      if (prev.includes(tab.id)) return prev;
      if (prev.length >= 3) return [...prev.slice(1), tab.id]; // 古いものを押し出す
      return [...prev, tab.id];
    });
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
    setVisibleTabIds((prev) => prev.filter((id) => id !== tabId));
  }, []);

  const onToggleVisible = useCallback((tabId: string) => {
    setVisibleTabIds((prev) => {
      if (prev.includes(tabId)) {
        return prev.filter((id) => id !== tabId);
      }
      if (prev.length >= 3) return prev; // 上限
      return [...prev, tabId];
    });
  }, []);

  // ノードクリック時、そのノードに紐づくタブがあればアクティブ化
  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      setPanelTabs((tabs) => {
        const match = tabs.find((t) => t.id.endsWith(`-${node.id}`));
        if (match) setActiveTabId(match.id);
        return tabs;
      });
    },
    [],
  );

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
          data: {},
        },
      ]);
    },
    [screenToFlowPosition, setNodes]
  );

  // Run auto-layout once after all nodes have been measured.
  // We watch `nodes` to detect when `measured` properties arrive (via onNodesChange),
  // but use a functional updater in setNodes to avoid overwriting concurrent data updates.
  const initialLayoutDone = useRef(false);
  useEffect(() => {
    if (initialLayoutDone.current) return;
    const allMeasured = nodes.length > 0 && nodes.every((n) => n.measured?.width && n.measured?.height);
    if (!allMeasured) return;
    initialLayoutDone.current = true;
    // Use functional updater to get the freshest nodes (including any data updates)
    setNodes((nds) => getLayoutedElements(nds, edges, { direction }));
    window.requestAnimationFrame(() => fitView({ padding: 0.1 }));
  }, [nodes, edges, direction, setNodes, fitView]);

  useEffect(() => {
    fetch(`${API_BASE_URL}/health`)
      .then((res) => res.json())
      .then((data) => setBackendStatus(`${data.status} (v${data.version})`))
      .catch(() => setBackendStatus("offline"));
  }, []);

  const panelTabsValue = useMemo(() => ({ openTab, updateTab, closeTab }), [openTab, updateTab, closeTab]);

  return (
    <PanelTabsContext.Provider value={panelTabsValue}>
      <div style={{ display: "flex", flexDirection: direction === "LR" ? "column" : "row", width: "100vw", height: "100vh" }}>
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
            onNodeClick={onNodeClick}
            onDragOver={onDragOver}
            onDrop={onDrop}
            proOptions={{ hideAttribution: true }}
            style={{ background: "var(--canvas-bg)" }}
            fitView
          >
            <Background color="var(--border-color)" />
            <Panel position="top-right">
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={toggleTheme} style={layoutBtnStyle} title={`Theme: ${theme}`}>
                  {theme === "clean" ? "Clean" : "Terra"}
                </button>
                <button onClick={toggleDirection} style={layoutBtnStyle} title={`Direction: ${direction}`}>
                  {direction === "TB" ? "↓ TB" : "→ LR"}
                </button>
                <button onClick={() => onLayout()} style={layoutBtnStyle}>
                  Auto Layout
                </button>
              </div>
            </Panel>
          </ReactFlow>
        </div>
        <SidePanel
          tabs={panelTabs}
          activeTabId={activeTabId}
          onSelectTab={setActiveTabId}
          onCloseTab={closeTab}
          visibleTabIds={visibleTabIds}
          onToggleVisible={onToggleVisible}
        />
      </div>
    </PanelTabsContext.Provider>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <LayoutDirectionProvider>
        <ReactFlowProvider>
          <Flow />
        </ReactFlowProvider>
      </LayoutDirectionProvider>
    </ThemeProvider>
  );
}

const statusStyle: React.CSSProperties = {
  position: "absolute",
  top: 10,
  left: 10,
  zIndex: 10,
  background: "var(--node-bg)",
  padding: "8px 16px",
  borderRadius: "var(--radius-node)",
  boxShadow: "var(--shadow-button)",
  fontSize: 14,
  color: "var(--text-primary)",
};

const layoutBtnStyle: React.CSSProperties = {
  background: "var(--node-bg)",
  border: "1px solid var(--border-color)",
  borderRadius: "var(--radius-control)",
  padding: "6px 12px",
  fontSize: 12,
  cursor: "pointer",
  boxShadow: "var(--shadow-button)",
  color: "var(--text-primary)",
};
