# V1 UI整理 — デザインドキュメント

## 概要

V1完成に向けてUIの一貫性と使いやすさを改善する。主な変更は4つ：

1. タブ付き単一サイドパネルの導入
2. ノードサイズ・インタラクションの統一
3. PostProcessorノードのコンパクト化
4. Stockノードの簡素化（1マテリアル固定）

## 1. タブ付き単一サイドパネル

### 現状の問題

各ノードが独立した`position: fixed`パネルをReact Portalで生成。複数パネルが同じ位置（right: 0, z-index: 100）に表示され重なる。

### 設計

- `App.tsx`レベルで統一パネルコンテナ（`SidePanel`コンポーネント）を管理
- パネル幅: 480px固定
- タブバー: アイコン + ラベル
- タブの`×`ボタンで個別に閉じる
- 全タブ閉じるとパネル非表示 → キャンバスがフル幅に
- ノード操作（ボタンクリック等）で該当タブをアクティブ化（既にあれば切替、なければ追加）

### タブ一覧

| タブID | ラベル | 対応ノード | パネルコンテンツ |
|--------|--------|-----------|----------------|
| brep-3d | 3D View | BrepImportNode | 3Dメッシュビューア |
| placement | Placement | PlacementNode | 配置エディタ（ドラッグ＆ドロップ） |
| operation | Operations | OperationNode | 工具設定カード一覧 |
| postproc | Post Proc | PostProcessorNode | Safe Z, Tool#, Home X/Y, Warmup |
| preview | Preview | ToolpathPreviewNode | ツールパスプレビュー（大） |
| cnc-code | CNC Code | CncCodeNode | シンタックスハイライト付きコード表示 |

### 状態管理

```typescript
type TabState = {
  id: string;
  label: string;
  nodeId: string;  // 対応するReact Flowノード
};

// App.tsxレベルで管理
const [openTabs, setOpenTabs] = useState<TabState[]>([]);
const [activeTabId, setActiveTabId] = useState<string | null>(null);
```

ノードからタブを開く関数をReact Flowのデータとして各ノードに渡す。

## 2. ノードサイズ・インタラクションの統一

### 設計方針

- ビュー系ノードを除き、全ノードの幅を200px固定
- ノード内はサマリー情報のみ。詳細編集はタブパネルで行う
- 例外: Stock（インライン編集維持）、Debug（現状維持）

### ノード別仕様

| ノード | 幅 | 高さ | ノード内表示 | タブパネル |
|--------|-----|------|-------------|-----------|
| BrepImport | 200px | ~100px | ステータス + オブジェクト数 + "View 3D"ボタン | 3Dビュー |
| Stock | 200px | ~130px | Label + W/D/T入力（インライン編集） | なし |
| Placement | 200px | ~100px | 2Dサムネイル + パーツ数 | 配置エディタ |
| Operation | 200px | ~100px | サマリー（検出/有効数）+ "Edit"ボタン | 工具設定 |
| PostProc | 200px | ~80px | マシンドロップダウン + Bed + Format | 詳細設定 |
| ToolpathGen | 200px | ~80px | Generateボタン + 結果サマリー | なし |
| Preview | 200px | ~130px | 2Dサムネイル + "Click to enlarge" | プレビュー |
| CncCode | 200px | ~60px | フォーマット + 行数 + Export/Viewボタン | コード |
| Debug | 220-360px | 可変 | JSON表示（現状維持） | なし |

## 3. PostProcessorノードのコンパクト化

### 現状

Machine展開セクション内にSafe Z、Tool#、Home X/Y、Warmupなど全フィールドを表示。

### 変更後

```
┌───────────────────┐
│ Post Processor     │
├───────────────────┤
│ [▼ ShopBot     ]  │  ← マシンタイプ ドロップダウン
│ Bed: 2440x1220mm  │  ← 読み取り専用テキスト
│ Format: SBP       │  ← 読み取り専用テキスト
└───────────────────┘
```

- マシンタイプ選択はノード内ドロップダウン
- Bed/Formatはマシン選択に連動して自動表示
- Safe Z、Tool#、Home X/Y、Warmup → タブパネルの「Post Proc」タブで編集

## 4. Stockノードの簡素化

### 変更

- 複数マテリアル機能を削除（V2送り）
- 「+ Add Material」ボタン削除
- 折りたたみUI削除 → 常時表示の4フィールド
- デフォルト値: Label="Stock", W=1820, D=910, T=24 (3x6サイズ横向き)

### 変更後

```
┌───────────────────┐
│ Stock              │
├───────────────────┤
│ Label: [Stock    ] │
│ W: [1820] D:[910]  │
│ T: [24]            │
└───────────────────┘
```

## 実装の影響範囲

### 新規作成
- `SidePanel.tsx` — タブ付きパネルコンテナ
- `usePanelTabs.ts` — タブ状態管理フック（またはApp.tsx内で直接管理）

### 大幅変更
- `App.tsx` — パネル管理をリフト、ノードへの関数渡し
- `PostProcessorNode.tsx` — コンパクト化、詳細をパネル分離
- `StockNode.tsx` — 複数マテリアル削除、デフォルト変更

### 中程度の変更
- `BrepImportNode.tsx` — ポータル→タブパネル呼び出しに変更
- `PlacementNode.tsx` — 同上
- `OperationNode.tsx` — 同上
- `ToolpathPreviewNode.tsx` — 同上
- `CncCodeNode.tsx` — 同上

### パネルコンポーネント（移動のみ）
- `BrepImportPanel.tsx` — ポータルを使わない純粋コンポーネント化
- `PlacementPanel.tsx` — 同上
- `OperationDetailPanel.tsx` — 同上
- `ToolpathPreviewPanel.tsx` — 同上
- `CncCodePanel.tsx` — 同上
- 新規: `PostProcessorPanel.tsx` — Safe Z等の詳細設定UI

### 変更不要
- `DebugNode.tsx`
- `ToolpathGenNode.tsx`
- `LabeledHandle.tsx`
- バックエンド全般
