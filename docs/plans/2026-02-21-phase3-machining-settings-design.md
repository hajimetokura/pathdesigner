# Phase 3: 加工設定ノード — 設計ドキュメント

## 概要

React Flow上で加工パラメータを入力できるカスタムノード（MachiningSettingsNode）を実装する。
素材プリセット（YAML）をバックエンドから読み込み、バリデーション付きで設定を管理する。

## スコープ

- MachiningSettingsNode のみ（ポストプロセッサ設定は Phase 4-5）
- バックエンド: プリセットAPI + バリデーションAPI
- フロントエンド: 折りたたみセクション付きフォームUI

## アーキテクチャ

### バックエンド

**エンドポイント:**

1. `GET /api/presets` — プリセット一覧を返す
2. `POST /api/validate-settings` — 設定を検証し警告を返す

**プリセットファイル** (`backend/presets/materials.yaml`):

```yaml
presets:
  - id: plywood_12mm
    name: "合板 12mm"
    material: plywood
    operation_type: contour
    tool: { diameter: 6.35, type: endmill, flutes: 2 }
    feed_rate: { xy: 75, z: 25 }
    jog_speed: 200
    spindle_speed: 18000
    depth_per_pass: 6.0
    total_depth: 12.0
    direction: climb
    offset_side: outside
    tabs: { enabled: true, height: 3.0, width: 5.0, count: 4 }
```

**Pydanticスキーマ** (`schemas.py`):

```python
class Tool(BaseModel):
    diameter: float  # mm
    type: str        # "endmill" | "ballnose" | "v_bit"
    flutes: int

class FeedRate(BaseModel):
    xy: float  # mm/s
    z: float   # mm/s

class TabSettings(BaseModel):
    enabled: bool
    height: float  # mm
    width: float   # mm
    count: int

class MachiningSettings(BaseModel):
    operation_type: str  # "contour" | "pocket" | "drill" | "engrave"
    tool: Tool
    feed_rate: FeedRate
    jog_speed: float      # mm/s
    spindle_speed: int    # RPM
    depth_per_pass: float # mm
    total_depth: float    # mm
    direction: str        # "climb" | "conventional"
    offset_side: str      # "outside" | "inside" | "none"
    tabs: TabSettings

class PresetItem(BaseModel):
    id: str
    name: str
    material: str
    settings: MachiningSettings

class ValidateSettingsRequest(BaseModel):
    settings: MachiningSettings

class ValidateSettingsResponse(BaseModel):
    valid: bool
    settings: MachiningSettings
    warnings: list[str]
```

**バリデーションルール（Phase 3）:**

- `spindle_speed < 5000` → 警告
- `depth_per_pass > total_depth` → 警告
- `feed_rate.xy <= 0` or `feed_rate.z <= 0` → エラー
- `tool.diameter <= 0` → エラー
- 将来: AI/DB連携で素材別の推奨値チェック

### フロントエンド

**MachiningSettingsNode UI:**

```
┌──────────────────────────────┐
│  ⚙ Machining Settings       │
├──────────────────────────────┤
│ Preset: [合板 12mm ▼]        │
│                              │
│ ▼ Cutting                    │
│   Operation: [● contour]     │
│   Direction: [● climb]       │
│   Offset:    [● outside]     │
│                              │
│ ▼ Tool & Speed               │
│   Tool ∅:  [6.35] mm        │
│   Feed XY: [75] mm/s        │
│   Feed Z:  [25] mm/s        │
│   Jog:     [200] mm/s       │
│   Spindle: [18000] RPM      │
│                              │
│ ▶ Depth  (collapsed)         │
│ ▶ Tabs   (collapsed)         │
│                              │
│ ⚠ warnings here (if any)    │
│         [settings] ○         │
└──────────────────────────────┘
```

- プリセット選択 → 全フィールドに値を反映
- 各フィールドは個別に編集可能
- 値変更時に `POST /api/validate-settings` で検証
- 警告があればノード内に表示
- 設定は `data.machiningSettings` としてノードデータに保存

### データフロー

```
MachiningSettings (id=3)
  ↓ settings handle (edge)
ContourExtract (id=2)
  → tool_diameter, offset_side を upstream settings から読み取り
  → "Extract" クリック時に API call で使用
```

## ファイル変更一覧

| ファイル | 変更 | 内容 |
|---------|------|------|
| `backend/presets/materials.yaml` | 新規 | プリセット定義 |
| `backend/schemas.py` | 追加 | MachiningSettings 関連スキーマ |
| `backend/main.py` | 追加 | GET /api/presets, POST /api/validate-settings |
| `frontend/src/types.ts` | 追加 | MachiningSettings, Preset 型 |
| `frontend/src/api.ts` | 追加 | fetchPresets(), validateSettings() |
| `frontend/src/nodes/MachiningSettingsNode.tsx` | 新規 | UIコンポーネント |
| `frontend/src/App.tsx` | 更新 | nodeTypes登録、initialNodes更新 |

## 将来の拡張ポイント

- `POST /api/validate-settings` の中身をAI/DB連携に差し替え
- プリセットのCRUD（ユーザー定義プリセット）
- operation_type による動的フォーム切り替え（pocket, drill等）
