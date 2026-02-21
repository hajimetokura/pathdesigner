# PathDesigner — プロジェクトルール

## プロジェクト概要
ノードベースCAMシステム。React Flow（フロントエンド）+ FastAPI/Python（バックエンド）。
STEP入力 → ツールパス生成 → OpenSBP出力（ShopBot CNC対応）。

## Python環境: uv を使用
- パッケージ追加: `uv add <package>`
- スクリプト実行: `uv run python <script.py>`
- **禁止:** `pip install`, `pip uninstall`

## 開発ワークフロー

### ブランチ戦略
- `main` ブランチは常に動作する状態を保つ
- 新機能・修正は **フィーチャーブランチ** を切って開発する
  - 命名: `feature/phase-1-brep-import`, `fix/cors-issue` 等
- 完了したら **PR を作成** してmainにマージする
- 各PhaseのissueにPRを紐づける

### issue駆動開発
- 新しい機能・改善案はまず **issueに起票** する
- issueで要件・設計を整理してから実装に入る
- 大きい開発はブレストログ (`brainstorm/`) で議論してからissue化
- issueのラベル: `enhancement`, `bug`, `discussion` 等を活用

### コミットメッセージ
- 何をしたかではなく **なぜしたか** を書く
- Phase番号やissue番号を含める: `Phase 1: Add STEP file upload endpoint (#1)`

## 技術スタック
- **フロントエンド:** React + React Flow + TypeScript (Vite)
- **バックエンド:** FastAPI (Python 3.13+)
- **通信:** REST + WebSocket ハイブリッド
- **データ形式:** JSON（Pydanticでスキーマ定義）
- **入力:** STEP (.step/.stp) — Rhino互換
- **出力:** OpenSBP (.sbp) — ShopBot対応
- **Pythonライブラリ:** build123d, shapely, ezdxf

## アーキテクチャ

### ノード構成（v1: 7ノード）
1. BREPインポート — STEP読み込み、寸法・加工タイプ判定
2. 外形線抽出 — 底面スライス、オフセット込み（加工設定を入力に含む）
3. 加工設定 — 刃物径・送り速度・回転数・タブ等
4. マージ — 複数パス統合（将来の掘り込み・斜め加工の合流点）
5. ポストプロセッサ設定 — ShopBot SBP固有設定
6. 加工パス生成 — ツールパス計算・SBPコード生成
7. プレビュー — SBPコード表示・パス可視化

### データフロー
```
                    ┌─────────────┐
                    │  加工設定(3)  │
                    └──────┬──────┘
                           │
┌──────────┐    ┌──────────▼─────────┐    ┌──────────┐
│ STEP取込(1)│───→│  外形線抽出(2)     │───→│ マージ(4) │
└──────────┘    └────────────────────┘    └────┬─────┘
                                               │
                ┌──────────────┐               │
                │ ポスプロ設定(5)│               │
                └──────┬──────┘               │
                       │    ┌─────────────────┘
                  ┌────▼────▼────┐    ┌──────────┐
                  │ パス生成(6)   │───→│プレビュー(7)│
                  └─────────────┘    └──────────┘
```

### ノード間データ: すべてJSON
- ノード1出力: objects配列（bounding_box, thickness, is_closed, is_planar, machining_type）
- ノード2出力: contours配列（座標列、offset情報）
- ノード3出力: operation_type, tool, feed_rate, spindle_speed, tabs
- ノード6出力: toolpaths + sbp_code

## ディレクトリ構成
```
backend/
├── main.py           # FastAPIエントリポイント + ルート
├── schemas.py        # Pydanticモデル（全ノード分）
├── nodes/            # ノードごとの処理ロジック
├── sbp_writer.py     # SBPコード生成
└── tests/

frontend/
└── src/
    ├── App.tsx        # React Flowキャンバス + 状態管理
    ├── types.ts       # 型定義
    ├── api.ts         # バックエンド通信
    └── nodes/         # React Flowカスタムノード
```
**方針:** ファイルが大きくなったら分ける。最初から分けない。

## 起動方法
```bash
make dev    # Backend + Frontend 同時起動
make back   # Backend のみ
make front  # Frontend のみ
```
動作確認は `make dev` で行うこと。

## 開発フェーズ
| Phase | Issue | 内容 |
|-------|-------|------|
| 0 | ✅ | プロジェクト初期化 |
| 1 | ✅ | BREPインポートノード (build123d) |
| 2 | #2 | 外形線抽出ノード (shapely) |
| 3 | #3 | 加工設定UI |
| 4 | #4 | パス生成 + SBP出力 |
| 5 | #5 | プレビュー |
| 6 | #6 | マージ + 複数オブジェクト |

## セッション開始時
新しいセッションを始める際は、まず以下を確認すること:
1. ブレストログ (`2026-02-21_brainstorm.md`) を読み、進捗と次のPhaseを把握
2. `git log --oneline -5` で直近のコミット状況を確認
3. 該当Phaseの GitHub issue を確認

## リファレンス
- ブレストログ: `2026-02-21_brainstorm.md`（プロジェクトルート）
- SBPリファレンス: `OKRA_local/resources/shopbot/`
- GitHub: https://github.com/hajimetokura/pathdesigner
