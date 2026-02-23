import { useCallback, useRef, useState } from "react";
import { Position, type NodeProps, useReactFlow } from "@xyflow/react";
import LabeledHandle from "./LabeledHandle";
import { uploadStepFile, fetchMeshData } from "../api";
import type { BrepImportResult, BrepObject, ObjectMesh } from "../types";
import type { PanelTab } from "../components/SidePanel";
import BrepImportPanel from "../components/BrepImportPanel";

type Status = "idle" | "loading" | "success" | "error";

export default function BrepImportNode({ id, data }: NodeProps) {
  const openTab = (data as Record<string, unknown>).openTab as ((tab: PanelTab) => void) | undefined;
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<BrepImportResult | null>(null);
  const [error, setError] = useState<string>("");
  const [isDragOver, setIsDragOver] = useState(false);
  const [meshes, setMeshes] = useState<ObjectMesh[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const { setNodes } = useReactFlow();

  const handleFile = useCallback(
    async (file: File) => {
      setStatus("loading");
      setError("");
      try {
        const data = await uploadStepFile(file);
        setResult(data);
        setStatus("success");
        // Store result in node data so downstream nodes can access it
        setNodes((nds) =>
          nds.map((n) =>
            n.id === id ? { ...n, data: { ...n.data, brepResult: data } } : n
          )
        );
        // Fetch mesh data for 3D preview
        try {
          const meshData = await fetchMeshData(data.file_id);
          setMeshes(meshData.objects);
        } catch {
          // Mesh fetch failure is non-critical, preview just won't show
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Upload failed");
        setStatus("error");
      }
    },
    [id, setNodes]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const onDragLeave = useCallback(() => setIsDragOver(false), []);

  const onClickUpload = useCallback(() => inputRef.current?.click(), []);

  const onFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleView3D = useCallback(() => {
    if (!result || !openTab) return;
    openTab({
      id: `brep-3d-${id}`,
      label: "3D View",
      icon: "📦",
      content: <BrepImportPanel brepResult={result} meshes={meshes} />,
    });
  }, [id, result, meshes, openTab]);


  return (
    <div style={nodeStyle}>
      <div style={headerStyle}>BREP Import</div>

      <div
        style={{
          ...dropZoneStyle,
          borderColor: isDragOver ? "#4a90d9" : "#ccc",
          background: isDragOver ? "#eef4fc" : "#fafafa",
        }}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onClick={onClickUpload}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".step,.stp"
          style={{ display: "none" }}
          onChange={onFileChange}
        />
        {status === "loading" ? (
          <span style={{ color: "#888" }}>Analyzing...</span>
        ) : (
          <span style={{ color: "#888", fontSize: 12 }}>
            Drop .step/.stp here
            <br />
            or click to select
          </span>
        )}
      </div>

      {status === "error" && (
        <div style={{ color: "#d32f2f", fontSize: 11, padding: "4px 0" }}>
          {error}
        </div>
      )}

      {status === "success" && result && (
        <div style={resultStyle}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            {result.object_count} object{result.object_count > 1 ? "s" : ""}
          </div>
          <div style={scrollableListStyle}>
            {result.objects.map((obj) => (
              <ObjectSummary key={obj.object_id} obj={obj} />
            ))}
          </div>
          {meshes.length > 0 && (
            <button onClick={handleView3D} style={viewBtnStyle}>
              View 3D
            </button>
          )}
        </div>
      )}

      <LabeledHandle type="source" position={Position.Bottom} id={`${id}-out`} label="out" dataType="geometry" />
    </div>
  );
}

function ObjectSummary({ obj }: { obj: BrepObject }) {
  const bb = obj.bounding_box;
  return (
    <div style={objStyle}>
      <div style={{ fontSize: 11, color: "#555" }}>{obj.object_id}</div>
      <div style={{ fontSize: 11 }}>
        {bb.x.toFixed(1)} x {bb.y.toFixed(1)} x {bb.z.toFixed(1)} {obj.unit}
      </div>
      <div style={{ fontSize: 11 }}>
        Type: <strong>{obj.machining_type}</strong>
        {!obj.is_closed && (
          <span style={{ color: "#e65100" }}> (open)</span>
        )}
        {!obj.is_planar && (
          <span style={{ color: "#e65100" }}> (non-planar)</span>
        )}
      </div>
    </div>
  );
}

const nodeStyle: React.CSSProperties = {
  background: "white",
  border: "1px solid #ddd",
  borderRadius: 8,
  padding: "20px 12px",
  width: 200,
  boxShadow: "0 2px 6px rgba(0,0,0,0.08)",
};

const headerStyle: React.CSSProperties = {
  fontWeight: 700,
  fontSize: 13,
  marginBottom: 8,
  color: "#333",
};

const dropZoneStyle: React.CSSProperties = {
  border: "2px dashed #ccc",
  borderRadius: 6,
  padding: "16px 12px",
  textAlign: "center",
  cursor: "pointer",
  transition: "all 0.15s",
};

const resultStyle: React.CSSProperties = {
  marginTop: 8,
  fontSize: 12,
};

const scrollableListStyle: React.CSSProperties = {
  maxHeight: 150,
  overflowY: "auto",
  scrollbarWidth: "thin",
};

const objStyle: React.CSSProperties = {
  background: "#f5f5f5",
  borderRadius: 4,
  padding: "6px 8px",
  marginTop: 4,
};

const viewBtnStyle: React.CSSProperties = {
  width: "100%",
  padding: "6px 12px",
  border: "1px solid #ddd",
  borderRadius: 6,
  background: "white",
  color: "#333",
  cursor: "pointer",
  fontSize: 11,
  marginTop: 8,
};
