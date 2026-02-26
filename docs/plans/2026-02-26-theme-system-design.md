# Theme System Design — CSS Variables + ThemeContext

## 概要

ノードUIのスタイルテーマを切り替え可能にする。初期テーマは2種類:
- **Clean** — 現行のシンプルな白ベース
- **Terracotta** — グレージュベースのwarm/earth系

## 技術アプローチ

CSS カスタムプロパティ（CSS Variables）をルート要素に定義し、React の ThemeContext でテーマ名を管理。テーマ切替時に CSS 変数セットを差し替える。

### 選定理由
- 既存のインラインスタイルと共存可能（`var(--xxx)` をインラインで使える）
- テーマ変更時にCSSだけが変わる（Reactの再レンダリング最小限）
- テーマ追加がスケーラブル（変数セット追加のみ）

## CSS 変数一覧

### 背景系
| 変数 | Clean | Terracotta |
|------|-------|------------|
| `--canvas-bg` | `#f8f8f8` | `#F3EEE8` |
| `--node-bg` | `#ffffff` | `#FAFAF7` |
| `--node-bg-selected` | — | テーマ側で `color-mix` 計算 |
| `--sidebar-bg` | `#fafafa` | `#EDE9E3` |
| `--panel-bg` | `#ffffff` | `#FAF5EF` |
| `--surface-bg` | `#f5f5f5` | `#EFEBE5` |

### テキスト
| 変数 | Clean | Terracotta |
|------|-------|------------|
| `--text-primary` | `#333333` | `#3D3632` |
| `--text-secondary` | `#666666` | `#736B63` |
| `--text-muted` | `#888888` | `#9E9690` |

### ボーダー・影
| 変数 | Clean | Terracotta |
|------|-------|------------|
| `--border-color` | `#dddddd` | `#D6CFC6` |
| `--border-subtle` | `#e0e0e0` | `#E2D6C8` |
| `--shadow-node` | `0 2px 6px rgba(0,0,0,0.08)` | `0 3px 12px rgba(100,90,80,0.10)` |
| `--shadow-button` | `0 1px 4px rgba(0,0,0,0.1)` | `0 2px 6px rgba(100,90,80,0.08)` |

### 形状
| 変数 | Clean | Terracotta |
|------|-------|------------|
| `--radius-node` | `8px` | `14px` |
| `--radius-control` | `6px` | `10px` |
| `--radius-item` | `4px` | `8px` |

### カテゴリカラー
| 変数 | Clean | Terracotta |
|------|-------|------------|
| `--color-cad` | `#ff9800` | `#B8977A` |
| `--color-cam` | `#00bcd4` | `#88A090` |
| `--color-utility` | `#888888` | `#9E9690` |

### ハンドルカラー
| 変数 | Clean | Terracotta |
|------|-------|------------|
| `--handle-geometry` | `#4a90d9` | `#92A0AE` |
| `--handle-settings` | `#66bb6a` | `#88A090` |
| `--handle-toolpath` | `#ff9800` | `#B8977A` |
| `--handle-generic` | `#9e9e9e` | `#9E9690` |

### フォント
| 変数 | Clean | Terracotta |
|------|-------|------------|
| `--font-family` | `system-ui, -apple-system, sans-serif` | `'DM Sans', system-ui, sans-serif` |

## 実装構成

### ThemeContext (`frontend/src/contexts/ThemeContext.tsx`)
```typescript
type ThemeName = "clean" | "terracotta";

const ThemeContext = createContext<{
  theme: ThemeName;
  setTheme: (t: ThemeName) => void;
}>({ theme: "clean", setTheme: () => {} });

// localStorage で永続化
// <html> のルート要素に data-theme 属性をセット
// → index.css で [data-theme="clean"] / [data-theme="terracotta"] の変数を定義
```

### CSS 変数定義 (`frontend/src/index.css`)
```css
:root,
[data-theme="clean"] {
  --canvas-bg: #f8f8f8;
  --node-bg: #ffffff;
  /* ... Clean テーマの全変数 ... */
}

[data-theme="terracotta"] {
  --canvas-bg: #F3EEE8;
  --node-bg: #FAFAF7;
  /* ... Terracotta テーマの全変数 ... */
}

/* トランジション */
* {
  transition: background-color 0.3s ease, border-color 0.3s ease, color 0.3s ease, box-shadow 0.3s ease;
}
```

### テーマ切替UI
- キャンバス右上にアイコンボタン配置
- クリックで Clean ↔ Terracotta トグル
- 選択は `localStorage("pathdesigner-theme")` に保存

### コンポーネント移行
各コンポーネントのハードコード色を CSS 変数に置換:

```typescript
// Before
background: "white"
// After
background: "var(--node-bg)"
```

## 影響ファイル

1. **新規作成**
   - `frontend/src/contexts/ThemeContext.tsx` — テーマ管理
   - テーマ切替ボタンコンポーネント（App.tsx 内 or 別ファイル）

2. **変更（CSS 変数置換）**
   - `frontend/src/index.css` — 変数定義追加
   - `frontend/src/components/NodeShell.tsx` — 背景・ボーダー・影・角丸
   - `frontend/src/nodes/LabeledHandle.tsx` — ハンドルカラー
   - `frontend/src/Sidebar.tsx` — 背景・ボーダー・テキスト
   - `frontend/src/components/SidePanel.tsx` — パネル背景・タブ
   - `frontend/src/App.tsx` — ThemeProvider追加、キャンバス背景
   - `frontend/src/nodes/BrepImportNode.tsx` — ハードコード色置換
   - `frontend/src/nodes/AiCadNode.tsx` — ボタン・テキスト色
   - `frontend/src/nodes/OperationNode.tsx` — スタイル色
   - `frontend/src/nodes/CodeNode.tsx` — スタイル色
   - `frontend/src/nodes/PlacementNode.tsx` — スタイル色
   - `frontend/src/nodes/SnippetDbNode.tsx` — スタイル色

## DM Sans フォント

Terracotta テーマで使用する Google Fonts。丸みがあり温かみのあるサンセリフ体。
`index.html` に `<link>` タグで読み込み、`--font-family` 変数で適用。
