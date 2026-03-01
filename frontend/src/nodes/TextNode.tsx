import { useCallback, useState } from "react";
import { type NodeProps, useReactFlow } from "@xyflow/react";
import LabeledHandle from "./LabeledHandle";
import NodeShell from "../components/NodeShell";

export default function TextNode({ id, selected }: NodeProps) {
  const [prompt, setPrompt] = useState("");
  const { setNodes } = useReactFlow();

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      setPrompt(value);
      setNodes((nds) =>
        nds.map((n) =>
          n.id === id
            ? { ...n, data: { ...n.data, textData: { prompt: value } } }
            : n,
        ),
      );
    },
    [id, setNodes],
  );

  return (
    <NodeShell category="utility" selected={selected}>
      <div style={headerStyle}>Text</div>

      <textarea
        value={prompt}
        onChange={handleChange}
        placeholder="Describe the part to generate..."
        style={textareaStyle}
        rows={3}
      />

      <LabeledHandle
        type="source"
        id={`${id}-text`}
        label="text"
        dataType="generic"
      />
    </NodeShell>
  );
}

const headerStyle: React.CSSProperties = {
  fontWeight: 700, fontSize: 13, marginBottom: 8, color: "var(--text-primary)",
};
const textareaStyle: React.CSSProperties = {
  width: "100%", border: "1px solid var(--border-color)", borderRadius: "var(--radius-control)",
  padding: "8px", fontSize: 12, resize: "vertical",
  fontFamily: "inherit", boxSizing: "border-box",
  background: "var(--surface-bg)", color: "var(--text-primary)",
};
