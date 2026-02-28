# 3D PreviewNode デザイン

## 概要

独立した3Dプレビューノードを新規作成し、フロー内の任意の場所に挟めるようにする。
既存ノード（AiCadNode, BrepImportNode）の内蔵3Dプレビューは廃止し、このノードに統一する。

## 決定事項

- **アプローチ:** インラインMeshViewer方式（アプローチA）
- **表示:** ノード内に小さな3Dビュー + クリックでサイドパネルに拡大表示
- **データフロー:** brepResult受取 → 自分でfetchMeshData → パススルー出力
- **移行:** 同一ブランチで既存ノードの内蔵プレビューも削除

## ノード構造

```
┌─────────────────────────────┐
│  ● brepResult (入力)        │
├─────────────────────────────┤
│  📦 3D Preview              │
│ ┌─────────────────────────┐ │
│ │                         │ │
│ │   MeshViewer (小)       │ │
│ │   200x150, 回転可能     │ │
│ │                         │ │
│ └─────────────────────────┘ │
│     クリックでパネル拡大    │
├─────────────────────────────┤
│  ● brepResult (出力)        │
└─────────────────────────────┘
```

### サイドパネル（クリック時）

BrepImportPanel を流用。3Dビュー（フルサイズ）+ 寸法情報・オブジェクト一覧。

## データフロー

```
上流ノード (AiCadNode / BrepImportNode / CodeNode)
  │ brepResult { file_id, objects }
  ▼
PreviewNode
  ├─ useUpstreamData() で brepResult 取得
  ├─ useEffect → fetchMeshData(file_id) → meshes state
  ├─ MeshViewer に meshes を渡してインライン描画
  ├─ クリック → openTab() → BrepImportPanel（サイドパネル）
  └─ setNodes() で自ノードの data.brepResult に保存（パススルー）
  │ brepResult (そのまま)
  ▼
下流ノード (PlacementNode 等)
```

## ハンドル定義

- 入力: `brepResult` (LabeledHandle, type="target")
- 出力: `brepResult` (LabeledHandle, type="source")

## React Flow 干渉対策

MeshViewer のラッパーで `stopPropagation` を使い、OrbitControls と React Flow のパン/ズームの競合を防ぐ：

```tsx
<div onPointerDown={e => e.stopPropagation()}
     onWheelCapture={e => e.stopPropagation()}>
  <MeshViewer meshes={meshes} style={{ width: 200, height: 150 }} />
</div>
```

## 既存ノードの変更

### AiCadNode — 削除対象

- `meshes` state
- `fetchMeshData()` 呼び出し（generateStream, refine, rerun 内）
- `handleView3D` コールバック
- 「View 3D」ボタン

### BrepImportNode — 削除対象

- `meshes` state
- `fetchMeshData()` 呼び出し
- `handleView3D` コールバック
- 「View 3D」ボタン

### 維持するコンポーネント

- `MeshViewer` — PreviewNode で使用
- `BrepImportPanel` — サイドパネル拡大表示で使用
- `fetchMeshData` (api.ts) — PreviewNode から呼び出し

## ノード状態

| 状態 | 表示 |
|------|------|
| 未接続 | 「Connect upstream node」テキスト |
| ロード中 | スピナー / Loading表示 |
| 正常 | MeshViewer (3D表示) |
| エラー | エラーメッセージ |

## 登録

`App.tsx` の `nodeTypes` に `preview: PreviewNode` を追加。
ノード追加メニュー（AddNodeMenu）にも追加。
