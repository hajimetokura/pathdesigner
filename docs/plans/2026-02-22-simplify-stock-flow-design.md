# Stock データフロー簡素化

## 背景

現状、Stock ノードは Operation ノードと Toolpath Gen ノードの両方に直接接続されている。

```
BREP ─→ Operation ←─ Stock
              │          │
              ↓          ↓
         Toolpath Gen ←──┘ ←─ Post Processor
```

Stock → Toolpath Gen の接続は `material_id` → `thickness` ルックアップのためだけに存在するが、
Operation ノードは既に Stock 情報を保持しているため冗長である。

## 設計

Stock → Toolpath Gen の直接接続を削除し、Operation が stock 情報を下流に渡す。

```
BREP ─→ Operation ←─ Stock
              │
              ↓ (operations + stock)
         Toolpath Gen ←─ Post Processor
```

### 変更点

**フロントエンド:**

1. **App.tsx** — `e2-6`（Stock → Toolpath Gen）エッジを削除
2. **ToolpathGenNode.tsx** — Stock を Operation ノード経由で取得するように変更
   - `6-stock` ハンドルを削除
   - Operation ノードの `data.stockSettings` を参照
3. **OperationNode.tsx** — `data` に `stockSettings` を明示的に保存（既にローカルstateにはある）

**バックエンド:**

- 変更なし（API は `stock: StockSettings` を引数として受け取っており、フロントが渡すデータの取得元が変わるだけ）

### データフロー（変更後）

| 接続 | データ |
|------|--------|
| Stock → Operation | `StockSettings`（materials配列） |
| Operation → Toolpath Gen | `OperationDetectResult` + `OperationAssignment[]` + `StockSettings` |
| Post Processor → Toolpath Gen | `PostProcessorSettings` |

## スコープ外

- バックエンド API の変更
- 新機能の追加
- テストの変更（バックエンドのデータフローは同一のため）
