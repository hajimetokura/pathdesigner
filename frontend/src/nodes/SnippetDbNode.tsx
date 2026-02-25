import { useCallback, useEffect, useState } from "react";
import { Handle, Position, type NodeProps, useReactFlow } from "@xyflow/react";
import NodeShell from "../components/NodeShell";
import {
  saveSnippet,
  listSnippets,
  deleteSnippet,
  executeSnippet,
} from "../api";
import type { AiCadResult, SnippetInfo } from "../types";
import { useUpstreamData } from "../hooks/useUpstreamData";

// ── オフスクリーン Three.js サムネ生成 ────────────────────────────────────────

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
    const gltf = await new Promise<{ scene: { position: object } }>((res, rej) =>
      loader.load(meshUrl, res as (g: unknown) => void, undefined, rej),
    );
    const gltfScene = scene.children[scene.children.length] as Parameters<typeof scene.add>[0];
    void gltfScene;
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

// ── コンポーネント ─────────────────────────────────────────────────────────────

export default function SnippetDbNode({ id, selected }: NodeProps) {
  const { setNodes } = useReactFlow();

  // 上流データ購読（AI Node または他の code 出力ノードから）
  const extractUpstream = useCallback(
    (d: Record<string, unknown>) => {
      const result = d.result as AiCadResult | undefined;
      return result ?? undefined;
    },
    [],
  );
  const upstream = useUpstreamData(id, `${id}-input`, extractUpstream);

  // 保存フォーム
  const [name, setName] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  // ライブラリ
  const [snippets, setSnippets] = useState<SnippetInfo[]>([]);
  const [searchQ, setSearchQ] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 初回 + 検索変更でスニペット一覧を取得
  useEffect(() => {
    listSnippets(searchQ || undefined)
      .then((r) => setSnippets(r.snippets))
      .catch(() => setSnippets([]));
  }, [searchQ]);

  // 保存ハンドラ
  const handleSave = async () => {
    if (!upstream || !name.trim()) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      // オフスクリーンサムネ生成（失敗しても保存は続行）
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
      // ライブラリ更新
      const refreshed = await listSnippets(searchQ || undefined);
      setSnippets(refreshed.snippets);
    } catch (e) {
      setSaveMsg(`エラー: ${String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  // 取り出し＆実行ハンドラ
  const handleExecute = async () => {
    if (!selectedId) return;
    setExecuting(true);
    setError(null);
    try {
      const result = await executeSnippet(selectedId);
      // 自ノードの outputResult を更新 → 下流ノードが購読
      setNodes((nodes) =>
        nodes.map((n) =>
          n.id === id
            ? { ...n, data: { ...n.data, outputResult: result } }
            : n,
        ),
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setExecuting(false);
    }
  };

  const handleDelete = async (sid: string) => {
    await deleteSnippet(sid).catch(() => {});
    if (selectedId === sid) setSelectedId(null);
    const refreshed = await listSnippets(searchQ || undefined);
    setSnippets(refreshed.snippets);
  };

  return (
    <NodeShell selected={selected} category="cad">
      {/* Input handle */}
      <Handle
        type="target"
        position={Position.Left}
        id={`${id}-input`}
        style={{ top: "30%" }}
      />

      <div style={{ padding: "8px", minWidth: 220, fontSize: 12 }}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Code Library</div>
        {/* ── 保存エリア ─────────────────────────── */}
        <div style={{ marginBottom: 10, opacity: upstream ? 1 : 0.4 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            保存 {upstream ? `— ${upstream.object_count} objects` : "（input 未接続）"}
          </div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="名前（必須）"
            disabled={!upstream}
            style={{ width: "100%", marginBottom: 4, boxSizing: "border-box" }}
          />
          <input
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            placeholder="タグ（カンマ区切り）"
            disabled={!upstream}
            style={{ width: "100%", marginBottom: 4, boxSizing: "border-box" }}
          />
          <button
            onClick={handleSave}
            disabled={!upstream || !name.trim() || saving}
            style={{ width: "100%" }}
          >
            {saving ? "保存中..." : "保存"}
          </button>
          {saveMsg && (
            <div style={{ marginTop: 4, color: saveMsg.startsWith("エラー") ? "red" : "green" }}>
              {saveMsg}
            </div>
          )}
        </div>

        {/* ── ライブラリ ─────────────────────────── */}
        <div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>ライブラリ</div>
          <input
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder="🔍 検索..."
            style={{ width: "100%", marginBottom: 6, boxSizing: "border-box" }}
          />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, maxHeight: 200, overflowY: "auto" }}>
            {snippets.length === 0 && (
              <div style={{ gridColumn: "1/-1", color: "#888", textAlign: "center" }}>
                スニペットなし
              </div>
            )}
            {snippets.map((s) => (
              <div
                key={s.id}
                onClick={() => setSelectedId(s.id)}
                style={{
                  border: `1px solid ${selectedId === s.id ? "#4a9eff" : "#555"}`,
                  borderRadius: 4,
                  padding: 4,
                  cursor: "pointer",
                  background: selectedId === s.id ? "#1a3a5c" : "#2a2a2a",
                  position: "relative",
                }}
              >
                {s.thumbnail_png ? (
                  <img
                    src={s.thumbnail_png}
                    alt={s.name}
                    style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 2 }}
                  />
                ) : (
                  <div style={{ width: "100%", aspectRatio: "1", background: "#3a3a3a", borderRadius: 2, display: "flex", alignItems: "center", justifyContent: "center", color: "#666" }}>
                    📦
                  </div>
                )}
                <div style={{ fontSize: 10, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {s.name}
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); void handleDelete(s.id); }}
                  style={{ position: "absolute", top: 2, right: 2, fontSize: 9, padding: "0 3px", background: "#555", border: "none", borderRadius: 2, cursor: "pointer", color: "#fff" }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          <button
            onClick={() => void handleExecute()}
            disabled={!selectedId || executing}
            style={{ width: "100%", marginTop: 6 }}
          >
            {executing ? "実行中..." : "選択して実行"}
          </button>
          {error && <div style={{ color: "red", marginTop: 4 }}>{error}</div>}
        </div>
      </div>

      {/* Output handle */}
      <Handle
        type="source"
        position={Position.Right}
        id={`${id}-output`}
        style={{ top: "70%" }}
      />
    </NodeShell>
  );
}
