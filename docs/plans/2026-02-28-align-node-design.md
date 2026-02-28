# AlignNode 設計書

## 概要

組み立て状態の3D Compound（家具等）の各パーツを、CNC加工向けに「寝かせる」ノード。
upstream の brepResult が変わったら自動で処理し、再解析済みの brepResult を下流へ流す。

## データフロー

```
CodeNode/AiCadNode       AlignNode                  PlacementNode
[brepResult] ──edge──→  useUpstreamData
                         │ 自動で /api/align-parts
                         │ 各Solidを最大面→底面に回転
                         │ 新STEP + _analyze_solid
                         └→ [brepResult(再解析)] ──→  受け取り
```

## バックエンド

### エンドポイント: `POST /api/align-parts`

**入力:** `{ file_id: string }`

**処理:**
1. 保存済みSTEPからSolid群を読み込む
2. 各Solidに対して:
   - 全Faceの面積を計算
   - 最大面積のFaceの法線ベクトルを取得
   - その法線がZ軸(0,0,-1)を向くよう回転（最大面が底面になる）
   - Solidを回転 + Z=0に移動（底面接地）
3. 回転済みSolid群を新STEPとして保存（新file_id発行）
4. `_analyze_solid` で各Solidを再解析
5. 新しい `BrepImportResult` を返す

### 新規ファイル: `backend/nodes/align.py`

```python
def align_solids(solids: list[Solid]) -> list[Solid]:
    """各Solidを最大面が底になるよう回転し、Z=0に接地させる。"""

def _find_largest_face_normal(solid: Solid) -> Vector:
    """最大面積のFaceの法線を返す。"""

def _rotation_to_align_z(normal: Vector) -> RotationLike:
    """normalが-Zを向くような回転を計算。"""
```

## フロントエンド

### `AlignNode.tsx`

- **入力ハンドル:** `brep` (brepResult)
- **出力ハンドル:** `out` (brepResult — 再解析済み)
- **UI:** NodeShell + ステータス表示（パーツ数、処理中/完了/エラー）
- **自動実行:** `useEffect` で upstream 変更時に即API呼び出し

### 変更ファイル一覧

| ファイル | 変更 |
|---------|------|
| `backend/nodes/align.py` | 新規 — 回転ロジック |
| `backend/main.py` | `/api/align-parts` エンドポイント追加 |
| `frontend/src/nodes/AlignNode.tsx` | 新規 — パススルーノード |
| `frontend/src/App.tsx` | nodeTypes に登録 |
| `frontend/src/types.ts` | 必要なら型追加 |

## 設計判断

- **自動判定:** 最大面積のFaceを底面にする（板材家具なら厚み方向が自動的にZになる）
- **出力形式:** 既存の `brepResult` と同一形式 → PlacementNode/PreviewNode がそのまま使える
- **UI:** シンプル。結果はPreviewNodeまたはPlacementNodeで確認
- **手動オーバーライド:** v1では不要。必要になったら後で追加
