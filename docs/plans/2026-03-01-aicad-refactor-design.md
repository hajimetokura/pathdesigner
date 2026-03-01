# AiCad ノード統合リファクタリング設計

Date: 2026-03-01

## 背景

AiCadNode と Sketch2BrepNode が同一のLLMパイプライン・結果スキーマ・リファインメントロジックを使用しており、
~400-500行の重複コードが存在する。入力方法（テキスト vs スケッチ画像）だけが異なる。

## 設計方針

**入力と変換の完全分離。** 入力ノード（TextNode, SketchNode）と変換ノード（AiCadNode）に分ける。

## ノード構成

```
┌──────────────────┐   text    ┌─────────────────────────┐
│  TextNode         │─────────→│  AiCadNode               │    geometry
│  (純テキスト入力)    │          │  (統合AI変換エンジン)       │──────────→ [下流]
└──────────────────┘          │                          │
                              │  Profile:  [general ▼]   │
┌──────────────────┐  sketch  │  Coder:    [qwen ▼]     │
│  SketchNode       │─────────→│  [変換]                  │
│  (描画キャンバス)    │          │                   [geom]●│
└──────────────────┘          └─────────────────────────┘
```

## 各ノード仕様

### TextNode（新規 / Utility）

- **責務:** テキストプロンプト入力
- **UI:** textarea のみ
- **入力ハンドル:** なし
- **出力ハンドル:** `text`（dataType: `"text"`）
- **出力データ:** `{ prompt: string }`
- **ノード分類:** Utility（将来、他の変換ノードにも接続可能）

### SketchNode（既存 SketchCanvasNode をリネーム / Utility）

- **責務:** 手描きスケッチ入力
- **UI:** 描画キャンバス（perfect-freehand）、ペン/消しゴム、Undo/Clear
- **入力ハンドル:** なし
- **出力ハンドル:** `sketch`（dataType: `"sketch"`）
- **出力データ:** `{ image_base64, strokes, canvas_width, canvas_height }`
- **変更:** リネームのみ。内部ロジックは変更なし
- **ノード分類:** Utility（将来、SketchToContour等にも接続可能）

### AiCadNode（統合変換ノード）

- **責務:** テキスト/スケッチ/両方を受けてAI生成 → BREP出力
- **入力ハンドル:**
  - `text`（任意）— TextNode から
  - `sketch`（任意）— SketchNode から
  - 少なくとも一方が接続されている必要あり
- **出力ハンドル:** `geometry`（dataType: `"geometry"`）
- **出力データ:** `AiCadResult`（既存スキーマ）
- **UI:**
  - Profile ドロップダウン（general/2d/sketch_cutout/sketch_3d）
  - Coder model ドロップダウン（Sketch2Brepから移植）
  - 変換ボタン（接続状態に応じてラベル変更）
  - ステージ表示（designing/coding/reviewing/executing）
  - 詳細パネル（中間出力表示、Sketch2Brepから移植）
  - Refine ボタン → AiCadChatPanel
  - View Code ボタン → AiCadPanel

### Sketch2BrepNode — 廃止

AiCadNode に統合。

## バックエンド変更

### エンドポイント統合

**Before:**
- `POST /ai-cad/generate` — テキスト専用（image_base64はオプション）
- `POST /api/sketch-to-brep` — スケッチ専用（image_base64必須）

**After:**
- `POST /ai-cad/generate` — 統合エンドポイント
  - `image_base64` オプション（スケッチ接続時に送信）
  - `coder_model` オプション追加（ユーザー選択モデル）
  - `on_detail` コールバック追加（中間出力SSEイベント）
  - スケッチプリアンブル: `image_base64` があれば自動追加
- `POST /api/sketch-to-brep` — 廃止

### スキーマ変更

```python
# AiCadRequest に追加
class AiCadRequest(BaseModel):
    prompt: str
    image_base64: str | None = None
    model: str | None = None
    profile: str = "general"
    coder_model: str | None = None  # 追加
```

`SketchToBrepRequest` — 廃止。

## フロントエンド変更

### 新規: useAiCodegenStream フック

SSEストリーム解析とステージ管理を共通化:

```typescript
function useAiCodegenStream() {
  // 状態: status, stage, details, result, error
  // execute(prompt, imageBase64?, profile?, coderModel?)
  // reset()
}
```

**統合対象:**
- `generateAiCadStream()` の呼び出しロジック
- `sketchToBrepStream()` の呼び出しロジック
- 両ノードの status/stage/error/result 状態管理

### 新規: parseAiEventStream ユーティリティ

3箇所（generate/refine/sketch）に散在するSSE解析を統合。

### ファイル変更一覧

| ファイル | 変更 |
|---------|------|
| `frontend/src/nodes/TextNode.tsx` | 新規作成 |
| `frontend/src/nodes/SketchCanvasNode.tsx` | リネーム → `SketchNode.tsx` |
| `frontend/src/nodes/AiCadNode.tsx` | text/sketch入力ハンドル追加、内蔵textarea削除、coder_model追加 |
| `frontend/src/nodes/Sketch2BrepNode.tsx` | 削除 |
| `frontend/src/hooks/useAiCodegenStream.ts` | 新規作成 |
| `frontend/src/api.ts` | `sketchToBrepStream` 削除、`generateAiCadStream` に coder_model 追加 |
| `frontend/src/App.tsx` | ノード登録更新 |
| `frontend/src/types.ts` | TextNode 型追加 |
| `backend/main.py` | `/ai-cad/generate` 拡張、`/api/sketch-to-brep` 削除 |
| `backend/schemas.py` | `AiCadRequest` 拡張、`SketchToBrepRequest` 削除 |
| `backend/tests/` | テスト更新 |

## 変更しないもの

- `SketchCanvas` コンポーネント（描画ロジック）
- `LLMClient.generate_pipeline`（既に汎用的）
- `AiCadChatPanel`（リファインメント UI）
- `AiCadPanel`（コードエディタ）
- `GenerationDB`（保存ロジック）
- その他の既存ノード

## 将来の拡張ポイント

- **SketchToContour:** SketchNode → 描画パスをそのまま加工パスに変換（AiCad不要）
- **TextNode汎用化:** AI以外のノードへのテキスト入力（ConfigNode等）
- **ImageNode:** 写真入力 → AiCadNode接続（SketchNodeと同じsketchハンドル型を流用可）
