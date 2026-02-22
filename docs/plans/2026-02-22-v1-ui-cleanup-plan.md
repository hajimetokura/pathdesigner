# V1 UI Cleanup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** UIの一貫性を改善し、タブ付きサイドパネル導入・ノードのコンパクト化・Stock/PostProcessor簡素化でV1を仕上げる。

**Architecture:** App.tsxレベルで統一パネルコンテナ（SidePanel）を管理し、各ノードからの`openTab`コールバックでタブを追加・切替。各ノードは既存のcreatePortalを削除し、代わりにApp経由でパネルコンテンツを表示。

**Tech Stack:** React, TypeScript, React Flow (@xyflow/react)

---

### Task 1: SidePanelコンポーネント作成

**Files:**
- Create: `frontend/src/components/SidePanel.tsx`

**Step 1: SidePanel.tsxを作成**

タブバー + アクティブパネル表示のコンテナコンポーネント。

```tsx
import { type ReactNode } from "react";

export interface PanelTab {
  id: string;
  label: string;
  icon: string;       // 1文字 emoji/記号
  content: ReactNode;
}

interface SidePanelProps {
  tabs: PanelTab[];
  activeTabId: string | null;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
}

export default function SidePanel({ tabs, activeTabId, onSelectTab, onCloseTab }: SidePanelProps) {
  if (tabs.length === 0) return null;

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];

  return (
    <div style={containerStyle}>
      {/* Tab bar */}
      <div style={tabBarStyle}>
        {tabs.map((tab) => (
          <div
            key={tab.id}
            style={{
              ...tabStyle,
              ...(tab.id === activeTab.id ? activeTabStyle : {}),
            }}
            onClick={() => onSelectTab(tab.id)}
          >
            <span style={{ marginRight: 4 }}>{tab.icon}</span>
            <span style={{ flex: 1 }}>{tab.label}</span>
            <span
              style={closeTabStyle}
              onClick={(e) => {
                e.stopPropagation();
                onCloseTab(tab.id);
              }}
            >
              ×
            </span>
          </div>
        ))}
      </div>
      {/* Panel content */}
      <div style={panelBodyStyle}>{activeTab.content}</div>
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  width: 480,
  height: "100vh",
  borderLeft: "1px solid #e0e0e0",
  background: "white",
  display: "flex",
  flexDirection: "column",
  flexShrink: 0,
};

const tabBarStyle: React.CSSProperties = {
  display: "flex",
  borderBottom: "1px solid #e0e0e0",
  background: "#fafafa",
  overflowX: "auto",
  flexShrink: 0,
};

const tabStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  padding: "8px 12px",
  fontSize: 12,
  fontWeight: 500,
  cursor: "pointer",
  borderRight: "1px solid #e0e0e0",
  whiteSpace: "nowrap",
  color: "#666",
  userSelect: "none",
};

const activeTabStyle: React.CSSProperties = {
  background: "white",
  color: "#333",
  fontWeight: 600,
  borderBottom: "2px solid #4a90d9",
};

const closeTabStyle: React.CSSProperties = {
  marginLeft: 6,
  fontSize: 14,
  color: "#999",
  cursor: "pointer",
  lineHeight: 1,
};

const panelBodyStyle: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
};
```

**Step 2: ビルド確認**

Run: `cd frontend && npm run build`
Expected: 成功（未使用だが型エラーなし）

**Step 3: コミット**

```bash
git add frontend/src/components/SidePanel.tsx
git commit -m "Add SidePanel tabbed container component"
```

---

### Task 2: App.tsxにタブ状態管理とSidePanelを統合

**Files:**
- Modify: `frontend/src/App.tsx`

**Step 1: タブ状態管理を追加**

App.tsx の Flow コンポーネント内に以下を追加:

```tsx
import SidePanel, { type PanelTab } from "./components/SidePanel";

// Flow() 内:
const [panelTabs, setPanelTabs] = useState<PanelTab[]>([]);
const [activeTabId, setActiveTabId] = useState<string | null>(null);

const openTab = useCallback((tab: PanelTab) => {
  setPanelTabs((prev) => {
    const exists = prev.find((t) => t.id === tab.id);
    if (exists) {
      // contentを更新
      return prev.map((t) => (t.id === tab.id ? tab : t));
    }
    return [...prev, tab];
  });
  setActiveTabId(tab.id);
}, []);

const closeTab = useCallback((tabId: string) => {
  setPanelTabs((prev) => {
    const next = prev.filter((t) => t.id !== tabId);
    // アクティブタブが閉じられたら隣に切替
    if (activeTabId === tabId) {
      setActiveTabId(next.length > 0 ? next[next.length - 1].id : null);
    }
    return next;
  });
}, [activeTabId]);
```

**Step 2: レイアウト変更**

Flow()のreturn内を変更:

```tsx
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
    <SidePanel
      tabs={panelTabs}
      activeTabId={activeTabId}
      onSelectTab={setActiveTabId}
      onCloseTab={closeTab}
    />
  </div>
);
```

**Step 3: openTabをノードに渡す仕組み**

React Flowのノードは `data` prop経由でコールバックを受け取る。
initialNodesと新規ノード生成時にopenTab/closeTabを注入:

```tsx
// ノードにopenTab/closeTabを注入するeffect
useEffect(() => {
  setNodes((nds) =>
    nds.map((n) => ({
      ...n,
      data: { ...n.data, openTab, closeTab },
    }))
  );
}, [openTab, closeTab, setNodes]);
```

**Step 4: `make dev`で動作確認**

Run: `make dev`
Expected: UIが今まで通り表示。SidePanelはタブがないので非表示。

**Step 5: コミット**

```bash
git add frontend/src/App.tsx
git commit -m "Integrate SidePanel with tab state management into App layout"
```

---

### Task 3: BrepImportNodeをタブパネルに移行

**Files:**
- Modify: `frontend/src/nodes/BrepImportNode.tsx`
- Modify: `frontend/src/components/BrepImportPanel.tsx`

**Step 1: BrepImportPanel.tsxからポータルスタイルを除去**

BrepImportPanel.tsx の固定位置スタイル（position:fixed等）を削除し、
SidePanelのコンテナ内でレンダリングされる前提のレイアウトに変更。
`onClose` propを削除（タブの×で閉じるため）。

ヘッダー（タイトル + ×ボタン）を削除し、コンテンツのみにする。

**Step 2: BrepImportNode.tsxの変更**

- `createPortal` のインポートと使用を削除
- `showPanel` stateを削除
- "View 3D" ボタンのonClickを `data.openTab` 呼び出しに変更:

```tsx
const handleView3D = useCallback(() => {
  if (!result || !data.openTab) return;
  data.openTab({
    id: `brep-3d-${id}`,
    label: "3D View",
    icon: "📦",
    content: <BrepImportPanel brepResult={result} meshes={meshes} />,
  });
}, [id, result, meshes, data]);
```

- resultやmeshesが変わったときにタブのcontentも更新するeffectを追加:

```tsx
useEffect(() => {
  if (result && meshes.length > 0 && data.openTab) {
    // 既存タブがあれば内容を更新
    data.openTab({
      id: `brep-3d-${id}`,
      label: "3D View",
      icon: "📦",
      content: <BrepImportPanel brepResult={result} meshes={meshes} />,
    });
  }
}, [id, result, meshes, data]);
```

上記のeffectは`data.openTab`が存在するときだけ実行。初回は"View 3D"ボタンで開く。

**Step 3: `make dev`で動作確認**

- STEPファイルをドロップ
- "View 3D"クリック → 右側タブパネルに3Dビューが表示
- 他のパネルも開くと複数タブが並ぶ

**Step 4: コミット**

```bash
git add frontend/src/nodes/BrepImportNode.tsx frontend/src/components/BrepImportPanel.tsx
git commit -m "Migrate BrepImportNode from portal to tabbed side panel"
```

---

### Task 4: PlacementNodeをタブパネルに移行

**Files:**
- Modify: `frontend/src/nodes/PlacementNode.tsx`
- Modify: `frontend/src/components/PlacementPanel.tsx`

**Step 1: PlacementPanel.tsxからポータルスタイルを除去**

BrepImportPanelと同様、固定位置スタイルとヘッダー（タイトル+×）を削除。
コンテンツのみにする。`onClose` propを削除。

**Step 2: PlacementNode.tsxの変更**

- `createPortal` の削除
- `showPanel` stateの削除
- サムネイルクリック時に `data.openTab` を呼ぶ:

```tsx
const handleOpenPanel = useCallback(() => {
  if (!hasData || !data.openTab) return;
  data.openTab({
    id: `placement-${id}`,
    label: "Placement",
    icon: "📐",
    content: (
      <PlacementPanel
        objects={brepResult.objects}
        stockSettings={stockSettings}
        placements={placements}
        onPlacementsChange={handlePlacementsChange}
        warnings={warnings}
      />
    ),
  });
}, [id, hasData, brepResult, stockSettings, placements, warnings, handlePlacementsChange, data]);
```

- placementsが変わったときにタブ内容を更新するeffect追加

**Step 3: `make dev`で動作確認**

**Step 4: コミット**

```bash
git add frontend/src/nodes/PlacementNode.tsx frontend/src/components/PlacementPanel.tsx
git commit -m "Migrate PlacementNode from portal to tabbed side panel"
```

---

### Task 5: OperationNodeをタブパネルに移行

**Files:**
- Modify: `frontend/src/nodes/OperationNode.tsx`
- Modify: `frontend/src/components/OperationDetailPanel.tsx`

**Step 1: OperationDetailPanel.tsxからポータルスタイルを除去**

同様にヘッダーと固定位置スタイルを削除。`onClose` prop削除。

**Step 2: OperationNode.tsxの変更**

- `createPortal` 削除
- `showPanel` state削除
- "Edit Settings" ボタンで `data.openTab`:

```tsx
const handleEditSettings = useCallback(() => {
  if (!detected || !data.openTab) return;
  data.openTab({
    id: `operations-${id}`,
    label: "Operations",
    icon: "⚙",
    content: (
      <OperationDetailPanel
        detectedOperations={detected}
        assignments={assignments}
        stockSettings={stockSettings}
        onAssignmentsChange={handleAssignmentsChange}
      />
    ),
  });
}, [id, detected, assignments, stockSettings, handleAssignmentsChange, data]);
```

- assignments変更時にタブ内容を更新

**Step 3: `make dev`で動作確認**

**Step 4: コミット**

```bash
git add frontend/src/nodes/OperationNode.tsx frontend/src/components/OperationDetailPanel.tsx
git commit -m "Migrate OperationNode from portal to tabbed side panel"
```

---

### Task 6: ToolpathPreviewNodeをタブパネルに移行

**Files:**
- Modify: `frontend/src/nodes/ToolpathPreviewNode.tsx`
- Modify: `frontend/src/components/ToolpathPreviewPanel.tsx`

**Step 1: ToolpathPreviewPanel.tsxからポータルスタイルを除去**

**Step 2: ToolpathPreviewNode.tsxの変更**

- `createPortal` 削除、`showPanel` 削除
- サムネイルクリックで `data.openTab`:

```tsx
const handleEnlarge = useCallback(() => {
  if (!toolpathResult || !data.openTab) return;
  data.openTab({
    id: `preview-${id}`,
    label: "Preview",
    icon: "👁",
    content: <ToolpathPreviewPanel toolpathResult={toolpathResult} />,
  });
}, [id, toolpathResult, data]);
```

**Step 3: `make dev`で動作確認**

**Step 4: コミット**

```bash
git add frontend/src/nodes/ToolpathPreviewNode.tsx frontend/src/components/ToolpathPreviewPanel.tsx
git commit -m "Migrate ToolpathPreviewNode from portal to tabbed side panel"
```

---

### Task 7: CncCodeNodeをタブパネルに移行

**Files:**
- Modify: `frontend/src/nodes/CncCodeNode.tsx`
- Modify: `frontend/src/components/CncCodePanel.tsx`

**Step 1: CncCodePanel.tsxからポータルスタイルを除去**

**Step 2: CncCodeNode.tsxの変更**

- `showPanel` 削除
- "View Code" ボタンで `data.openTab`:

```tsx
const handleViewCode = useCallback(() => {
  if (!outputResult || !data.openTab) return;
  data.openTab({
    id: `cnc-code-${id}`,
    label: "CNC Code",
    icon: "📄",
    content: <CncCodePanel outputResult={outputResult} onExport={handleExport} />,
  });
}, [id, outputResult, handleExport, data]);
```

**Step 3: `make dev`で動作確認**

**Step 4: コミット**

```bash
git add frontend/src/nodes/CncCodeNode.tsx frontend/src/components/CncCodePanel.tsx
git commit -m "Migrate CncCodeNode from portal to tabbed side panel"
```

---

### Task 8: PostProcessorNodeのコンパクト化 + パネル作成

**Files:**
- Modify: `frontend/src/nodes/PostProcessorNode.tsx`
- Create: `frontend/src/components/PostProcessorPanel.tsx`

**Step 1: PostProcessorPanel.tsxを作成**

Safe Z、Tool#、Home X/Y、Warmupの編集UIを含むパネルコンポーネント:

```tsx
import type { PostProcessorSettings } from "../types";

interface Props {
  settings: PostProcessorSettings;
  onSettingsChange: (settings: PostProcessorSettings) => void;
}

export default function PostProcessorPanel({ settings, onSettingsChange }: Props) {
  // NumberFieldヘルパー（既存PostProcessorNodeから移動）
  // Safe Z, Tool#, Home X, Home Y, Warmup の各フィールド
  // ...
}
```

**Step 2: PostProcessorNode.tsxを書き換え**

- 展開/折りたたみ (`open`, `SectionHeader`) を削除
- NumberFieldの詳細フィールド（Safe Z〜Warmup）を削除
- マシンタイプのドロップダウン + Bed + Format のサマリーのみ表示
- "Details" ボタン or ノードクリックで `data.openTab`:

```tsx
export default function PostProcessorNode({ id, data }: NodeProps) {
  const { setNodes } = useReactFlow();
  const [settings, setSettings] = useState<PostProcessorSettings>(DEFAULT_SETTINGS);

  // Sync to node data (既存)
  useEffect(() => { ... }, [id, settings, setNodes]);

  const handleOpenPanel = useCallback(() => {
    if (!data.openTab) return;
    data.openTab({
      id: `postproc-${id}`,
      label: "Post Proc",
      icon: "🔧",
      content: (
        <PostProcessorPanel
          settings={settings}
          onSettingsChange={setSettings}
        />
      ),
    });
  }, [id, settings, data]);

  return (
    <div style={nodeStyle}>
      <div style={headerStyle}>
        <span>Post Processor</span>
        <button style={detailBtn} onClick={handleOpenPanel}>Details</button>
      </div>
      {/* マシン選択ドロップダウン（V1ではShopBotのみ → 表示のみ） */}
      <div style={fieldRow}>
        <span style={labelStyle}>Machine</span>
        <span style={valueStyle}>ShopBot</span>
      </div>
      <div style={fieldRow}>
        <span style={labelStyle}>Bed</span>
        <span style={valueStyle}>{settings.bed_size[0]}×{settings.bed_size[1]}mm</span>
      </div>
      <div style={fieldRow}>
        <span style={labelStyle}>Format</span>
        <span style={valueStyle}>{settings.output_format.toUpperCase()}</span>
      </div>
      <LabeledHandle ... />
    </div>
  );
}
```

**Step 3: `make dev`で動作確認**

- PostProcessorノードがコンパクトに表示
- "Details"ボタンでタブパネルにSafe Z等が表示
- 値変更がノードデータに反映

**Step 4: コミット**

```bash
git add frontend/src/nodes/PostProcessorNode.tsx frontend/src/components/PostProcessorPanel.tsx
git commit -m "Compact PostProcessorNode with detail panel for advanced settings"
```

---

### Task 9: StockNodeの簡素化

**Files:**
- Modify: `frontend/src/nodes/StockNode.tsx`

**Step 1: StockNodeを書き換え**

- 複数マテリアル関連コードを削除:
  - `nextMaterialId`, `createMaterial()`
  - `addMaterial()`, `removeMaterial()`, `toggleMaterial()`
  - `openMaterials` state
  - `materials.map(...)` ループ
  - "Add Material" ボタン、remove ボタン
  - 折りたたみヘッダー
- 単一ストックとして直接管理:

```tsx
const DEFAULT_SETTINGS: StockSettings = {
  materials: [{
    material_id: "stock_1",
    label: "Stock",
    width: 1820,
    depth: 910,
    thickness: 24,
    x_position: 0,
    y_position: 0,
  }],
};

export default function StockNode({ id }: NodeProps) {
  const { setNodes } = useReactFlow();
  const [mat, setMat] = useState(DEFAULT_SETTINGS.materials[0]);

  // StockSettingsとして下流に同期
  useEffect(() => {
    const settings: StockSettings = { materials: [mat] };
    setNodes((nds) =>
      nds.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, stockSettings: settings } } : n
      )
    );
  }, [id, mat, setNodes]);

  const update = useCallback(
    (field: string, value: string | number) => {
      setMat((prev) => ({ ...prev, [field]: value }));
    }, []
  );

  return (
    <div style={nodeStyle}>
      <div style={headerStyle}>Stock</div>
      <TextField label="Label" value={mat.label} onChange={(v) => update("label", v)} />
      <NumberField label="W" value={mat.width} onChange={(v) => update("width", v)} />
      <NumberField label="D" value={mat.depth} onChange={(v) => update("depth", v)} />
      <NumberField label="T" value={mat.thickness} onChange={(v) => update("thickness", v)} />
      <LabeledHandle ... />
    </div>
  );
}
```

- W/D は横並び（`display: flex` で1行に）にして省スペース化

**Step 2: `make dev`で動作確認**

- Stockノードがコンパクトに表示
- デフォルト値が1820x910x24
- 下流（Placement, Operation）に正しく伝播

**Step 3: コミット**

```bash
git add frontend/src/nodes/StockNode.tsx
git commit -m "Simplify StockNode to single material with 3x6 defaults (1820x910x24)"
```

---

### Task 10: ノードサイズの統一 + 最終調整

**Files:**
- Modify: 各ノードファイルの `nodeStyle`

**Step 1: 全ノードのnodeStyleを統一**

全ノード（Debug除く）で以下のスタイルに統一:

```tsx
const nodeStyle: React.CSSProperties = {
  background: "white",
  border: "1px solid #ddd",
  borderRadius: 8,
  padding: "12px",
  width: 200,
  boxShadow: "0 2px 6px rgba(0,0,0,0.08)",
};
```

- `minWidth`/`maxWidth` → 固定 `width: 200`
- padding を `20px 12px` → `12px` に統一

**Step 2: `make dev`で全体確認**

全ノード + 全タブパネルの動作を一通り確認:
- STEPアップロード → 3Dビュータブ
- Stock設定 → Placement配置
- Operation検出 → 工具設定タブ
- Toolpath生成 → プレビュータブ + コードタブ
- 複数タブの切替・閉じる動作

**Step 3: コミット**

```bash
git add frontend/src/nodes/
git commit -m "Unify node sizes to fixed 200px width for visual consistency"
```

---

## 実装順序の理由

1. **Task 1-2:** まずインフラ（SidePanel + App統合）を作る → 他タスクの前提
2. **Task 3-7:** 各ノードを順次移行 → 1ノードずつ確認しながら進められる
3. **Task 8:** PostProcessorは分割（ノード書き換え + 新Panel作成）が必要なので独立タスク
4. **Task 9:** Stockは他への影響少なく独立
5. **Task 10:** 最後にサイズ統一で仕上げ

## 注意事項

- パネル内のコールバック（onPlacementsChange等）が正しく動くか各タスクで確認
- openTabのcontentにReactNodeを渡す設計のため、stateが変わったときにcontentの再レンダリングが必要 → openTab呼び直しで対応
- `StockSettings.materials` の型は配列のまま維持（バックエンドとの互換性）
