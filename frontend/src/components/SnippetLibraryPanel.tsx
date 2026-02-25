import type React from "react";
import { useCallback, useEffect, useState } from "react";
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
  onSelect: (id: string | null, name: string | null) => void;
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

  const handleSave = useCallback(async () => {
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
      setSaveMsg(`エラー: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }, [upstream, name, tagsInput, searchQ]);

  const handleExecute = useCallback(async () => {
    if (!selectedId) return;
    setExecuting(true);
    setError(null);
    try {
      const result = await executeSnippet(selectedId);
      onExecute(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExecuting(false);
    }
  }, [selectedId, onExecute]);

  const handleDelete = useCallback(async (sid: string) => {
    await deleteSnippet(sid).catch(() => {});
    if (selectedId === sid) onSelect(null, null);
    const refreshed = await listSnippets(searchQ || undefined);
    setSnippets(refreshed.snippets);
  }, [selectedId, searchQ, onSelect]);

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
