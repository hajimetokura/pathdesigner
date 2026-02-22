# Phase 5: CNC Code + Toolpath Preview — 設計

## 概要

ToolpathGenNode の出力を2つの専用ノードで表示する:
- **CNC Code ノード** — 生成コードの表示・エクスポート
- **Toolpath Preview ノード** — 2Dツールパスの可視化

## リファクタリング: 汎用命名化

ToolpathGenNode の出力を ShopBot 非依存にリネームする。

| 現在 | 変更後 | 理由 |
|------|--------|------|
| `SbpGenResult` 型 | `OutputResult` | ポストプロセッサ非依存 |
| `sbpResult` (node.data) | `outputResult` | 同上 |
| `sbp_code` フィールド | `code` | 同上 |
| — | `format` フィールド追加 | `"sbp"`, `"gcode"` 等を識別 |

### OutputResult 型

```typescript
interface OutputResult {
  code: string;       // 生成されたCNCコード全文
  filename: string;   // "output.sbp"
  format: string;     // "sbp" | "gcode" | ...
}
```

バックエンド側も同様に `SbpGenResult` → `OutputResult` にリネーム。

## ノード1: CNC Code (`cncCode`)

### ノード内（コンパクト）
- ヘッダー: "CNC Code"
- フォーマット + 行数表示（例: `SBP · 42 lines`）
- 「Export」ボタン → ファイルダウンロード
- 「View Code」リンク → サイドパネルを開く
- 色テーマ: グリーン系 (`#66bb6a`)

### サイドパネル (CncCodePanel)
- SBPコード全文（スクロール可能、等幅フォント）
- 自前の正規表現ベースのシンタックスハイライト:
  - コマンド (`M3`, `J2`, `JZ`, `MS`, `JS`, `TR`, `C6`, `C7`, `C9` 等): 青
  - コメント (`'...`): グレー
  - 数値: オレンジ
  - 変数・条件 (`IF`, `THEN`, `GOTO`, `%(25)` 等): パープル
- 「Export」ボタン（パネル内にも配置）

### 入力
- ToolpathGenNode の `outputResult`
- ハンドル: `toolpath` タイプ（オレンジ）

## ノード2: Toolpath Preview (`toolpathPreview`)

### ノード内（コンパクト）
- ヘッダー: "Toolpath Preview"
- 小さな Canvas（約200×150px）でツールパスをフィット描画
- クリックでサイドパネルを開く
- 色テーマ: シアン系 (`#00bcd4`)

### サイドパネル (ToolpathPreviewPanel)
- 大きな Canvas でツールパスを拡大表示
- Z深さ別に色分け（浅い=明るい色、深い=暗い色）
- タブ位置をマーカー（ドット or 別色セグメント）で表示
- パス情報サマリ:
  - オペレーション数
  - パス数（全パス合計）
  - 合計距離（mm）
  - 推定加工時間（feed rate から算出）

### 入力
- ToolpathGenNode の `toolpathResult`
- ハンドル: `toolpath` タイプ（オレンジ）

### 描画仕様
- Canvas API を使用（SVGより大量座標点で軽量）
- 座標系: 素材座標系（左下原点、Y上向き）→ Canvas 座標系に変換
- 自動フィット: パスのバウンディングボックスに合わせてスケール
- パディング: 10% マージン

## データフロー

```
ToolpathGenNode
  ├── toolpathResult ──→ Toolpath Preview
  └── outputResult   ──→ CNC Code
```

## ファイル構成

```
frontend/src/
  nodes/
    CncCodeNode.tsx          # CNC Code ノードコンポーネント
    ToolpathPreviewNode.tsx   # Toolpath Preview ノードコンポーネント
  components/
    CncCodePanel.tsx          # サイドパネル（コード表示）
    ToolpathPreviewPanel.tsx  # サイドパネル（パス可視化）
```

## バックエンド変更

- 新エンドポイント: **不要**（データは既にフロントに存在）
- `schemas.py`: `SbpGenResult` → `OutputResult` にリネーム、`format` フィールド追加
- `sbp_writer.py`: 戻り値キー `sbp_code` → `code`
- `main.py`: レスポンスモデル名の更新
- `nodes/toolpath_gen.py`: 戻り値の更新

## ノード登録

- `App.tsx`: nodeTypes に `cncCode`, `toolpathPreview` を追加
- `Sidebar.tsx`: ドラッグ可能なノードとして追加
- `types.ts`: `OutputResult` 型を追加、`SbpGenResult` を削除
