# PathDesigner — スケッチ入力機能 設計書

日付: 2026-02-28

## 1. 背景・動機

PathDesignerをマインクラフトやVRのように「誰でも熱狂できるものづくりプラットフォーム」に進化させる。
そのための第一歩として、**ブラウザ上で手描きスケッチ → AIが裏でbuild123d補助 → CNC加工**の体験を作る。

### ゴール

- 「描いたものが形になる」即時フィードバック体験
- iPad + Apple Pencil でも使える（タッチ/ペン対応）
- 複数スケッチの合成（Merge/Boolean）が既存パイプラインで動く
- 将来的にAIチューニング（プロンプトプロファイル）をコミュニティで共有可能にする

### 採用アプローチ

**SketchCanvas + Sketch2Brep の2ノード分離。**

理由：
- 編集（ステートフル）と変換（ステートレス）のライフサイクルが異なる
- SketchCanvasの出力を将来他のソース（PNG/SVG/DXF）と共通化できる
- 既存アーキテクチャの単一責務パターンと一致

---

## 2. システム構成

### データフロー

```
┌─────────────┐     sketch      ┌─────────────┐    brepResult    ┌──────────┐
│ SketchCanvas │────(画像+座標)──→│ Sketch2Brep │────────────────→│ 既存CAM  │
│              │                 │  (AI変換)    │                 │パイプライン│
│ ・手描きCanvas│                 │ ・Gemini認識 │                 └──────────┘
│ ・保存/読込  │                 │ ・Qwenコード │
│ ・iPad対応   │                 │ ・対話補助   │
└─────────────┘                 └─────────────┘
```

### 既存パイプラインとの統合

Sketch2Brepの出力は`brepResult`なので下流は変更不要：

```
SketchCanvas ── sketch ──→ Sketch2Brep ── brepResult ──→ Align
                                                       ──→ Merge
                                                       ──→ Placement
                                                       ──→ Preview (3D)
```

複数スケッチの組み合わせ：

```
SketchCanvas A ─→ Sketch2Brep ─→┐
                                  ├→ Merge ─→ Placement → ...
SketchCanvas B ─→ Sketch2Brep ─→┘
```

---

## 3. SketchCanvas ノード

### 出力データ型（`sketch`型・新規）

```typescript
interface SketchData {
  image_base64: string;       // Canvas→PNG (AI認識用)
  strokes: Stroke[];          // ストロークデータ (保存/復元用)
  canvas_width: number;
  canvas_height: number;
}

interface Stroke {
  points: [number, number][];  // [x, y] 座標列
  color: string;
  width: number;
  tool: 'pen' | 'eraser';
}
```

### UI構成

- **ノード上:** ミニサムネイル（最新スケッチの縮小版）+ 「編集」ボタン
- **パネル（SidePanel）:** フルサイズのスケッチキャンバス
  - ツール: ペン / 消しゴム / 矩形 / 円 / 元に戻す
  - 線の太さ・色
  - クリア / 保存 / 読み込み
  - タッチ + Pencil対応（`pointerEvents` API）

### ライブラリ

**perfect-freehand** — 筆圧対応スムーズストローク描画。tldraw作者のライブラリ、5KB。Canvas 2D APIの上に乗せる。

### 保存

ストロークデータを`node.data`に保持。ワークフロー保存時にJSON化（既存の仕組みに乗る）。

---

## 4. Sketch2Brep ノード

### 入出力

| 方向 | ハンドル名 | 型 |
|------|-----------|---|
| 入力 | sketch | sketch |
| 出力 | brepResult | geometry |

### 変換フロー

```
POST /api/sketch-to-brep (SSE)

Stage 1: Gemini Flash（マルチモーダル）
  画像 → 設計意図解析（「矩形の箱、角にR付き、厚み10mm」）

Stage 2: Qwen3 Coder
  設計意図 → build123dコード生成

Stage 3: 実行
  コード → STEP → BrepImportResult
```

既存の`llm_client.py`の2ステージパイプライン + `ai_cad.py`のサンドボックス実行を再利用。

### ノードUI

- **ノード上:** 変換ステータス（待機 / 変換中 / 完了）+ 「変換」ボタン
- **パネル:**
  - 生成されたbuild123dコード表示（確認用）
  - SSEでステージ進行表示（既存AI CADと同じ）
  - 対話補助チャット（Phase 4で追加）

### プロンプトプロファイル

スケッチ→3D変換用プロファイルを新設（`/ai-cad/profiles`に追加）：

```yaml
- id: sketch_cutout
  label: "スケッチ → 板切削"
  system_prompt: "ユーザーの手描きスケッチから、CNC切削用の2.5D形状を..."

- id: sketch_3d
  label: "スケッチ → 立体物"
  system_prompt: "ユーザーの手描きスケッチから、押し出しや回転体で..."
```

---

## 5. 型システム拡張

### 新規ハンドル型

| 型 | 色 | 用途 |
|---|---|---|
| `geometry` | 青 #4a90d9 | BREP・メッシュ |
| `settings` | 緑 #66bb6a | パラメータ |
| `toolpath` | オレンジ #ff9800 | ツールパス |
| `generic` | 灰 #9e9e9e | デバッグ等 |
| **`sketch`** | **ピンク #e91e63** | **スケッチデータ（新規）** |

接続ルール：同じtype同士のみ接続可能。

---

## 6. バックエンド変更

### 新規エンドポイント

| メソッド | パス | 説明 |
|---|---|---|
| `POST` | `/api/sketch-to-brep` | 画像+ストローク → AI変換 → brepResult（SSE） |

既存モジュールを再利用。新規モジュール不要。

---

## 7. 実装フェーズ

| Phase | 内容 | 依存 |
|-------|------|------|
| **1** | SketchCanvas ノード（Canvas + パネル + 保存） | なし |
| **2** | `/api/sketch-to-brep` エンドポイント + プロンプトプロファイル | 既存AI CADパイプライン |
| **3** | Sketch2Brep ノード（フロントエンド + SSE連携） | Phase 1, 2 |
| **4** | 対話補助（「厚みは？」チャット） | Phase 3 + 既存refineフロー |

Phase 1〜3 で最小限の「描く→形になる」体験が完成。Phase 4は精度改善。

---

## 8. 将来の拡張

- **PNG/画像アップロード** → Sketch2Brepへの別入力ソース
- **SVG/DXFインポート** → ベクターデータからの変換
- **プロファイル共有** → ユーザーがスケッチ→3D変換プロンプトを作成・公開
- **カスタムノード基盤** → スケッチノードをスキーマ駆動に移行（2026-02-26設計書参照）
