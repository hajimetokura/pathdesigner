// frontend/src/lib/build123dCompletions.ts
import { CompletionContext, type Completion } from "@codemirror/autocomplete";

// build123d の主要シンボル一覧（llm_client.py のAPIリファレンスから網羅）
const BUILD123D_COMPLETIONS: Completion[] = [
  // ── 3D プリミティブ ──
  { label: "Box", type: "class", detail: "Box(length, width, height)", info: "直方体。デフォルト中心配置。" },
  { label: "Cylinder", type: "class", detail: "Cylinder(radius, height)", info: "円柱。" },
  { label: "Sphere", type: "class", detail: "Sphere(radius)", info: "球。" },
  { label: "Cone", type: "class", detail: "Cone(bottom_radius, top_radius, height)", info: "円錐。top_radius=0で尖り。" },
  { label: "Torus", type: "class", detail: "Torus(major_radius, minor_radius)", info: "トーラス（ドーナツ）。" },
  { label: "Wedge", type: "class", detail: "Wedge(xsize, ysize, zsize, ...)", info: "ウェッジ形状。" },
  { label: "Hole", type: "class", detail: "Hole(radius, depth)", info: "BuildPart内で使用する穴。" },
  { label: "CounterBoreHole", type: "class", detail: "CounterBoreHole(radius, counter_bore_radius, counter_bore_depth, depth)", info: "ざぐり穴。" },
  { label: "CounterSinkHole", type: "class", detail: "CounterSinkHole(radius, counter_sink_radius, depth)", info: "皿穴。" },
  { label: "Compound", type: "class", detail: "Compound", info: "複数ソリッドのコンテナ。" },
  { label: "Part", type: "class", detail: "Part", info: "ソリッドパーツ型。" },
  { label: "Solid", type: "class", detail: "Solid", info: "ソリッド基底クラス。" },

  // ── 2D スケッチ ──
  { label: "Rectangle", type: "class", detail: "Rectangle(width, height)", info: "矩形スケッチ。" },
  { label: "RectangleRounded", type: "class", detail: "RectangleRounded(width, height, radius)", info: "角丸矩形。" },
  { label: "Circle", type: "class", detail: "Circle(radius)", info: "円スケッチ。" },
  { label: "Ellipse", type: "class", detail: "Ellipse(x_radius, y_radius)", info: "楕円スケッチ。" },
  { label: "Polygon", type: "class", detail: "Polygon(*pts)", info: "多角形スケッチ。" },
  { label: "RegularPolygon", type: "class", detail: "RegularPolygon(radius, side_count)", info: "正多角形。" },
  { label: "Text", type: "class", detail: 'Text("string", font_size)', info: "テキスト輪郭スケッチ。" },
  { label: "SlotOverall", type: "class", detail: "SlotOverall(width, height)", info: "スロット（長丸）スケッチ。" },
  { label: "Trapezoid", type: "class", detail: "Trapezoid(width, height, left_side_angle)", info: "台形スケッチ。" },

  // ── 1D ライン ──
  { label: "Line", type: "class", detail: "Line(start, end)", info: "直線セグメント。" },
  { label: "Polyline", type: "class", detail: "Polyline(*pts)", info: "折れ線。" },
  { label: "Spline", type: "class", detail: "Spline(*pts)", info: "スプライン曲線。" },
  { label: "CenterArc", type: "class", detail: "CenterArc(center, radius, start_angle, arc_size)", info: "中心円弧。" },
  { label: "RadiusArc", type: "class", detail: "RadiusArc(start_point, end_point, radius)", info: "半径指定円弧。" },
  { label: "TangentArc", type: "class", detail: "TangentArc(*pts)", info: "接線円弧。" },

  // ── コンテキストマネージャ ──
  { label: "BuildPart", type: "class", detail: "with BuildPart() as bp:", info: "ソリッド構築コンテキスト。結果は bp.part。" },
  { label: "BuildSketch", type: "class", detail: "with BuildSketch(plane) as sk:", info: "スケッチ構築コンテキスト。結果は sk.sketch。" },
  { label: "BuildLine", type: "class", detail: "with BuildLine() as bl:", info: "ライン構築コンテキスト。閉ループ必須。" },

  // ── 操作関数 ──
  { label: "extrude", type: "function", detail: "extrude(amount=d, mode=Mode.ADD)", info: "スケッチを押し出し。mode=Mode.SUBTRACTで切り取り。" },
  { label: "revolve", type: "function", detail: "revolve(axis=Axis.Z, revolution_arc=360)", info: "スケッチを回転体化。" },
  { label: "loft", type: "function", detail: "loft()", info: "複数スケッチをロフト。" },
  { label: "sweep", type: "function", detail: "sweep(path)", info: "パスに沿ってスイープ。" },
  { label: "fillet", type: "function", detail: "fillet(edge_list, radius)", info: "フィレット。BuildPart内でのみ有効。" },
  { label: "chamfer", type: "function", detail: "chamfer(edge_list, length)", info: "面取り。BuildPart内でのみ有効。" },
  { label: "offset", type: "function", detail: "offset(amount=-t, openings=False)", info: "ソリッドをオフセット（シェル化）。" },
  { label: "mirror", type: "function", detail: "mirror(about=Plane.YZ)", info: "平面でミラーコピー。" },
  { label: "make_face", type: "function", detail: "make_face()", info: "ワイヤから面を生成。" },
  { label: "scale", type: "function", detail: "scale(by=factor)", info: "スケール変換。" },

  // ── 位置・変換 ──
  { label: "Pos", type: "class", detail: "Pos(x, y, z)", info: "位置変換。Pos(10,0,0) * shape で配置。" },
  { label: "Rot", type: "class", detail: "Rot(x_deg, y_deg, z_deg)", info: "回転変換。" },
  { label: "Location", type: "class", detail: "Location((x,y,z), (ax,ay,az))", info: "位置と向きを指定。" },
  { label: "Align", type: "class", detail: "Align.MIN / Align.CENTER / Align.MAX", info: "配置基準点。" },

  // ── パターン配置 ──
  { label: "Locations", type: "class", detail: "Locations([(x1,y1), (x2,y2), ...])", info: "複数位置に配置。" },
  { label: "GridLocations", type: "class", detail: "GridLocations(x_spacing, y_spacing, x_count, y_count)", info: "格子状配置。" },
  { label: "PolarLocations", type: "class", detail: "PolarLocations(radius, count)", info: "極座標状配置。" },
  { label: "HexLocations", type: "class", detail: "HexLocations(apothem, count, ...)", info: "六角格子配置。" },

  // ── プレーン ──
  { label: "Plane", type: "class", detail: "Plane.XY / Plane.XZ / Plane.YZ", info: "基準平面。Plane.XY.offset(z)でオフセット。" },
  { label: "Axis", type: "class", detail: "Axis.X / Axis.Y / Axis.Z", info: "基準軸。sort_by/filter_byで使用。" },
  { label: "GeomType", type: "class", detail: "GeomType.CIRCLE / GeomType.LINE", info: "ジオメトリ型フィルタ。" },
  { label: "Mode", type: "class", detail: "Mode.ADD / Mode.SUBTRACT / Mode.INTERSECT", info: "ブール演算モード。" },
  { label: "Select", type: "class", detail: "Select.ALL / Select.LAST", info: "選択モード。" },

  // ── エクスポート ──
  { label: "export_step", type: "function", detail: "export_step(shape, file_path)", info: "STEPファイルへエクスポート。" },
  { label: "export_stl", type: "function", detail: "export_stl(shape, file_path)", info: "STLファイルへエクスポート。" },

  // ── よく使う変数名 ──
  { label: "result", type: "variable", detail: "result = ...", info: "必ずこの変数名に最終形状を代入すること。" },
];

// build123dのすべてのimport候補（`from build123d import *` のあとでも補完）
const BUILD123D_IMPORT_LINE = "from build123d import *";

export function build123dCompletionSource(context: CompletionContext) {
  const word = context.matchBefore(/\w*/);
  if (!word || (word.from === word.to && !context.explicit)) return null;

  return {
    from: word.from,
    options: BUILD123D_COMPLETIONS,
    validFor: /^\w*$/,
  };
}

export { BUILD123D_IMPORT_LINE };
export default BUILD123D_COMPLETIONS;
