# Theme System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** ノードUIのスタイルテーマ（Clean / Terracotta）を切り替え可能にする

**Architecture:** CSS カスタムプロパティで全デザイントークンを定義し、`data-theme` 属性で切替。ThemeContext で状態管理、localStorage で永続化。

**Tech Stack:** React Context, CSS Custom Properties, localStorage

---

### Task 1: CSS 変数定義

**Files:**
- Modify: `frontend/src/index.css`
- Modify: `frontend/index.html`

**Step 1: index.html に DM Sans フォント読み込みを追加**

`frontend/index.html` の `<head>` 内に追加:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
```

**Step 2: index.css に CSS 変数を定義**

`frontend/src/index.css` に Clean テーマ（デフォルト）と Terracotta テーマの変数セットを追加:

```css
/* ===== Theme Variables ===== */
:root,
[data-theme="clean"] {
  --canvas-bg: #f8f8f8;
  --node-bg: #ffffff;
  --sidebar-bg: #fafafa;
  --panel-bg: #ffffff;
  --surface-bg: #f5f5f5;

  --text-primary: #333333;
  --text-secondary: #666666;
  --text-muted: #888888;

  --border-color: #dddddd;
  --border-subtle: #e0e0e0;
  --shadow-node: 0 2px 6px rgba(0, 0, 0, 0.08);
  --shadow-button: 0 1px 4px rgba(0, 0, 0, 0.1);

  --radius-node: 8px;
  --radius-control: 6px;
  --radius-item: 4px;

  --color-cad: #ff9800;
  --color-cam: #00bcd4;
  --color-utility: #888888;

  --handle-geometry: #4a90d9;
  --handle-settings: #66bb6a;
  --handle-toolpath: #ff9800;
  --handle-generic: #9e9e9e;

  --color-accent: #4a90d9;
  --color-error: #d32f2f;
  --color-success: #2e7d32;
  --color-warning: #ffc107;

  --font-family: system-ui, -apple-system, sans-serif;
}

[data-theme="terracotta"] {
  --canvas-bg: #F3EEE8;
  --node-bg: #FAFAF7;
  --sidebar-bg: #EDE9E3;
  --panel-bg: #FAF5EF;
  --surface-bg: #EFEBE5;

  --text-primary: #3D3632;
  --text-secondary: #736B63;
  --text-muted: #9E9690;

  --border-color: #D6CFC6;
  --border-subtle: #E2D6C8;
  --shadow-node: 0 3px 12px rgba(100, 90, 80, 0.10);
  --shadow-button: 0 2px 6px rgba(100, 90, 80, 0.08);

  --radius-node: 14px;
  --radius-control: 10px;
  --radius-item: 8px;

  --color-cad: #B8977A;
  --color-cam: #88A090;
  --color-utility: #9E9690;

  --handle-geometry: #92A0AE;
  --handle-settings: #88A090;
  --handle-toolpath: #B8977A;
  --handle-generic: #9E9690;

  --color-accent: #92A0AE;
  --color-error: #C45D4F;
  --color-success: #6B8F71;
  --color-warning: #C4A35A;

  --font-family: 'DM Sans', system-ui, sans-serif;
}
```

`font-family` 指定を変数に変更:

```css
html,
body,
#root {
  width: 100%;
  height: 100%;
  font-family: var(--font-family);
}
```

テーマ切替のトランジションを追加（`*` リセットのブロック内に追記）:

```css
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
  transition: background-color 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
}
```

**Step 3: ブラウザで index.css が正しく読み込まれることを確認**

Run: `cd /Users/hajimetokura/OKRA_local/apps/pathdesigner && make front`

`<html>` タグに `data-theme="terracotta"` を DevTools で手動追加して変数が切り替わることを確認。

**Step 4: Commit**

```bash
git add frontend/src/index.css frontend/index.html
git commit -m "feat: add CSS variable definitions for Clean and Terracotta themes"
```

---

### Task 2: ThemeContext + テーマ切替ボタン

**Files:**
- Create: `frontend/src/contexts/ThemeContext.tsx`
- Modify: `frontend/src/App.tsx`

**Step 1: ThemeContext を作成**

`frontend/src/contexts/ThemeContext.tsx`:

```typescript
import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

export type ThemeName = "clean" | "terracotta";

interface ThemeContextValue {
  theme: ThemeName;
  setTheme: (t: ThemeName) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "clean",
  setTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

const STORAGE_KEY = "pathdesigner-theme";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeName>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === "terracotta" ? "terracotta" : "clean";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme: setThemeState }}>
      {children}
    </ThemeContext.Provider>
  );
}
```

**Step 2: App.tsx に ThemeProvider とテーマ切替ボタンを追加**

`frontend/src/App.tsx` を変更:

1. import を追加:
```typescript
import { ThemeProvider, useTheme } from "./contexts/ThemeContext";
```

2. Flow コンポーネント内、`<Panel position="top-right">` のボタン横にテーマ切替ボタンを追加:
```tsx
<Panel position="top-right">
  <div style={{ display: "flex", gap: 6 }}>
    <button onClick={toggleTheme} style={layoutBtnStyle} title={`Theme: ${theme}`}>
      {theme === "clean" ? "Clean" : "Terra"}
    </button>
    <button onClick={onLayout} style={layoutBtnStyle}>
      Auto Layout
    </button>
  </div>
</Panel>
```

Flow 関数の先頭で `useTheme` を取得:
```typescript
const { theme, setTheme } = useTheme();
const toggleTheme = useCallback(() => {
  setTheme(theme === "clean" ? "terracotta" : "clean");
}, [theme, setTheme]);
```

3. `App` コンポーネントで `ThemeProvider` をラップ:
```tsx
export default function App() {
  return (
    <ThemeProvider>
      <ReactFlowProvider>
        <Flow />
      </ReactFlowProvider>
    </ThemeProvider>
  );
}
```

**Step 3: ブラウザでテーマ切替ボタンが動作することを確認**

ボタンクリックで `<html data-theme="...">` が切り替わり、CSS 変数が反映されることを確認。
リロードしても選択が維持されることを確認。

**Step 4: Commit**

```bash
git add frontend/src/contexts/ThemeContext.tsx frontend/src/App.tsx
git commit -m "feat: add ThemeContext and theme toggle button"
```

---

### Task 3: NodeShell をCSS変数化

**Files:**
- Modify: `frontend/src/components/NodeShell.tsx`

**Step 1: CATEGORY_COLORS を CSS 変数参照に変更**

```typescript
const CATEGORY_COLORS: Record<NodeCategory, string> = {
  cad: "var(--color-cad)",
  cam: "var(--color-cam)",
  utility: "var(--color-utility)",
};
```

**Step 2: style オブジェクトのハードコード値を CSS 変数に置換**

```typescript
const borderColor = statusBorder || (isDark ? "#444" : "var(--border-color)");
const baseBg = isDark ? "#1e1e1e" : "var(--node-bg)";
// selectedBg はそのまま（color-mix で categoryColor を使う）

const style: React.CSSProperties = {
  background: selectedBg,
  borderTop: `1px solid ${borderColor}`,
  borderRight: `1px solid ${borderColor}`,
  borderBottom: `1px solid ${borderColor}`,
  borderLeft: `3px solid ${categoryColor}`,
  borderRadius: "var(--radius-node)",
  padding: "20px 12px",
  width: isDark ? undefined : width,
  minWidth: isDark ? 220 : undefined,
  maxWidth: isDark ? 360 : undefined,
  boxShadow: isDark ? "0 2px 6px rgba(0,0,0,0.15)" : "var(--shadow-node)",
};
```

注意: `borderRadius` は数値 `8` から文字列 `"var(--radius-node)"` に変更。`CSSProperties` では文字列も受け付ける。

**Step 3: 動作確認**

テーマ切替でノードの角丸・ボーダー色・背景・影が変わることを確認。

**Step 4: Commit**

```bash
git add frontend/src/components/NodeShell.tsx
git commit -m "feat: convert NodeShell to CSS variables"
```

---

### Task 4: LabeledHandle をCSS変数化

**Files:**
- Modify: `frontend/src/nodes/LabeledHandle.tsx`

**Step 1: handleColors を CSS 変数参照に変更**

```typescript
const handleColors: Record<string, string> = {
  geometry: "var(--handle-geometry)",
  settings: "var(--handle-settings)",
  toolpath: "var(--handle-toolpath)",
  generic: "var(--handle-generic)",
};
```

**Step 2: labelStyle のテキスト色を変数化**

```typescript
const labelStyle: React.CSSProperties = {
  fontSize: 9,
  color: "var(--text-muted)",
  whiteSpace: "nowrap",
  userSelect: "none",
  lineHeight: 1,
};
```

**Step 3: Commit**

```bash
git add frontend/src/nodes/LabeledHandle.tsx
git commit -m "feat: convert LabeledHandle to CSS variables"
```

---

### Task 5: Sidebar をCSS変数化

**Files:**
- Modify: `frontend/src/Sidebar.tsx`

**Step 1: CATEGORY_COLORS を CSS 変数参照に変更**

```typescript
const CATEGORY_COLORS: Record<NodeCategory, string> = {
  cad: "var(--color-cad)",
  cam: "var(--color-cam)",
  utility: "var(--color-utility)",
};
```

**Step 2: スタイルオブジェクトの色を CSS 変数に置換**

```typescript
const sidebarStyle: React.CSSProperties = {
  width: 160,
  padding: "12px 8px",
  borderRight: "1px solid var(--border-subtle)",
  background: "var(--sidebar-bg)",
  display: "flex",
  flexDirection: "column",
  gap: 6,
  flexShrink: 0,
};

const itemStyle: React.CSSProperties = {
  padding: "8px 10px",
  background: "var(--node-bg)",
  border: "1px solid var(--border-color)",
  borderLeft: "3px solid",
  borderRadius: "var(--radius-control)",
  fontSize: 12,
  cursor: "grab",
  userSelect: "none",
  marginTop: 4,
};
```

**Step 3: Commit**

```bash
git add frontend/src/Sidebar.tsx
git commit -m "feat: convert Sidebar to CSS variables"
```

---

### Task 6: SidePanel をCSS変数化

**Files:**
- Modify: `frontend/src/components/SidePanel.tsx`

**Step 1: スタイルオブジェクトの色を CSS 変数に置換**

```typescript
const containerStyle: React.CSSProperties = {
  width: 480,
  height: "100vh",
  borderLeft: "1px solid var(--border-subtle)",
  background: "var(--panel-bg)",
  display: "flex",
  flexDirection: "column",
  flexShrink: 0,
};

const tabBarStyle: React.CSSProperties = {
  display: "flex",
  borderBottom: "1px solid var(--border-subtle)",
  background: "var(--sidebar-bg)",
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
  borderRight: "1px solid var(--border-subtle)",
  whiteSpace: "nowrap",
  color: "var(--text-secondary)",
  userSelect: "none",
};

const activeTabStyle: React.CSSProperties = {
  background: "var(--panel-bg)",
  color: "var(--text-primary)",
  fontWeight: 600,
  borderBottom: "2px solid var(--color-accent)",
};

const closeTabStyle: React.CSSProperties = {
  marginLeft: 6,
  fontSize: 14,
  color: "var(--text-muted)",
  cursor: "pointer",
  lineHeight: 1,
};
```

**Step 2: Commit**

```bash
git add frontend/src/components/SidePanel.tsx
git commit -m "feat: convert SidePanel to CSS variables"
```

---

### Task 7: App.tsx のスタイルをCSS変数化

**Files:**
- Modify: `frontend/src/App.tsx`

**Step 1: statusStyle と layoutBtnStyle を CSS 変数に置換**

```typescript
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
```

**Step 2: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "feat: convert App.tsx styles to CSS variables"
```

---

### Task 8: 各ノードコンポーネントのハードコード色をCSS変数化

**Files:**
- Modify: `frontend/src/nodes/BrepImportNode.tsx`
- Modify: `frontend/src/nodes/AiCadNode.tsx`
- Modify: `frontend/src/nodes/OperationNode.tsx`
- Modify: `frontend/src/nodes/CodeNode.tsx`
- Modify: `frontend/src/nodes/PlacementNode.tsx`
- Modify: `frontend/src/nodes/SnippetDbNode.tsx`
- Modify: `frontend/src/nodes/PostProcessorNode.tsx`
- Modify: `frontend/src/nodes/ToolpathGenNode.tsx`
- Modify: `frontend/src/nodes/ToolpathPreviewNode.tsx`
- Modify: `frontend/src/nodes/CncCodeNode.tsx`
- Modify: `frontend/src/nodes/SheetNode.tsx`
- Modify: `frontend/src/nodes/DamNode.tsx`
- Modify: `frontend/src/nodes/DebugNode.tsx`

**Step 1: 各ノードの共通パターンを置換**

全ノードで以下の置換を行う:

| ハードコード値 | CSS 変数 |
|-------------|---------|
| `"white"` (background) | `"var(--node-bg)"` |
| `"#f5f5f5"` (surface) | `"var(--surface-bg)"` |
| `"#fafafa"` (surface) | `"var(--surface-bg)"` |
| `"#333"` / `"#333333"` (text) | `"var(--text-primary)"` |
| `"#666"` / `"#666666"` (text) | `"var(--text-secondary)"` |
| `"#888"` / `"#888888"` (text) | `"var(--text-muted)"` |
| `"#999"` (text) | `"var(--text-muted)"` |
| `"#555"` (text) | `"var(--text-secondary)"` |
| `"#ddd"` / `"#dddddd"` (border) | `"var(--border-color)"` |
| `"#ccc"` (border) | `"var(--border-color)"` |
| `"#e0e0e0"` (border) | `"var(--border-subtle)"` |
| `"#d32f2f"` (error) | `"var(--color-error)"` |
| `"#2e7d32"` (success) | `"var(--color-success)"` |
| `"#4a90d9"` (accent/hover) | `"var(--color-accent)"` |
| `borderRadius: 6` (controls) | `borderRadius: "var(--radius-control)"` |
| `borderRadius: 4` (items) | `borderRadius: "var(--radius-item)"` |

注意: ノード固有のブランドカラー（例: AiCadNode の `#e65100` ボタン）は CSS 変数 `--color-cad` を使う。

**Step 2: 各ファイルを1つずつ変更して動作確認**

ファイルごとにテーマ切替して見た目が正しいことを確認。

**Step 3: Commit**

```bash
git add frontend/src/nodes/
git commit -m "feat: convert all node components to CSS variables"
```

---

### Task 9: 最終動作確認 + 微調整

**Step 1: 全テーマで全機能を確認**

- Clean テーマ: 現行と見た目が同一であること
- Terracotta テーマ: 全コンポーネントが統一されたwarm/earth調であること
- テーマ切替トランジションが滑らかであること
- localStorage に保存され、リロードで維持されること

**Step 2: 必要に応じて色味の微調整**

色味が合わない箇所があれば CSS 変数の値を調整。

**Step 3: 最終コミット**

```bash
git add -A
git commit -m "feat: finalize theme system with Clean and Terracotta themes"
```
