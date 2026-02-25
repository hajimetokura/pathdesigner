# Phase D: Code Node — Design Doc

**Date:** 2026-02-25
**Issue:** #37
**Status:** Approved

## Overview

build123dコード手動エディタノード。CodeMirror 6 ベースのエディタをパネルタブに持ち、
コードを実行してジオメトリを生成する。出力は既存の `PlacementNode` に直結可能。

## New Files

| File | Description |
|------|-------------|
| `frontend/src/nodes/CodeNode.tsx` | ノードコンポーネント |
| `frontend/src/components/CodeEditorPanel.tsx` | CodeMirrorエディタパネル |

## CodeNode.tsx

- `NodeShell category="cad"` + `LabeledHandle` — 他ノードと統一スタイル
- 入力ハンドル: なし（スタンドアロン）
- 出力ハンドル: `geometry` dataType → PlacementNode直結
- ノードカード内表示:
  - ヘッダー: `Code Node`
  - ステータス: `idle` / `running` / `success (N objects)` / `error`
  - `Open Editor` ボタン → パネルタブ開閉
- 結果を `brepResult` (AiCadResult) として node data に保存
- `updateTab` パターン適用 (SnippetDbNode準拠)

## CodeEditorPanel.tsx

- **CodeMirror 6** (`@codemirror/lang-python` + `@codemirror/autocomplete`)
- build123d 補完辞書（網羅的）:
  - 3Dプリミティブ: Box, Cylinder, Sphere, Cone, Torus
  - 操作: fillet, chamfer, extrude, revolve, loft, sweep
  - スケッチ: Circle, Rectangle, Polygon, Line, Arc
  - 位置: Pos, Rot, Axis, Align
  - コンテキスト: BuildPart, BuildSketch
  - セレクタ: .edges(), .faces(), .vertices(), .group_by(), .filter_by()
  - その他: Compound, Part, Solid, export_step
- デフォルトテンプレート: `from build123d import *\n\nresult = Box(100, 100, 10)`
- `Run` ボタン → `executeAiCadCode()` (既存API)
- `Save to Library` ボタン → `/snippets` POST (既存API)
- 実行結果表示（オブジェクト数・バウンディングボックス）
- エラー表示エリア

## Backend Changes

**なし** — 既存の `/ai-cad/execute` エンドポイントを再利用。

## App.tsx Changes

- `CodeNode` をノードタイプ登録
- ノードパレットに「Code」追加

## Data Flow

```
CodeNode
  state: code (string), result (AiCadResult | null)
  node.data.brepResult = result
    ↓ geometry handle
PlacementNode
  reads: d.brepResult
```

## Dependencies

- `@codemirror/view`
- `@codemirror/state`
- `@codemirror/lang-python`
- `@codemirror/autocomplete`
- `@codemirror/theme-one-dark` (optional)
