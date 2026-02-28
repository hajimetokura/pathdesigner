# MergeNode 設計

## 概要
複数の geometry 系ノードの出力（`brepResult`）を1つに結合するノード。
BrepImport / AiCad / Code / SnippetDb / Align など、異なるソースのオブジェクトを
まとめて PlacementNode に送るためのハブ。

## 要件
- フロントエンド完結（バックエンドAPI不要）
- 動的入力ポート（接続に応じて自動追加・削除）
- 既存の `brepResult` インターフェースを維持

## 動的ポートの仕様

### 初期状態
- 入力ポート2つ: `${id}-in-0`, `${id}-in-1`（dataType: geometry）
- 出力ポート1つ: `${id}-out`（dataType: geometry）

### 自動追加ルール
- 全ポートが接続済み → 末尾に空ポート1つ追加
- 空ポートが2つ以上 → 末尾の空ポートを削除（常に空ポート1つを維持）

### ポートの検出
- React Flow の edges を監視し、自ノード宛のエッジを集計
- エッジの増減に応じてポート数を更新

## マージロジック

```
1. 接続されている全上流ノードの data.brepResult を収集
2. objects 配列を concat（重複 object_id はそのまま保持）
3. file_id = "merged-" + 全ソース file_id の sorted join hash
4. node.data.brepResult に書き込み
```

### 出力データ形状
```typescript
{
  file_id: "merged-xxx",
  objects: BrepObject[],    // 全ソースの objects を結合
  object_count: number,     // objects.length
}
```

## UI

- `NodeShell` + `LabeledHandle` パターン（既存ノードと統一）
- 接続ソース一覧表示（ソースノード名 + objects数）
- 合計 objects 数のサマリー（例: "3 objects from 2 sources"）

## ファイル構成

- `frontend/src/nodes/MergeNode.tsx` — ノード本体
- `frontend/src/types.ts` — nodeTypes に `merge` を追加
- `frontend/src/App.tsx` — nodeTypes 登録 + 初期ノード/エッジ追加
