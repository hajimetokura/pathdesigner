import { useCallback, useRef, useState } from "react";
import { Handle, Position, type NodeProps, useReactFlow } from "@xyflow/react";
import { uploadStepFile } from "../api";
import type { BrepImportResult, BrepObject } from "../types";

type Status = "idle" | "loading" | "success" | "error";

export default function BrepImportNode({ id }: NodeProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<BrepImportResult | null>(null);
  const [error, setError] = useState<string>("");
  const [isDragOver, setIsDragOver] = useState(false);
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
          {result.objects.map((obj) => (
            <ObjectSummary key={obj.object_id} obj={obj} />
          ))}
        </div>
      )}

      <Handle type="source" position={Position.Bottom} id={`${id}-out`} />
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
  padding: 12,
  minWidth: 200,
  maxWidth: 280,
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

const objStyle: React.CSSProperties = {
  background: "#f5f5f5",
  borderRadius: 4,
  padding: "6px 8px",
  marginTop: 4,
};
