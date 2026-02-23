# build123d API チートシート（LLMシステムプロンプト用）

> build123d v0.10.x — Python CAD (BREP) フレームワーク（OpenCascade ベース）
> 公式ドキュメント: https://build123d.readthedocs.io/en/latest/

```python
from build123d import *
from ocp_vscode import show  # VSCode ビューア
```

---

## 1. 二つのAPI スタイル

### Builder mode（コンテキストマネージャ）
```python
with BuildPart() as my_part:
    with BuildSketch() as sk:
        Circle(10)
    extrude(amount=5)
result = my_part.part  # 最終結果を取得
```

### Algebra mode（演算子ベース）
```python
sk = Circle(10)
result = extrude(sk, amount=5)
```

**推奨**: Builder mode はネスト構造で状態管理が楽。Algebra mode は短い処理に向く。

---

## 2. Boolean 操作（Mode）

build123d に独立した Boolean 関数はない。各オブジェクト/オペレーションの `mode` パラメータで制御する。

| Mode | 意味 | Algebra 演算子 | 説明 |
|------|------|---------------|------|
| `Mode.ADD` | 和（union） | `+` / `+=` | デフォルト。形状を結合 |
| `Mode.SUBTRACT` | 差（cut） | `-` / `-=` | 形状を切り取り |
| `Mode.INTERSECT` | 積（intersection） | `&` | 重なる部分のみ残す |
| `Mode.REPLACE` | 置換 | — | ビルダーの形状を完全に置き換え |
| `Mode.PRIVATE` | 非干渉 | — | ビルダーに影響しない（補助形状用） |

### 使用例
```python
# Builder mode
with BuildPart() as p:
    Box(20, 20, 10)
    Cylinder(radius=5, height=10, mode=Mode.SUBTRACT)  # 穴を開ける

# Algebra mode
result = Box(20, 20, 10) - Cylinder(radius=5, height=10)
result = Box(20, 20, 10) & Sphere(radius=12)  # 交差
```

### 注意: Hole のデフォルトは Mode.SUBTRACT
```python
Hole(radius=3)              # デフォルトで SUBTRACT
Hole(radius=3, depth=5)     # 深さ指定可能
CounterBoreHole(radius=3, counter_bore_radius=5, counter_bore_depth=2, depth=10)
CounterSinkHole(radius=3, counter_sink_radius=6, depth=10)
```

---

## 3. ビルダー構造

| ビルダー | 次元 | 結果属性 | 用途 |
|---------|------|---------|------|
| `BuildLine()` | 1D | `.line` | ワイヤー/エッジ（パス作成） |
| `BuildSketch(plane)` | 2D | `.sketch` | 面（Face）の作成 |
| `BuildPart()` | 3D | `.part` | ソリッドの作成 |

ネスト構造:
```python
with BuildPart() as part:                    # 3D
    with BuildSketch(Plane.XY) as sketch:    # 2D（on a Plane or Face）
        with BuildLine() as line:            # 1D
            Polyline(...)
        make_face()                          # 線→面に変換
    extrude(amount=10)                       # 面→ソリッドに押し出し
```

---

## 4. オブジェクト一覧

### 1D オブジェクト（BuildLine / Curve）
| オブジェクト | 主要パラメータ | 説明 |
|------------|--------------|------|
| `Line(pt1, pt2)` | 2点 | 直線 |
| `Polyline(*pts)` | 複数点 | 折れ線 |
| `FilletPolyline(*pts, radius=r)` | 複数点 + 半径 | 角を丸めた折れ線 |
| `Spline(*pts, tangents=...)` | 制御点, 接線 | スプライン曲線 |
| `Bezier(*pts)` | 制御点 | ベジエ曲線 |
| `CenterArc(center, radius, start_angle, arc_size)` | 中心, 半径, 角度 | 円弧 |
| `ThreePointArc(pt1, pt2, pt3)` | 3点 | 3点を通る円弧 |
| `RadiusArc(pt1, pt2, radius)` | 2点 + 半径 | 半径指定の円弧 |
| `SagittaArc(pt1, pt2, sagitta)` | 2点 + 矢高 | 矢高指定の円弧 |
| `TangentArc(pt1, tangent, pt2)` | 始点, 接線, 終点 | 接線指定の円弧 |
| `JernArc(start, tangent, radius, arc_size)` | 始点, 接線, 半径, 角度 | Jern式円弧 |
| `PolarLine(start, length, angle=a)` | 始点, 長さ, 角度 | 極座標直線 |
| `PolarLine(start, length, direction=v)` | 始点, 長さ, 方向 | 方向指定直線 |
| `Helix(pitch, height, radius)` | ピッチ, 高さ, 半径 | らせん |
| `EllipticalCenterArc(center, x_radius, y_radius, ...)` | 中心, 半径x, 半径y | 楕円弧 |

### 2D オブジェクト（BuildSketch / Sketch）
| オブジェクト | 主要パラメータ | 説明 |
|------------|--------------|------|
| `Circle(radius)` | 半径 | 円 |
| `Ellipse(x_radius, y_radius)` | x半径, y半径 | 楕円 |
| `Rectangle(width, height)` | 幅, 高さ | 矩形 |
| `RectangleRounded(width, height, radius)` | 幅, 高さ, 角R | 角丸矩形 |
| `RegularPolygon(radius, side_count)` | 半径, 辺数 | 正多角形 |
| `Polygon(*pts)` | 頂点リスト | 任意多角形 |
| `Trapezoid(width, height, left_angle, right_angle)` | 幅, 高さ, 左右角度 | 台形 |
| `Triangle(...)` | 辺/角度 | 三角形 |
| `SlotOverall(width, height)` | 全長, 高さ | スロット（全体寸法） |
| `SlotCenterToCenter(center_separation, height)` | 中心間距離, 高さ | スロット（中心間） |
| `SlotArc(arc, height)` | 円弧, 高さ | 円弧スロット |
| `Text(txt, font_size, ...)` | 文字列, サイズ | テキスト |

**共通パラメータ**: `rotation=0`, `align=(Align.CENTER, Align.CENTER)`, `mode=Mode.ADD`

### 3D オブジェクト（BuildPart / Part）
| オブジェクト | 主要パラメータ | 説明 |
|------------|--------------|------|
| `Box(length, width, height)` | 長さ, 幅, 高さ | 直方体 |
| `Cylinder(radius, height)` | 半径, 高さ | 円柱 |
| `Cone(bottom_radius, top_radius, height)` | 下半径, 上半径, 高さ | 円錐台 |
| `Sphere(radius)` | 半径 | 球 |
| `Torus(major_radius, minor_radius)` | 主半径, 副半径 | トーラス |
| `Wedge(xsize, ysize, zsize, xmin, zmin, xmax, zmax)` | 各軸寸法 | 楔形 |
| `Hole(radius, depth=None)` | 半径, 深さ | 穴（デフォルト SUBTRACT） |
| `CounterBoreHole(radius, counter_bore_radius, counter_bore_depth, depth)` | 各寸法 | ザグリ穴 |
| `CounterSinkHole(radius, counter_sink_radius, depth)` | 各寸法 | 皿穴 |

**共通パラメータ**: `rotation=Rotation(0,0,0)`, `align=(Align.CENTER, Align.CENTER, Align.CENTER)`, `mode=Mode.ADD`

---

## 5. オペレーション一覧

### 汎用（1D/2D/3D 共通）
| オペレーション | 構文 | 説明 |
|-------------|------|------|
| `add(obj)` | 外部オブジェクトをビルダーに追加 | import等に使用 |
| `mirror(about=Plane.YZ)` | 鏡像 | Plane 指定で反転 |
| `offset(amount=d)` | オフセット | 2D: 輪郭拡大/縮小, 3D: シェル化 |
| `scale(by=factor)` | スケール | 均一/非均一 |
| `split(bisect_by=Plane(...))` | 分割 | Keep.TOP / BOTTOM / BOTH |
| `project(obj)` | 投影 | 3D→2D への投影 |

### 2D 専用（BuildSketch）
| オペレーション | 構文 | 説明 |
|-------------|------|------|
| `make_face(edges)` | エッジ→面変換 | 閉じたワイヤーから Face を作成 |
| `make_hull(edges)` | 凸包面作成 | エッジの凸包から Face を作成 |
| `chamfer(vertices, length)` | 面取り | 2D の頂点を面取り |
| `fillet(vertices, radius)` | 丸め | 2D の頂点を丸め |
| `full_round(edge)` | 完全丸め | エッジを最大半径で丸め |
| `trace(lines)` | 線をなぞる | 線に沿って面を生成 |
| `sweep(path)` | スイープ | 2D でパスに沿って面を生成 |

### 3D 専用（BuildPart）
| オペレーション | 構文 | 説明 |
|-------------|------|------|
| `extrude(amount=d)` | 押し出し | 面をソリッドに |
| `extrude(amount=d, taper=angle)` | テーパー押し出し | 角度付き押し出し |
| `extrude(until=Until.NEXT, target=obj)` | 条件付き押し出し | 対象面まで押し出し |
| `revolve(axis=Axis.Z, revolution_arc=360)` | 回転体 | 面を軸回りに回転 |
| `loft([section1, section2, ...])` | ロフト | 複数断面を接続 |
| `sweep(path=wire)` | スイープ | パスに沿って掃引 |
| `fillet(edges, radius)` | フィレット | エッジを丸め |
| `chamfer(edges, length)` | 面取り | エッジを面取り |
| `chamfer(edges, length, length2)` | 非対称面取り | 2辺異なる面取り |
| `offset(amount=-t, openings=faces)` | シェル化 | 薄肉化。openings で開口面指定 |
| `draft(faces, axis, angle)` | 抜き勾配 | 金型用テーパー |
| `section(section_by=Plane.XZ)` | 断面 | 指定平面で断面取得 |
| `make_brake_formed(thickness, widths)` | 板金折り曲げ | 板金パーツ作成 |

---

## 6. 位置決め・変換

### 基本的な位置指定
```python
# Pos: 平行移動（Location のサブクラス）
Pos(x, y, z)
Pos(X=5)              # 名前付きで一軸だけ指定可

# Rot: 回転（Location のサブクラス）
Rot(x_angle, y_angle, z_angle)
Rot(Z=45)             # Z軸周りに45度

# Rotation: 3D 回転（Rot のエイリアス的に使用）
Rotation(10, 20, 30)
```

### Algebra mode での配置
```python
# Plane * Pos/Rot * Object で位置変換チェーン
result = Plane.XZ * Pos(X=5) * Rectangle(10, 10)
result = Pos(10, 0, 5) * Rot(Z=45) * Box(5, 5, 5)
```

### Builder mode でのロケーション
```python
# Locations: 指定した位置に子オブジェクトを配置
with Locations((0, 0), (10, 0), (20, 0)):
    Circle(3)  # 3箇所に円を配置

# GridLocations: グリッド配列
with GridLocations(x_spacing, y_spacing, x_count, y_count):
    Hole(radius=2)

# PolarLocations: 極座標配列
with PolarLocations(radius, count, start_angle=0, angular_range=360):
    CounterBoreHole(...)

# HexLocations: ハニカム配列
with HexLocations(apothem, x_count, y_count):
    RegularPolygon(radius=r, side_count=6)
```

---

## 7. 平面（Plane）

```python
Plane.XY    # デフォルト（Z が法線）
Plane.XZ    # Y が法線
Plane.YZ    # X が法線
Plane.front / .back / .left / .right / .top / .bottom

# Face から Plane を作成
Plane(some_face)

# オフセット
Plane.XY.offset(10)   # Z=10 の平面

# カスタム平面
Plane(origin=(0, 0, 5), x_dir=(1, 0, 0), z_dir=(0, 0, 1))
```

### BuildSketch への Plane / Face 指定
```python
with BuildSketch(Plane.XZ) as sk:     # XZ 平面上にスケッチ
    ...

with BuildSketch(part.faces().sort_by(Axis.Z)[-1]) as sk:  # 上面にスケッチ
    ...
```

---

## 8. セレクタ（Topology Selection）

### 基本メソッド
```python
part.vertices()    # 全頂点
part.edges()       # 全エッジ
part.wires()       # 全ワイヤー
part.faces()       # 全面
part.solids()      # 全ソリッド
```

### Builder mode での Select
```python
part.edges(Select.ALL)    # 全エッジ（デフォルト）
part.edges(Select.LAST)   # 最後のオペレーションで追加されたエッジ
part.edges(Select.NEW)    # 最後のオペレーションで新規作成されたエッジ
```

### フィルタリング（ShapeList メソッド）
```python
# filter_by: 条件でフィルタ
edges.filter_by(Axis.Z)              # Z軸に平行なエッジ
faces.filter_by(GeomType.PLANE)      # 平面のみ
faces.filter_by(GeomType.CYLINDER)   # 円筒面のみ
edges.filter_by(GeomType.CIRCLE)     # 円弧エッジのみ

# filter_by_position: 位置でフィルタ
vertices.filter_by_position(Axis.Z, 5, 10)  # Z=5〜10の頂点

# sort_by: ソート
faces.sort_by(Axis.Z)       # Z座標でソート（リスト）
faces.sort_by(Axis.Z)[-1]   # 最上面
faces.sort_by(Axis.Z)[0]    # 最下面
faces.sort_by().last         # SortBy.Z のショートカット
faces.sort_by().first

# group_by: グループ化
edges.group_by(Axis.Z)       # Z座標でグループ分け（リストのリスト）
edges.group_by(Axis.Z)[-1]   # 最上部のエッジグループ
edges.group_by(Axis.Z)[0]    # 最下部のエッジグループ

# lambda でカスタムフィルタ
edges.filter_by(lambda e: e.length == 2)
faces.filter_by(lambda f: f.radius == 5)
```

### GeomType 一覧
`BEZIER`, `BSPLINE`, `CIRCLE`, `CONE`, `CYLINDER`, `ELLIPSE`, `EXTRUSION`,
`HYPERBOLA`, `LINE`, `OFFSET`, `OTHER`, `PARABOLA`, `PLANE`, `REVOLUTION`, `SPHERE`, `TORUS`

### セレクタの組み合わせ（ShapeList 演算）
```python
# 差分セレクタ
new_edges = part.edges() - previous_edges   # 新しく追加されたエッジ

# チェーン
part.faces().filter_by(GeomType.CYLINDER).filter_by(lambda f: f.radius == 3)
part.edges().filter_by(Axis.Z).group_by(Axis.Z)[-1]
```

---

## 9. 演算子

### 位置演算子（Edge / Wire）
```python
line @ 0      # position_at(0) — 始点の座標 (Vector)
line @ 1      # position_at(1) — 終点の座標
line @ 0.5    # 中間点の座標（0〜1 で正規化）

line % 0      # tangent_at(0) — 始点の接線方向 (Vector)
line % 1      # tangent_at(1) — 終点の接線方向

line ^ 0.5    # パスの中間点での平面 (Plane)
```

### 形状演算子
```python
# Boolean（Algebra mode）
a + b         # 和（union）
a - b         # 差（subtraction）
a & b         # 積（intersection）

# 位置変換
Plane * obj        # Plane 上に配置
Location * obj     # Location で移動
Pos(5,0,0) * obj   # 平行移動
Rot(Z=45) * obj    # 回転

# 複数配置
locations * obj    # 全 Location に配置（リスト展開）
```

---

## 10. よくあるパターン集

### パターン1: 基本的な箱＋穴
```python
with BuildPart() as part:
    Box(50, 30, 10)
    Cylinder(radius=5, height=10, mode=Mode.SUBTRACT)
```

### パターン2: スケッチ→押し出し
```python
with BuildPart() as part:
    with BuildSketch():
        Rectangle(50, 30)
        Circle(5, mode=Mode.SUBTRACT)  # 穴
    extrude(amount=10)
```

### パターン3: 線→面→ソリッド
```python
with BuildPart() as part:
    with BuildSketch() as sk:
        with BuildLine():
            l1 = Line((0, 0), (50, 0))
            l2 = Line((50, 0), (50, 30))
            l3 = Line((50, 30), (0, 30))
            l4 = Line((0, 30), (0, 0))
        make_face()
    extrude(amount=10)
```

### パターン4: プロファイル回転体
```python
with BuildPart() as vase:
    with BuildSketch(Plane.XZ):
        with BuildLine():
            Polyline((0, 0), (10, 0), (12, 30), (8, 50), (10, 60))
            Line((10, 60), (0, 60))
            Line((0, 60), (0, 0))
        make_face()
    revolve(axis=Axis.Z)
    offset(amount=-1, openings=vase.faces().sort_by(Axis.Z)[-1])  # シェル化
```

### パターン5: スイープ（パスに沿った掃引）
```python
with BuildPart() as pipe:
    with BuildLine() as path:
        Spline((0,0,0), (10,0,5), (20,0,0))
    with BuildSketch(path.line ^ 0):  # パス始点の平面
        Circle(2)
    sweep()
```

### パターン6: ロフト（断面接続）
```python
with BuildPart() as part:
    with BuildSketch(Plane.XY):
        Circle(10)
    with BuildSketch(Plane.XY.offset(20)):
        Rectangle(15, 15)
    loft()
```

### パターン7: 面上にフィーチャー追加
```python
with BuildPart() as part:
    Box(50, 50, 10)
    top_face = part.faces().sort_by(Axis.Z)[-1]
    with BuildSketch(top_face):
        with GridLocations(20, 20, 2, 2):
            Circle(3)
    extrude(amount=-10, mode=Mode.SUBTRACT)  # 穴を貫通
```

### パターン8: フィレットとシャンファーの選択的適用
```python
with BuildPart() as part:
    Box(50, 50, 10)
    # 上面のエッジだけフィレット
    fillet(part.edges().group_by(Axis.Z)[-1], radius=2)
    # Z軸方向のエッジだけシャンファー
    chamfer(part.edges().filter_by(Axis.Z), length=1)
```

### パターン9: シェル化（薄肉化）
```python
with BuildPart() as box:
    Box(50, 30, 20)
    top = box.faces().sort_by(Axis.Z)[-1]
    offset(amount=-2, openings=top)  # 上面を開口して薄肉化
```

### パターン10: Algebra mode での複合モデル
```python
base = Box(50, 30, 10)
base -= Pos(0, 0, 0) * Cylinder(radius=5, height=10)
base = fillet(base.edges().group_by(Axis.Z)[-1], radius=2)

# 穴の円形配列
top = Plane(base.faces().sort_by(Axis.Z)[-1])
base -= top * PolarLocations(15, 6) * Hole(radius=2, depth=10)
```

---

## 11. エクスポート / インポート

```python
# エクスポート
export_step(part, "output.step")
export_stl(part, "output.stl")
export_svg(part, "output.svg")

# インポート
imported = import_step("input.step")
imported = import_stl("input.stl")
svg_faces = import_svg("drawing.svg")

# Mesher（STL読み込み）
mesher = Mesher()
solid = mesher.read("model.stl")[0]
```

---

## 12. Enums リファレンス

| Enum | 値 |
|------|-----|
| `Align` | MIN, CENTER, MAX |
| `Mode` | ADD, SUBTRACT, INTERSECT, REPLACE, PRIVATE |
| `Select` | ALL, LAST, NEW |
| `Kind` | ARC, INTERSECTION, TANGENT |
| `Keep` | TOP, BOTTOM, BOTH |
| `Side` | LEFT, RIGHT, BOTH |
| `Until` | NEXT, LAST, PREVIOUS, FIRST |
| `Transition` | RIGHT, ROUND, TRANSFORMED |
| `FontStyle` | REGULAR, BOLD, ITALIC |
| `GeomType` | LINE, CIRCLE, ELLIPSE, PLANE, CYLINDER, CONE, SPHERE, TORUS, BEZIER, BSPLINE, ... |
| `SortBy` | X, Y, Z, LENGTH, RADIUS, AREA, VOLUME, DISTANCE |
| `CenterOf` | GEOMETRY, MASS, BOUNDING_BOX |

---

## 13. ベストプラクティス

1. **1D → 2D → 3D の順に作業**: 線→面→ソリッド。低次元から始める
2. **フィレット/シャンファーは最後に適用**: 形状の複雑化を避ける
3. **パラメトリック設計**: 寸法を変数に入れて冒頭で定義する
4. **Select.LAST を活用**: 直前の操作で追加されたエッジを簡単に選択
5. **`* MM` で単位を明示**: `10 * MM` のように書くと意図が明確
6. **大量の穴は 2D で作成**: Face(perimeter, holes) で Wire として穴を渡すと、3D Boolean より大幅に高速
7. **offset の self-intersection に注意**: 交差するとエラーになる

---

## 14. AI CAD プロファイル

システムプロンプトは用途別プロファイルに分かれている:
- `general` — 汎用（全形状対応）
- `furniture` — 家具・板材（CNC板加工）
- `flat` — 平面加工・彫刻（テキスト・ポケット・切り抜き）
- `3d` — 3D造形（revolve, loft, sweep, shell）

詳細は `backend/llm_client.py` の `_PROFILES` を参照。
