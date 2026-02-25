# Code Library Node Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** `SnippetDbNode` の構成を他ノード（AiCadNode / PlacementNode）と統一し、重いUIをPanelTabに移動する。

**Architecture:** ノード本体はコンパクトなサマリー（選択中スニペット名・Open Libraryボタン・実行ボタン）のみに縮小し、保存フォーム＋ライブラリブラウザは新規コンポーネント `SnippetLibraryPanel` に切り出してPanelTabで表示する。状態は `SnippetDbNode` で `selectedSnippetId` を保持し、パネルへ props として渡す。

**Tech Stack:** React, TypeScript, @xyflow/react, usePanelTabs context

---

### Task 1: SnippetLibraryPanel コンポーネントを作成する

**Files:**
- Create: `frontend/src/components/SnippetLibraryPanel.tsx`

SnippetDbNode から保存フォーム・ライブラリグリッド・実行ロジックを切り出す。

**Step 1: ファイルを作成する**

`frontend/src/components/SnippetLibraryPanel.tsx` を以下の内容で作成:

```tsx
import { useEffect, useState } from "react";
import { saveSnippet, listSnippets, deleteSnippet, executeSnippet } from "../api";
import type { AiCadResult, SnippetInfo } from "../types";

async function renderThumbnail(meshUrl: string): Promise<string | null> {
  try {
    const { WebGLRenderer, Scene, PerspectiveCamera, AmbientLight, DirectionalLight, Box3, Vector3 } =
      await import("three");
    const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");

    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;

    const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setSize(128, 128);

    const scene = new Scene();
    scene.add(new AmbientLight(0xffffff, 0.8));
    const dir = new DirectionalLight(0xffffff, 0.6);
    dir.position.set(1, 2, 3);
    scene.add(dir);

    const camera = new PerspectiveCamera(45, 1, 0.01, 1000);

    const loader = new GLTFLoader();
    const gltf = await new Promise<{ scene: object }>((res, rej) =>
      loader.load(meshUrl, res as (g: unknown) => void, undefined, rej),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    scene.add(gltf.scene as any);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const box = new Box3().setFromObject(gltf.scene as any);
    const center = new Vector3();
    box.getCenter(center);
    const size = box.getSize(new Vector3()).length();
    camera.position.copy(center).addScalar(size);
    camera.lookAt(center);

    renderer.render(scene, camera);
    const dataUrl = canvas.toDataURL("image/png");
    renderer.dispose();
    return dataUrl;
  } catch {
    return null;
  }
}

interface SnippetLibraryPanelProps {
  upstream: AiCadResult | undefined;
  selectedId: string | null;
  onSelect: (id: string, name: string) => void;
  onExecute: (result: AiCadResult) => void;
}

export default function SnippetLibraryPanel({
  upstream,
  selectedId,
  onSelect,
  onExecute,
}: SnippetLibraryPanelProps) {
  // 保存フォーム
  const [name, setName] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  // ライブラリ
  const [snippets, setSnippets] = useState<SnippetInfo[]>([]);
  const [searchQ, setSearchQ] = useState("");
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listSnippets(searchQ || undefined)
      .then((r) => setSnippets(r.snippets))
      .catch(() => setSnippets([]));
  }, [searchQ]);

  const handleSave = async () => {
    if (!upstream || !name.trim()) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      let thumbnail: string | undefined;
      if (upstream.file_id) {
        const meshUrl = `/files/${upstream.file_id}/mesh.glb`;
        thumbnail = (await renderThumbnail(meshUrl)) ?? undefined;
      }
      await saveSnippet({
        name: name.trim(),
        tags: tagsInput.split(",").map((t) => t.trim()).filter(Boolean),
        code: upstream.generated_code,
        thumbnail_png: thumbnail,
        source_generation_id: upstream.generation_id,
      });
      setSaveMsg("保存しました");
      setName("");
      setTagsInput("");
      const refreshed = await listSnippets(searchQ || undefined);
      setSnippets(refreshed.snippets);
    } catch (e) {
      setSaveMsg(`エラー: ${String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleExecute = async () => {
    if (!selectedId) return;
    setExecuting(true);
    setError(null);
    try {
      const result = await executeSnippet(selectedId);
      onExecute(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setExecuting(false);
    }
  };

  const handleDelete = async (sid: string) => {
    await deleteSnippet(sid).catch(() => {});
    if (selectedId === sid) onSelect("", "");
    const refreshed = await listSnippets(searchQ || undefined);
    setSnippets(refreshed.snippets);
  };

  return (
    <div style={containerStyle}>
      {/* 保存エリア */}
      <div style={{ ...sectionStyle, opacity: upstream ? 1 : 0.4 }}>
        <div style={sectionTitleStyle}>
          保存 {upstream ? `— ${upstream.object_count} objects` : "（input 未接続）"}
        </div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="名前（必須）"
          disabled={!upstream}
          style={inputStyle}
        />
        <input
          value={tagsInput}
          onChange={(e) => setTagsInput(e.target.value)}
          placeholder="タグ（カンマ区切り）"
          disabled={!upstream}
          style={inputStyle}
        />
        <button
          onClick={() => void handleSave()}
          disabled={!upstream || !name.trim() || saving}
          style={primaryBtnStyle}
        >
          {saving ? "保存中..." : "保存"}
        </button>
        {saveMsg && (
          <div style={{ marginTop: 4, fontSize: 11, color: saveMsg.startsWith("エラー") ? "#d32f2f" : "#2e7d32" }}>
            {saveMsg}
          </div>
        )}
      </div>

      {/* ライブラリエリア */}
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>ライブラリ</div>
        <input
          value={searchQ}
          onChange={(e) => setSearchQ(e.target.value)}
          placeholder="🔍 検索..."
          style={inputStyle}
        />
        <div style={gridStyle}>
          {snippets.length === 0 && (
            <div style={{ gridColumn: "1/-1", color: "#999", textAlign: "center", fontSize: 11, padding: 8 }}>
              スニペットなし
            </div>
          )}
          {snippets.map((s) => (
            <div
              key={s.id}
              onClick={() => onSelect(s.id, s.name)}
              style={{
                ...gridItemStyle,
                border: `1px solid ${selectedId === s.id ? "#4a90d9" : "#ddd"}`,
                background: selectedId === s.id ? "#e8f4fd" : "#fafafa",
              }}
            >
              {s.thumbnail_png ? (
                <img
                  src={s.thumbnail_png}
                  alt={s.name}
                  style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 2 }}
                />
              ) : (
                <div style={placeholderStyle}>📦</div>
              )}
              <div style={itemNameStyle}>{s.name}</div>
              <button
                onClick={(e) => { e.stopPropagation(); void handleDelete(s.id); }}
                style={deleteBtnStyle}
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <button
          onClick={() => void handleExecute()}
          disabled={!selectedId || executing}
          style={{
            ...primaryBtnStyle,
            marginTop: 8,
            opacity: !selectedId || executing ? 0.5 : 1,
          }}
        >
          {executing ? "実行中..." : "選択して実行"}
        </button>
        {error && <div style={{ color: "#d32f2f", fontSize: 11, marginTop: 4 }}>{error}</div>}
      </div>
    </div>
  );
}

const containerStyle: React.CSSProperties = { padding: 16, display: "flex", flexDirection: "column", gap: 16 };
const sectionStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4 };
const sectionTitleStyle: React.CSSProperties = { fontWeight: 600, fontSize: 12, marginBottom: 4, color: "#333" };
const inputStyle: React.CSSProperties = { width: "100%", padding: "6px 8px", border: "1px solid #ddd", borderRadius: 6, fontSize: 12, boxSizing: "border-box" };
const primaryBtnStyle: React.CSSProperties = { width: "100%", padding: "8px 12px", border: "none", borderRadius: 6, background: "#e65100", color: "white", cursor: "pointer", fontSize: 12, fontWeight: 600 };
const gridStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 4 };
const gridItemStyle: React.CSSProperties = { borderRadius: 4, padding: 4, cursor: "pointer", position: "relative" };
const placeholderStyle: React.CSSProperties = { width: "100%", aspectRatio: "1", background: "#f0f0f0", borderRadius: 2, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 };
const itemNameStyle: React.CSSProperties = { fontSize: 10, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#333" };
const deleteBtnStyle: React.CSSProperties = { position: "absolute", top: 2, right: 2, fontSize: 9, padding: "0 3px", background: "#ddd", border: "none", borderRadius: 2, cursor: "pointer", color: "#333" };
```

**Step 2: ビルドエラーがないか確認する**

```bash
cd /Users/hajimetokura/OKRA_local/apps/pathdesigner/frontend
npm run build 2>&1 | tail -20
```

Expected: エラーなし（またはSnippetDbNode側の未使用import警告のみ）

**Step 3: Commit**

```bash
git add frontend/src/components/SnippetLibraryPanel.tsx
git commit -m "feat: add SnippetLibraryPanel component for Code Library Node PanelTab"
```

---

### Task 2: SnippetDbNode をリファクタリングする

**Files:**
- Modify: `frontend/src/nodes/SnippetDbNode.tsx`

ノード本体を AiCadNode パターンに揃える。

**Step 1: SnippetDbNode.tsx を以下の内容で全置換する**

```tsx
import { useCallback, useState } from "react";
import { Position, type NodeProps, useReactFlow } from "@xyflow/react";
import LabeledHandle from "./LabeledHandle";
import NodeShell from "../components/NodeShell";
import SnippetLibraryPanel from "../components/SnippetLibraryPanel";
import type { AiCadResult } from "../types";
import { useUpstreamData } from "../hooks/useUpstreamData";
import { usePanelTabs } from "../contexts/PanelTabsContext";

export default function SnippetDbNode({ id, selected }: NodeProps) {
  const { openTab } = usePanelTabs();
  const { setNodes } = useReactFlow();

  const extractUpstream = useCallback(
    (d: Record<string, unknown>) => (d.result as AiCadResult | undefined) ?? undefined,
    [],
  );
  const upstream = useUpstreamData(id, `${id}-input`, extractUpstream);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSelect = useCallback((sid: string, sname: string) => {
    setSelectedId(sid || null);
    setSelectedName(sname || null);
  }, []);

  const handleExecute = useCallback(
    (result: AiCadResult) => {
      setError(null);
      setNodes((nodes) =>
        nodes.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, outputResult: result } } : n,
        ),
      );
    },
    [id, setNodes],
  );

  const handleOpenLibrary = useCallback(() => {
    openTab({
      id: `snippet-lib-${id}`,
      label: "Code Library",
      icon: "📚",
      content: (
        <SnippetLibraryPanel
          upstream={upstream}
          selectedId={selectedId}
          onSelect={handleSelect}
          onExecute={handleExecute}
        />
      ),
    });
  }, [id, upstream, selectedId, openTab, handleSelect, handleExecute]);

  return (
    <NodeShell category="cad" selected={selected}>
      <LabeledHandle
        type="target"
        position={Position.Top}
        id={`${id}-input`}
        label="input"
        dataType="code"
      />

      <div style={headerStyle}>Code Library</div>

      <div style={summaryStyle}>
        {selectedName ? (
          <span style={{ color: "#333" }}>📦 {selectedName}</span>
        ) : (
          <span style={{ color: "#999" }}>スニペット未選択</span>
        )}
      </div>

      <button onClick={handleOpenLibrary} style={openBtnStyle}>
        Open Library
      </button>

      {error && (
        <div style={{ color: "#d32f2f", fontSize: 11, padding: "4px 0" }}>{error}</div>
      )}

      <LabeledHandle
        type="source"
        position={Position.Bottom}
        id={`${id}-out`}
        label="out"
        dataType="geometry"
      />
    </NodeShell>
  );
}

const headerStyle: React.CSSProperties = {
  fontWeight: 700, fontSize: 13, marginBottom: 8, color: "#333",
};
const summaryStyle: React.CSSProperties = {
  fontSize: 12, marginBottom: 8, minHeight: 20,
};
const openBtnStyle: React.CSSProperties = {
  width: "100%", padding: "6px 12px", border: "1px solid #ddd", borderRadius: 6,
  background: "white", color: "#333", cursor: "pointer", fontSize: 11,
};
```

**Step 2: ビルドエラーがないか確認する**

```bash
cd /Users/hajimetokura/OKRA_local/apps/pathdesigner/frontend
npm run build 2>&1 | tail -20
```

Expected: エラーなし

**Step 3: Commit**

```bash
git add frontend/src/nodes/SnippetDbNode.tsx
git commit -m "refactor: rewrite SnippetDbNode to match AiCadNode pattern with PanelTab"
```

---

### Task 3: 動作確認

**Step 1: dev サーバーを起動する**

```bash
cd /Users/hajimetokura/OKRA_local/apps/pathdesigner
make dev
```

**Step 2: 以下を手動確認する**

1. Code Library ノードがライトテーマで表示される
2. "Open Library" ボタンを押すと PanelTab が開く
3. ライブラリグリッドが表示される（保存済みスニペットがある場合）
4. スニペットを選択すると "選択して実行" ボタンが活性化する
5. 実行後、ノード本体にスニペット名が表示される
6. AI CAD Node からの出力を接続すると保存フォームが活性化する

**Step 3: テストが通るか確認する**

```bash
cd /Users/hajimetokura/OKRA_local/apps/pathdesigner/backend
uv run pytest tests/ -v 2>&1 | tail -10
```

Expected: 全テストパス（フロントエンド変更のみなのでバックエンドテストは影響なし）

**Step 4: PR を作成する**

```bash
git push origin HEAD
gh pr create \
  --title "refactor: Code Library Node — align with AiCadNode pattern" \
  --body "$(cat <<'EOF'
## Summary
- `SnippetDbNode` をライトテーマ・コンパクト表示に変更
- 保存フォーム＋ライブラリブラウザを `SnippetLibraryPanel` に切り出し PanelTab で表示
- 生 `Handle` → `LabeledHandle` に変更
- スタイルをファイル末尾 `const` に集約

## Test plan
- [ ] Code Library ノードがライトテーマで表示される
- [ ] "Open Library" でパネルが開く
- [ ] スニペット選択・実行が動作する
- [ ] AI CAD Node 接続時に保存フォームが活性化する
- [ ] バックエンドテスト全パス

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
