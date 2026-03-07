import { useRef, useState, useCallback } from "react";
import { type NodeProps, useReactFlow } from "@xyflow/react";
import LabeledHandle from "./LabeledHandle";
import NodeShell from "../components/NodeShell";
import { uploadMeshFile } from "../api";
import type { MeshImportResult, BrepObject } from "../types";

type Status = "idle" | "loading" | "success" | "error";

export default function MeshImportNode({ id, selected }: NodeProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<MeshImportResult | null>(null);
  const [error, setError] = useState<string>("");
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { setNodes } = useReactFlow();

  const handleFile = useCallback(
    async (file: File) => {
      setStatus("loading");
      setError("");
      try {
        const data = await uploadMeshFile(file);
        setResult(data);
        setStatus("success");
        setNodes((nds) =>
          nds.map((n) =>
            n.id === id
              ? { ...n, data: { ...n.data, brepResult: data } }
              : n
          )
        );
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

  return (
    <NodeShell category="cad" selected={selected}>
      <div style={headerStyle}>Mesh Import</div>

      <div
        style={{
          ...dropZoneStyle,
          borderColor: isDragOver ? "var(--color-accent)" : "var(--border-color)",
        }}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onClick={onClickUpload}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".stl,.obj"
          style={{ display: "none" }}
          onChange={onFileChange}
        />
        {status === "loading" ? (
          <span style={{ color: "var(--text-muted)" }}>Analyzing...</span>
        ) : (
          <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
            Drop .stl/.obj here
            <br />
            or click to select
          </span>
        )}
      </div>

      {status === "error" && (
        <div style={{ color: "var(--color-error)", fontSize: 11, padding: "4px 0" }}>
          {error}
        </div>
      )}

      {status === "success" && result && (
        <div style={resultStyle}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            {result.object_count} object{result.object_count > 1 ? "s" : ""}
          </div>
          {result.objects.map((obj) => (
            <MeshSummary key={obj.object_id} obj={obj} />
          ))}
        </div>
      )}

      <LabeledHandle type="source" id={`${id}-out`} label="out" dataType="geometry" />
    </NodeShell>
  );
}

function MeshSummary({ obj }: { obj: BrepObject }) {
  const bb = obj.bounding_box;
  return (
    <div style={objStyle}>
      <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>{obj.object_id}</div>
      <div style={{ fontSize: 11 }}>
        {bb.x.toFixed(1)} × {bb.y.toFixed(1)} × {bb.z.toFixed(1)} {obj.unit}
      </div>
      <div style={{ fontSize: 11 }}>
        Type: <strong>{obj.machining_type}</strong>
        {obj.is_closed && (
          <span style={{ color: "var(--text-muted)" }}> (watertight)</span>
        )}
      </div>
    </div>
  );
}

const headerStyle: React.CSSProperties = {
  fontWeight: 700,
  fontSize: 13,
  marginBottom: 8,
  color: "var(--text-primary)",
};

const dropZoneStyle: React.CSSProperties = {
  border: "2px dashed var(--border-color)",
  borderRadius: "var(--radius-control)",
  padding: "16px 12px",
  textAlign: "center",
  cursor: "pointer",
  transition: "all 0.15s",
};

const resultStyle: React.CSSProperties = {
  marginTop: 8,
  fontSize: 12,
};

const objStyle: React.CSSProperties = {
  background: "var(--surface-bg)",
  borderRadius: "var(--radius-item)",
  padding: "6px 8px",
  marginTop: 4,
};
