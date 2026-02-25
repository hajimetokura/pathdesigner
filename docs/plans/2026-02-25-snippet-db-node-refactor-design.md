# Design: Code Library Node Refactor

**Date:** 2026-02-25
**Scope:** `SnippetDbNode.tsx` の構成を他ノードと統一する

---

## 背景・問題

`SnippetDbNode`（Code Library）は他のノードと構成が大きく異なる：

- ダークテーマのハードコードカラー（他ノードはライトテーマ）
- 保存フォーム＋サムネグリッド＋実行ボタンをすべてノード本体に詰め込み
- 生の `Handle` コンポーネント（他ノードは `LabeledHandle`）
- インラインスタイル（他ノードはファイル末尾の `const` オブジェクト）

---

## 目標

`AiCadNode` / `PlacementNode` パターンに準拠させる：

1. ノード本体はコンパクトなサマリーのみ
2. 重いUI（ライブラリブラウザ・保存フォーム）は PanelTab に移動
3. ライトテーマに統一
4. `LabeledHandle` を使用
5. スタイルをファイル末尾 `const` に集約

---

## アーキテクチャ

### SnippetDbNode（ノード本体）

**表示内容:**
- タイトル: "Code Library"
- 選択中スニペット名（未選択時はプレースホルダー）
- "Open Library" ボタン → PanelTab を開く
- "▶ 実行" ボタン（スニペット選択済みのとき表示）
- エラー表示

**ハンドル:**
- `LabeledHandle` type="target" position=Top id=`{id}-input` label="input" dataType="code"
- `LabeledHandle` type="source" position=Bottom id=`{id}-out` label="out" dataType="geometry"

**状態:**
- `selectedSnippetId: string | null`
- `selectedSnippetName: string | null`
- `executing: boolean`
- `error: string | null`
- `upstream: AiCadResult | undefined`（useUpstreamData）

### SnippetLibraryPanel（新規コンポーネント）

**ファイル:** `frontend/src/components/SnippetLibraryPanel.tsx`

**Props:**
```ts
interface SnippetLibraryPanelProps {
  upstream: AiCadResult | undefined;
  selectedId: string | null;
  onSelect: (id: string, name: string) => void;
  onExecute: (result: AiCadResult) => void;
}
```

**表示内容:**
- 保存エリア（`upstream` がある場合のみ活性）
  - 名前入力
  - タグ入力
  - 保存ボタン・メッセージ
- ライブラリエリア
  - 検索インプット
  - サムネグリッド（2列）
  - 削除ボタン
  - "選択して実行" ボタン

**状態:**
- 保存フォーム: `name`, `tagsInput`, `saving`, `saveMsg`
- ライブラリ: `snippets`, `searchQ`
- 実行: `executing`, `error`（ノード本体と共有せず、パネル内で管理）

---

## データフロー

```
SnippetDbNode
  selectedSnippetId ─→ SnippetLibraryPanel.selectedId
  upstream          ─→ SnippetLibraryPanel.upstream
  onSelect()        ←─ SnippetLibraryPanel（選択時）
  onExecute()       ←─ SnippetLibraryPanel（実行後）→ outputResult を更新
  openTab()         ─→ PanelTab に SnippetLibraryPanel をマウント
```

---

## ファイル変更一覧

| ファイル | 変更種別 |
|---------|---------|
| `frontend/src/nodes/SnippetDbNode.tsx` | 大幅修正 |
| `frontend/src/components/SnippetLibraryPanel.tsx` | 新規作成 |

---

## 非機能要件

- テストの変更は不要（バックエンドAPIは変わらない）
- サムネイル生成ロジック（`renderThumbnail`）は `SnippetLibraryPanel` に移動
