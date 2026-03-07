# build123d 建築コードデータセット + RAG統合 実装計画

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** build123d建築コードデータセットを体系的に構築するパイプライン(b3d-arch-dataset)と、PathDesignerのAI CADへのRAG統合を実装する。

**Architecture:** 2プロジェクト分離。`b3d-arch-dataset`でデータ収集・変換・検証を行い、`export.py`でPathDesignerの`arch_snippets.db`にエクスポート。PathDesigner側は`arch_rag.py`でベクトル検索し、`_build_system_prompt`に動的注入する。

**Tech Stack:** Python 3.13+, build123d, aiosqlite, sqlite-vec, httpx (OpenRouter API), pyyaml, gog CLI (Google Sheets)

---

## Phase A: b3d-arch-dataset プロジェクト立ち上げ

### Task 1: プロジェクトスキャフォールド

**Files:**
- Create: `OKRA_local/apps/b3d-arch-dataset/pyproject.toml`
- Create: `OKRA_local/apps/b3d-arch-dataset/CLAUDE.md`
- Create: `OKRA_local/apps/b3d-arch-dataset/taxonomy.yaml`
- Create: `OKRA_local/apps/b3d-arch-dataset/.gitignore`

**Step 1: ディレクトリ構造を作成**

```bash
cd /Users/hajimetokura/OKRA_local/apps
mkdir -p b3d-arch-dataset/{sources/{github,generated},converted,verified,scripts,export,tests}
```

**Step 2: pyproject.toml を作成**

```toml
[project]
name = "b3d-arch-dataset"
version = "0.1.0"
requires-python = ">=3.13"
dependencies = [
    "build123d>=0.10.0",
    "httpx>=0.28.0",
    "pyyaml>=6.0.3",
    "sqlite-vec>=0.1.6",
    "aiosqlite>=0.22.1",
]

[tool.pytest.ini_options]
testpaths = ["tests"]
asyncio_mode = "auto"

[dependency-groups]
dev = [
    "pytest>=8.0",
    "pytest-asyncio>=0.25.0",
]
```

**Step 3: taxonomy.yaml を作成**

設計ドキュメントの taxonomy をそのまま書く。各要素に `target` 数を含める。
初期値は各カテゴリ 5 件（合計: 約 120 件目標）。

```yaml
elements:
  furniture:
    table:
      target: 5
      methods: [frame_and_skin, waffle, interlocking]
    chair:
      target: 5
      methods: [frame_and_skin, mass_stacking]
    shelf:
      target: 5
      methods: [frame_and_skin, interlocking, waffle]
    lighting:
      target: 3
      methods: [frame_and_skin, shell_surface]
    bench:
      target: 3
      methods: [mass_stacking, frame_and_skin]

  architectural_detail:
    wall_panel:
      target: 5
      methods: [frame_and_skin, louver_array, folding]
    window_frame:
      target: 5
      methods: [frame_and_skin, interlocking]
    door_frame:
      target: 3
      methods: [frame_and_skin, interlocking]
    stair:
      target: 5
      methods: [frame_and_skin, mass_stacking, waffle]
    handrail:
      target: 3
      methods: [frame_and_skin, interlocking]
    joint:
      target: 5
      methods: [interlocking]
    molding:
      target: 3
      methods: [mass_stacking]
    bracket:
      target: 3
      methods: [mass_stacking, interlocking]

  facade:
    screen:
      target: 5
      methods: [louver_array, folding, waffle]
    louver:
      target: 5
      methods: [louver_array, folding]
    cladding:
      target: 5
      methods: [frame_and_skin, folding]
    canopy:
      target: 3
      methods: [frame_and_skin, shell_surface]

  pavilion:
    frame:
      target: 5
      methods: [frame_and_skin]
    shell:
      target: 3
      methods: [shell_surface]
    gridshell:
      target: 3
      methods: [shell_surface, frame_and_skin]
    truss:
      target: 3
      methods: [frame_and_skin]

  building_mass:
    extrusion:
      target: 5
      methods: [mass_stacking]
    boolean_mass:
      target: 5
      methods: [mass_stacking]
    floor_plan:
      target: 5
      methods: [mass_stacking, frame_and_skin]
    roof:
      target: 5
      methods: [folding, shell_surface, frame_and_skin]

construction_methods:
  frame_and_skin:
    description: "骨組み（線材）を作り、面材を貼るレイヤ構成"
    b3d_pattern: "Wire/Edge → sweep/loft → Shell"
  mass_stacking:
    description: "ソリッドの積み上げ・ブーリアン演算で形成"
    b3d_pattern: "Box/Cylinder → fuse/cut → compound"
  louver_array:
    description: "同一要素の反復配列。角度・間隔をパラメトリック制御"
    b3d_pattern: "単一部材 → PolarLocations/GridLocations"
  waffle:
    description: "直交する板材のスリット嵌合。CNC切り出し向き"
    b3d_pattern: "Sketch → extrude → intersecting slots"
  folding:
    description: "板材を折り曲げて構造・形態を作る"
    b3d_pattern: "Face → fold lines → loft between edges"
  shell_surface:
    description: "曲面で覆う構造。薄肉で大スパン"
    b3d_pattern: "Spline/BezierCurve → loft → Shell(thickness)"
  interlocking:
    description: "部材同士の凹凸で接合。ファスナー不要"
    b3d_pattern: "Box → cut(pattern) → mirror → mate"
```

**Step 4: CLAUDE.md を作成**

```markdown
# b3d-arch-dataset

## 目的
build123dの建築コードデータセットを体系的に構築する。
PathDesignerのAI CAD RAGおよび将来のファインチューニングに使用。

## Python環境: uv
- パッケージ追加: `uv add <package>`
- スクリプト実行: `uv run python scripts/<script>.py`
- テスト: `uv run pytest tests/ -v`
- **禁止:** `pip install`, `pip uninstall`

## 主要ワークフロー
1. `uv run python scripts/monitor.py status` — 進捗確認
2. `uv run python scripts/monitor.py fill --max N` — 不足カテゴリの自動生成
3. `uv run python scripts/sync_review.py push` — Google Sheetsにレビュー待ち送信
4. `uv run python scripts/sync_review.py pull` — レビュー結果取り込み
5. `uv run python scripts/export.py` — PathDesignerへエクスポート

## 対話的作成モード
ユーザーと一緒にコードを書く場合:
1. taxonomy.yaml で対象カテゴリを確認
2. verified/ の既存例を参考に提示
3. build123dコードを作成 → 実行検証
4. verified/{id}/ に保存（meta.json + build123d.py + model.step）

## ディレクトリ構成
- sources/ — 収集した生コード（github/, generated/）
- converted/ — build123dに変換済み（未検証）
- verified/ — 実行検証済みペア（確定データ）
- scripts/ — パイプラインスクリプト
- export/ — PathDesignerへのエクスポート出力

## build123d ルール
- BuildPart/BuildSketch コンテキストマネージャを使う
- pathdesigner の build123d_cheatsheet.md を参照:
  `../../pathdesigner/build123d_cheatsheet.md`
```

**Step 5: .gitignore を作成**

```
__pycache__/
*.pyc
.venv/
export/*.db
*.step
```

**Step 6: uv で仮想環境を初期化**

```bash
cd /Users/hajimetokura/OKRA_local/apps/b3d-arch-dataset
uv venv && uv sync
```

**Step 7: git init + 初回コミット**

```bash
cd /Users/hajimetokura/OKRA_local/apps/b3d-arch-dataset
git init
git add .
git commit -m "init: scaffold b3d-arch-dataset project"
```

---

### Task 2: verify.py — build123d コード実行検証

他のすべてのスクリプトが依存する最も基本的なモジュール。

**Files:**
- Create: `scripts/verify.py`
- Create: `tests/test_verify.py`

**Step 1: テストを書く**

```python
# tests/test_verify.py
import json
from pathlib import Path
from scripts.verify import verify_code, save_verified

GOOD_CODE = """
from build123d import *
with BuildPart() as part:
    Box(10, 10, 5)
result = part.part
"""

BAD_CODE = """
from build123d import *
this_will_fail()
"""


def test_verify_good_code():
    ok, step_bytes, error = verify_code(GOOD_CODE)
    assert ok is True
    assert step_bytes is not None
    assert len(step_bytes) > 0
    assert error is None


def test_verify_bad_code():
    ok, step_bytes, error = verify_code(BAD_CODE)
    assert ok is False
    assert step_bytes is None
    assert "Error" in error or "error" in error.lower()


def test_save_verified(tmp_path):
    meta = {
        "id": "test-001",
        "name": "Test Box",
        "element": "furniture/table",
        "construction_method": "mass_stacking",
    }
    code = GOOD_CODE
    step_bytes = b"fake-step-data"

    save_verified(tmp_path, meta, code, step_bytes)

    entry_dir = tmp_path / "test-001"
    assert entry_dir.exists()
    assert (entry_dir / "build123d.py").read_text() == code
    assert (entry_dir / "model.step").read_bytes() == step_bytes

    saved_meta = json.loads((entry_dir / "meta.json").read_text())
    assert saved_meta["element"] == "furniture/table"
    assert saved_meta["verified"] is True
```

**Step 2: テストが失敗することを確認**

```bash
cd /Users/hajimetokura/OKRA_local/apps/b3d-arch-dataset
uv run pytest tests/test_verify.py -v
```

Expected: FAIL (ModuleNotFoundError)

**Step 3: verify.py を実装**

```python
# scripts/verify.py
"""build123d コード実行検証 + 検証済みデータ保存."""

from __future__ import annotations

import json
import traceback
from io import BytesIO
from pathlib import Path


def verify_code(code: str) -> tuple[bool, bytes | None, str | None]:
    """build123d コードを実行して検証する.

    Returns: (success, step_bytes | None, error_message | None)
    """
    local_ns: dict = {}
    try:
        exec(code, {}, local_ns)  # noqa: S102
    except Exception:
        return False, None, traceback.format_exc()

    # result 変数から STEP エクスポート
    result = local_ns.get("result")
    if result is None:
        # BuildPart の part を探す
        for v in local_ns.values():
            if hasattr(v, "export_step"):
                result = v
                break

    if result is None:
        return False, None, "No exportable result found (define `result` variable)"

    try:
        from build123d import export_step

        buf = BytesIO()
        export_step(result, buf)
        step_bytes = buf.getvalue()
        return True, step_bytes, None
    except Exception:
        return False, None, traceback.format_exc()


def save_verified(
    base_dir: Path,
    meta: dict,
    code: str,
    step_bytes: bytes,
    cadquery_code: str | None = None,
) -> Path:
    """検証済みエントリを保存."""
    entry_dir = base_dir / meta["id"]
    entry_dir.mkdir(parents=True, exist_ok=True)

    (entry_dir / "build123d.py").write_text(code)
    (entry_dir / "model.step").write_bytes(step_bytes)

    meta["verified"] = True
    (entry_dir / "meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2)
    )

    if cadquery_code:
        (entry_dir / "cadquery.py").write_text(cadquery_code)

    return entry_dir
```

**Step 4: テスト実行**

```bash
uv run pytest tests/test_verify.py -v
```

Expected: ALL PASS

**Step 5: コミット**

```bash
git add scripts/verify.py tests/test_verify.py
git commit -m "feat: add verify.py — build123d code execution and verification"
```

---

### Task 3: convert.py — CadQuery → build123d 変換

**Files:**
- Create: `scripts/convert.py`
- Create: `tests/test_convert.py`

**Step 1: テストを書く**

```python
# tests/test_convert.py
import pytest
from unittest.mock import AsyncMock, patch
from scripts.convert import convert_cadquery_to_build123d, _build_conversion_prompt

CADQUERY_CODE = """
import cadquery as cq
result = cq.Workplane("XY").box(10, 10, 5).edges("|Z").fillet(1)
"""


def test_build_conversion_prompt():
    prompt = _build_conversion_prompt(CADQUERY_CODE)
    assert "cadquery" in prompt.lower() or "CadQuery" in prompt
    assert "build123d" in prompt
    assert CADQUERY_CODE in prompt


@pytest.mark.asyncio
async def test_convert_returns_code():
    mock_response = """```python
from build123d import *
with BuildPart() as part:
    Box(10, 10, 5)
    fillet(part.edges().filter_by(Axis.Z), 1)
result = part.part
```"""

    with patch("scripts.convert._call_llm", new_callable=AsyncMock, return_value=mock_response):
        code = await convert_cadquery_to_build123d(CADQUERY_CODE)
        assert "from build123d import" in code
        assert "BuildPart" in code
        assert "```" not in code  # fence stripped
```

**Step 2: テストが失敗することを確認**

```bash
uv run pytest tests/test_convert.py -v
```

**Step 3: convert.py を実装**

```python
# scripts/convert.py
"""CadQuery → build123d コード変換 (LLM使用)."""

from __future__ import annotations

import os
import re

import httpx

_OPENROUTER_BASE = "https://openrouter.ai/api/v1"
_DEFAULT_MODEL = "anthropic/claude-sonnet-4"

_CONVERSION_RULES = """
## CadQuery → build123d 変換ルール

1. `cq.Workplane("XY").box(x,y,z)` → `with BuildPart(): Box(x,y,z)`
2. メソッドチェーン → `with` ブロック内の逐次操作
3. `.edges("|Z")` → `.edges().filter_by(Axis.Z)`
4. `.fillet(r)` → `fillet(part.edges()..., r)`
5. `.cut(...)` → `with Locations(...): subtract(...)`
6. `result` 変数に最終ソリッドを代入すること: `result = part.part`
7. `from build123d import *` を先頭に
"""


def _build_conversion_prompt(cadquery_code: str) -> str:
    return f"""{_CONVERSION_RULES}

以下のCadQueryコードをbuild123dに変換してください。
変換後のPythonコードのみを出力してください。

```python
{cadquery_code}
```"""


def _strip_code_fences(text: str) -> str:
    text = re.sub(r"```python\s*\n?", "", text)
    text = re.sub(r"```\s*$", "", text, flags=re.MULTILINE)
    return text.strip()


async def _call_llm(prompt: str, model: str | None = None) -> str:
    api_key = os.environ.get("OPENROUTER_API_KEY", "")
    model = model or _DEFAULT_MODEL

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{_OPENROUTER_BASE}/chat/completions",
            headers={"Authorization": f"Bearer {api_key}"},
            json={
                "model": model,
                "messages": [
                    {"role": "user", "content": prompt},
                ],
            },
            timeout=120,
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]


async def convert_cadquery_to_build123d(
    cadquery_code: str,
    model: str | None = None,
) -> str:
    """CadQuery コードを build123d に変換."""
    prompt = _build_conversion_prompt(cadquery_code)
    raw = await _call_llm(prompt, model)
    return _strip_code_fences(raw)
```

**Step 4: テスト実行**

```bash
uv run pytest tests/test_convert.py -v
```

Expected: ALL PASS

**Step 5: コミット**

```bash
git add scripts/convert.py tests/test_convert.py
git commit -m "feat: add convert.py — CadQuery to build123d LLM conversion"
```

---

### Task 4: collect_github.py — GitHub CadQuery コード収集

**Files:**
- Create: `scripts/collect_github.py`
- Create: `tests/test_collect.py`

**Step 1: テストを書く**

```python
# tests/test_collect.py
from pathlib import Path
from scripts.collect_github import save_source, parse_github_url


def test_parse_github_url():
    url = "https://github.com/CadQuery/cadquery-contrib/blob/main/examples/box.py"
    owner, repo, path = parse_github_url(url)
    assert owner == "CadQuery"
    assert repo == "cadquery-contrib"
    assert path == "examples/box.py"


def test_save_source(tmp_path):
    code = "import cadquery as cq\nresult = cq.Workplane('XY').box(10,10,5)"
    dest = save_source(
        tmp_path,
        repo="cadquery-contrib",
        filename="box.py",
        code=code,
        url="https://github.com/example/repo/blob/main/box.py",
    )
    assert dest.exists()
    assert dest.read_text() == code
    # メタファイル
    assert (dest.with_suffix(".meta.json")).exists()
```

**Step 2: テスト失敗を確認**

**Step 3: collect_github.py を実装**

```python
# scripts/collect_github.py
"""GitHub から CadQuery コードを収集."""

from __future__ import annotations

import json
import re
from pathlib import Path

import httpx

# 収集対象リポジトリ
TARGET_REPOS = [
    "CadQuery/cadquery-contrib",
    "gumyr/cq_warehouse",
    "tanius/cadquery-models",
]


def parse_github_url(url: str) -> tuple[str, str, str]:
    """GitHub blob URL をパース → (owner, repo, file_path)."""
    m = re.match(r"https://github\.com/([^/]+)/([^/]+)/blob/[^/]+/(.+)", url)
    if not m:
        raise ValueError(f"Invalid GitHub URL: {url}")
    return m.group(1), m.group(2), m.group(3)


def save_source(
    base_dir: Path,
    repo: str,
    filename: str,
    code: str,
    url: str,
) -> Path:
    """収集したソースコードを保存."""
    safe_name = f"{repo}_{filename}".replace("/", "_")
    dest = base_dir / safe_name
    dest.write_text(code)

    meta_path = dest.with_suffix(".meta.json")
    meta_path.write_text(json.dumps({
        "repo": repo,
        "filename": filename,
        "url": url,
        "source_type": "github",
    }, ensure_ascii=False, indent=2))

    return dest


async def fetch_repo_python_files(
    owner: str,
    repo: str,
    path: str = "",
) -> list[dict]:
    """GitHub API でリポジトリの .py ファイル一覧を取得."""
    url = f"https://api.github.com/repos/{owner}/{repo}/contents/{path}"
    async with httpx.AsyncClient() as client:
        resp = await client.get(url, timeout=30)
        resp.raise_for_status()
        items = resp.json()

    py_files = []
    for item in items:
        if item["type"] == "file" and item["name"].endswith(".py"):
            py_files.append({
                "name": item["name"],
                "download_url": item["download_url"],
                "path": item["path"],
                "url": item["html_url"],
            })
        elif item["type"] == "dir":
            py_files.extend(await fetch_repo_python_files(owner, repo, item["path"]))

    return py_files


async def download_and_save(
    file_info: dict,
    repo: str,
    output_dir: Path,
) -> Path | None:
    """ファイルをダウンロードして保存. CadQuery import があるもののみ."""
    async with httpx.AsyncClient() as client:
        resp = await client.get(file_info["download_url"], timeout=30)
        resp.raise_for_status()
        code = resp.text

    if "cadquery" not in code.lower() and "cq." not in code:
        return None

    return save_source(
        output_dir,
        repo=repo,
        filename=file_info["path"],
        code=code,
        url=file_info["url"],
    )
```

**Step 4: テスト実行**

```bash
uv run pytest tests/test_collect.py -v
```

**Step 5: コミット**

```bash
git add scripts/collect_github.py tests/test_collect.py
git commit -m "feat: add collect_github.py — scrape CadQuery code from GitHub repos"
```

---

### Task 5: generate_batch.py — LLM 一括生成

**Files:**
- Create: `scripts/generate_batch.py`
- Create: `tests/test_generate_batch.py`

**Step 1: テストを書く**

```python
# tests/test_generate_batch.py
import yaml
from pathlib import Path
from scripts.generate_batch import build_prompts_from_taxonomy


def test_build_prompts_from_taxonomy(tmp_path):
    taxonomy = {
        "elements": {
            "furniture": {
                "table": {"target": 2, "methods": ["waffle", "interlocking"]},
            },
        },
        "construction_methods": {
            "waffle": {
                "description": "直交する板材のスリット嵌合",
                "b3d_pattern": "Sketch → extrude → intersecting slots",
            },
            "interlocking": {
                "description": "部材同士の凹凸で接合",
                "b3d_pattern": "Box → cut(pattern) → mirror → mate",
            },
        },
    }

    prompts = build_prompts_from_taxonomy(taxonomy)
    assert len(prompts) == 2  # table × 2 methods
    assert prompts[0]["element"] == "furniture/table"
    assert prompts[0]["method"] in ("waffle", "interlocking")
    assert "build123d" in prompts[0]["prompt"]
```

**Step 2: テスト失敗を確認**

**Step 3: generate_batch.py を実装**

```python
# scripts/generate_batch.py
"""taxonomy.yaml からプロンプトを生成してbuild123dコードを一括生成."""

from __future__ import annotations

import asyncio
import json
import uuid
from pathlib import Path

import yaml

from scripts.convert import _call_llm, _strip_code_fences
from scripts.verify import verify_code, save_verified

_GENERATION_PROMPT_TEMPLATE = """
build123dを使って「{element_name}」を「{method_name}」構法で作成するPythonコードを書いてください。

## 構法の説明
{method_description}
build123dパターン: {b3d_pattern}

## ルール
- `from build123d import *` を先頭に
- `with BuildPart() as part:` コンテキストマネージャを使用
- 最後に `result = part.part` で結果を代入
- パラメータは変数で定義（ハードコードしない）
- コメントは日本語で

コードのみを出力してください。
"""


def build_prompts_from_taxonomy(
    taxonomy: dict,
) -> list[dict]:
    """taxonomy からプロンプト一覧を生成."""
    methods = taxonomy["construction_methods"]
    prompts = []

    for category, elements in taxonomy["elements"].items():
        for elem_name, elem_conf in elements.items():
            for method_key in elem_conf["methods"]:
                method = methods[method_key]
                prompt = _GENERATION_PROMPT_TEMPLATE.format(
                    element_name=elem_name,
                    method_name=method_key,
                    method_description=method["description"],
                    b3d_pattern=method["b3d_pattern"],
                )
                prompts.append({
                    "element": f"{category}/{elem_name}",
                    "method": method_key,
                    "prompt": prompt,
                })

    return prompts


async def generate_one(
    prompt_info: dict,
    verified_dir: Path,
    model: str | None = None,
    max_retries: int = 3,
) -> dict:
    """1件生成 → 検証 → 保存. 結果を返す."""
    entry_id = f"arch-{uuid.uuid4().hex[:8]}"

    for attempt in range(max_retries):
        raw = await _call_llm(prompt_info["prompt"], model)
        code = _strip_code_fences(raw)
        ok, step_bytes, error = verify_code(code)

        if ok and step_bytes:
            meta = {
                "id": entry_id,
                "name": f"{prompt_info['element']} ({prompt_info['method']})",
                "element": prompt_info["element"],
                "construction_method": prompt_info["method"],
                "source": "llm_generated",
            }
            save_verified(verified_dir, meta, code, step_bytes)
            return {"id": entry_id, "status": "ok", "attempts": attempt + 1}

        # リトライ: エラー情報をプロンプトに追加
        prompt_info = {
            **prompt_info,
            "prompt": prompt_info["prompt"] + f"\n\n前回のエラー:\n{error}\n\n修正してください。",
        }

    return {"id": entry_id, "status": "failed", "error": error}


async def generate_batch(
    taxonomy_path: Path,
    verified_dir: Path,
    max_items: int = 20,
    model: str | None = None,
) -> list[dict]:
    """taxonomy から不足分を一括生成."""
    taxonomy = yaml.safe_load(taxonomy_path.read_text())
    prompts = build_prompts_from_taxonomy(taxonomy)

    # TODO: verified/ の既存数をカウントして不足分のみに絞る (monitor.py で実装)
    prompts = prompts[:max_items]

    results = []
    for p in prompts:
        result = await generate_one(p, verified_dir, model)
        results.append(result)

    return results
```

**Step 4: テスト実行**

```bash
uv run pytest tests/test_generate_batch.py -v
```

**Step 5: コミット**

```bash
git add scripts/generate_batch.py tests/test_generate_batch.py
git commit -m "feat: add generate_batch.py — taxonomy-driven batch code generation"
```

---

### Task 6: monitor.py — 進捗監視 + fill コマンド

**Files:**
- Create: `scripts/monitor.py`
- Create: `tests/test_monitor.py`

**Step 1: テストを書く**

```python
# tests/test_monitor.py
import json
import yaml
from pathlib import Path
from scripts.monitor import count_verified, get_shortfall

MINI_TAXONOMY = {
    "elements": {
        "furniture": {
            "table": {"target": 3, "methods": ["waffle"]},
            "chair": {"target": 2, "methods": ["frame_and_skin"]},
        },
    },
    "construction_methods": {
        "waffle": {"description": "test", "b3d_pattern": "test"},
        "frame_and_skin": {"description": "test", "b3d_pattern": "test"},
    },
}


def test_count_verified_empty(tmp_path):
    counts = count_verified(tmp_path)
    assert counts == {}


def test_count_verified_with_entries(tmp_path):
    # verified/arch-001/meta.json
    entry = tmp_path / "arch-001"
    entry.mkdir()
    (entry / "meta.json").write_text(json.dumps({
        "element": "furniture/table",
        "construction_method": "waffle",
    }))

    counts = count_verified(tmp_path)
    assert counts["furniture/table"] == 1


def test_get_shortfall(tmp_path):
    shortfall = get_shortfall(MINI_TAXONOMY, tmp_path)
    assert shortfall["furniture/table"] == 3
    assert shortfall["furniture/chair"] == 2
```

**Step 2: テスト失敗を確認**

**Step 3: monitor.py を実装**

```python
# scripts/monitor.py
"""データセット進捗監視 + 不足分の自動生成."""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

import yaml

PROJECT_DIR = Path(__file__).resolve().parent.parent
TAXONOMY_PATH = PROJECT_DIR / "taxonomy.yaml"
VERIFIED_DIR = PROJECT_DIR / "verified"


def count_verified(verified_dir: Path) -> dict[str, int]:
    """verified/ 内のエントリをカテゴリ別にカウント."""
    counts: dict[str, int] = {}
    if not verified_dir.exists():
        return counts

    for entry in verified_dir.iterdir():
        meta_path = entry / "meta.json"
        if not meta_path.exists():
            continue
        meta = json.loads(meta_path.read_text())
        element = meta.get("element", "unknown")
        counts[element] = counts.get(element, 0) + 1

    return counts


def get_shortfall(taxonomy: dict, verified_dir: Path) -> dict[str, int]:
    """カテゴリ別の不足数を返す."""
    counts = count_verified(verified_dir)
    shortfall: dict[str, int] = {}

    for category, elements in taxonomy["elements"].items():
        for elem_name, elem_conf in elements.items():
            key = f"{category}/{elem_name}"
            target = elem_conf.get("target", 5)
            current = counts.get(key, 0)
            if current < target:
                shortfall[key] = target - current

    return shortfall


def cmd_status():
    """進捗テーブルを表示."""
    taxonomy = yaml.safe_load(TAXONOMY_PATH.read_text())
    counts = count_verified(VERIFIED_DIR)

    print(f"{'カテゴリ':<30} {'目標':>4} {'検証済':>6} {'不足':>4}")
    print("-" * 50)

    total_target = 0
    total_done = 0

    for category, elements in taxonomy["elements"].items():
        for elem_name, elem_conf in elements.items():
            key = f"{category}/{elem_name}"
            target = elem_conf.get("target", 5)
            done = counts.get(key, 0)
            short = max(0, target - done)

            total_target += target
            total_done += done

            mark = "✅" if short == 0 else "  "
            print(f"{mark} {key:<28} {target:>4} {done:>6} {short:>4}")

    print("-" * 50)
    print(f"  {'合計':<28} {total_target:>4} {total_done:>6} {total_target - total_done:>4}")


async def cmd_fill(max_items: int, category: str | None):
    """不足カテゴリを自動生成."""
    from scripts.generate_batch import generate_batch

    # category filter はTODO
    results = await generate_batch(
        TAXONOMY_PATH, VERIFIED_DIR, max_items=max_items,
    )
    ok = sum(1 for r in results if r["status"] == "ok")
    fail = sum(1 for r in results if r["status"] == "failed")
    print(f"完了: {ok} 件成功, {fail} 件失敗")


def main():
    parser = argparse.ArgumentParser(description="データセット進捗監視")
    sub = parser.add_subparsers(dest="command")

    sub.add_parser("status", help="進捗表示")

    fill_p = sub.add_parser("fill", help="不足分を自動生成")
    fill_p.add_argument("--max", type=int, default=20)
    fill_p.add_argument("--category", type=str, default=None)

    args = parser.parse_args()

    if args.command == "status":
        cmd_status()
    elif args.command == "fill":
        asyncio.run(cmd_fill(args.max, args.category))
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
```

**Step 4: テスト実行**

```bash
uv run pytest tests/test_monitor.py -v
```

**Step 5: コミット**

```bash
git add scripts/monitor.py tests/test_monitor.py
git commit -m "feat: add monitor.py — dataset progress tracking and auto-fill"
```

---

## Phase B: Google Sheets レビューフロー

### Task 7: sync_review.py — Google Sheets 連携

**Files:**
- Create: `scripts/sync_review.py`
- Create: `tests/test_sync_review.py`

**前提:** `gog` CLI がインストール済み。`gog sheets` コマンドが使用可能。

**Step 1: テストを書く**

```python
# tests/test_sync_review.py
import json
from pathlib import Path
from scripts.sync_review import (
    collect_pending_reviews,
    format_for_sheets,
)


def test_collect_pending_reviews(tmp_path):
    """verified/ 内のレビュー未済エントリを収集."""
    # レビュー済み
    d1 = tmp_path / "arch-001"
    d1.mkdir()
    (d1 / "meta.json").write_text(json.dumps({
        "id": "arch-001", "name": "Test", "element": "furniture/table",
        "construction_method": "waffle", "review_status": "ok",
    }))

    # レビュー未済
    d2 = tmp_path / "arch-002"
    d2.mkdir()
    (d2 / "meta.json").write_text(json.dumps({
        "id": "arch-002", "name": "Test2", "element": "facade/louver",
        "construction_method": "louver_array",
    }))
    (d2 / "build123d.py").write_text("from build123d import *\n...")

    pending = collect_pending_reviews(tmp_path)
    assert len(pending) == 1
    assert pending[0]["id"] == "arch-002"


def test_format_for_sheets():
    entry = {
        "id": "arch-002",
        "name": "ルーバー",
        "element": "facade/louver",
        "construction_method": "louver_array",
        "code_preview": "from build123d import *\nwith BuildPart()...",
    }
    row = format_for_sheets(entry)
    assert row[0] == "arch-002"
    assert row[1] == "ルーバー"
```

**Step 2: テスト失敗を確認**

**Step 3: sync_review.py を実装**

```python
# scripts/sync_review.py
"""Google Sheets との同期 (gog CLI 使用)."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parent.parent
VERIFIED_DIR = PROJECT_DIR / "verified"

# Google Sheets の設定 (初回に gog sheets create で作成)
SHEET_ID_FILE = PROJECT_DIR / ".sheet_id"


def collect_pending_reviews(verified_dir: Path) -> list[dict]:
    """レビュー未済のエントリを収集."""
    pending = []
    if not verified_dir.exists():
        return pending

    for entry in verified_dir.iterdir():
        meta_path = entry / "meta.json"
        if not meta_path.exists():
            continue
        meta = json.loads(meta_path.read_text())

        if meta.get("review_status") in ("ok", "ng"):
            continue

        code_path = entry / "build123d.py"
        code_preview = ""
        if code_path.exists():
            lines = code_path.read_text().splitlines()[:5]
            code_preview = "\n".join(lines)

        pending.append({**meta, "code_preview": code_preview})

    return pending


def format_for_sheets(entry: dict) -> list[str]:
    """エントリを Sheets 行形式に変換."""
    return [
        entry.get("id", ""),
        entry.get("name", ""),
        entry.get("element", ""),
        entry.get("construction_method", ""),
        entry.get("code_preview", ""),
        "",  # STEP link (TODO)
        "",  # 判定 (ユーザーが記入)
        "",  # NG理由 (ユーザーが記入)
    ]


def cmd_push():
    """レビュー待ちを Sheets に送信."""
    pending = collect_pending_reviews(VERIFIED_DIR)
    if not pending:
        print("レビュー待ちなし")
        return

    # gog CLI で追記
    for entry in pending:
        row = format_for_sheets(entry)
        row_csv = "\t".join(row)
        # gog sheets append を使用
        subprocess.run(
            ["gog", "sheets", "append", "--spreadsheet", _get_sheet_id(), "--values", row_csv],
            check=True,
        )
        # レビュー待ちステータスを記録
        meta_path = VERIFIED_DIR / entry["id"] / "meta.json"
        meta = json.loads(meta_path.read_text())
        meta["review_status"] = "pending"
        meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2))

    print(f"📤 {len(pending)}件を Sheets に追加")


def cmd_pull():
    """Sheets からレビュー結果を取り込み."""
    # gog sheets read でデータ取得
    result = subprocess.run(
        ["gog", "sheets", "read", "--spreadsheet", _get_sheet_id(), "--format", "json"],
        capture_output=True, text=True, check=True,
    )
    rows = json.loads(result.stdout)

    ok_count = 0
    ng_count = 0
    skip_count = 0

    for row in rows:
        entry_id = row.get("ID", "")
        verdict = row.get("判定", "").strip().upper()
        ng_reason = row.get("NG理由", "")

        meta_path = VERIFIED_DIR / entry_id / "meta.json"
        if not meta_path.exists():
            continue

        if verdict == "OK":
            meta = json.loads(meta_path.read_text())
            meta["review_status"] = "ok"
            meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2))
            ok_count += 1
        elif verdict == "NG":
            meta = json.loads(meta_path.read_text())
            meta["review_status"] = "ng"
            meta["ng_reason"] = ng_reason
            meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2))
            ng_count += 1
            # TODO: リトライ処理
        else:
            skip_count += 1

    print(f"📥 取り込み: ✅{ok_count} 🔄{ng_count} ⏭️{skip_count}")


def _get_sheet_id() -> str:
    if SHEET_ID_FILE.exists():
        return SHEET_ID_FILE.read_text().strip()
    raise FileNotFoundError("スプレッドシートIDが未設定。.sheet_id ファイルを作成してください。")


def main():
    parser = argparse.ArgumentParser(description="Google Sheets レビュー同期")
    sub = parser.add_subparsers(dest="command")
    sub.add_parser("push", help="レビュー待ちをSheetsに送信")
    sub.add_parser("pull", help="レビュー結果を取り込み")

    args = parser.parse_args()

    if args.command == "push":
        cmd_push()
    elif args.command == "pull":
        cmd_pull()
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
```

**Step 4: テスト実行**

```bash
uv run pytest tests/test_sync_review.py -v
```

**Step 5: コミット**

```bash
git add scripts/sync_review.py tests/test_sync_review.py
git commit -m "feat: add sync_review.py — Google Sheets review workflow"
```

---

## Phase C: エクスポート + PathDesigner RAG統合

### Task 8: export.py — verified/ → arch_snippets.db

**Files:**
- Create: `scripts/export.py`
- Create: `tests/test_export.py`

**Step 1: テストを書く**

```python
# tests/test_export.py
import json
import sqlite3
from pathlib import Path
from scripts.export import export_to_db, DB_SCHEMA


def test_export_creates_db(tmp_path):
    # verified エントリを作成
    verified_dir = tmp_path / "verified"
    entry = verified_dir / "arch-001"
    entry.mkdir(parents=True)
    (entry / "meta.json").write_text(json.dumps({
        "id": "arch-001",
        "name": "テストテーブル",
        "element": "furniture/table",
        "construction_method": "waffle",
        "review_status": "ok",
    }))
    (entry / "build123d.py").write_text("from build123d import *\n# test code")

    db_path = tmp_path / "arch_snippets.db"
    export_to_db(verified_dir, db_path)

    conn = sqlite3.connect(str(db_path))
    rows = conn.execute("SELECT id, name, element, method, code FROM arch_snippets").fetchall()
    assert len(rows) == 1
    assert rows[0][0] == "arch-001"
    assert rows[0][1] == "テストテーブル"
    assert rows[0][2] == "furniture/table"
    assert rows[0][3] == "waffle"
    conn.close()


def test_export_skips_non_ok(tmp_path):
    """review_status が ok 以外はエクスポートしない."""
    verified_dir = tmp_path / "verified"
    entry = verified_dir / "arch-002"
    entry.mkdir(parents=True)
    (entry / "meta.json").write_text(json.dumps({
        "id": "arch-002", "name": "NG Item",
        "element": "facade/louver", "construction_method": "louver_array",
        "review_status": "ng",
    }))
    (entry / "build123d.py").write_text("# ng code")

    db_path = tmp_path / "arch_snippets.db"
    export_to_db(verified_dir, db_path)

    conn = sqlite3.connect(str(db_path))
    rows = conn.execute("SELECT COUNT(*) FROM arch_snippets").fetchone()
    assert rows[0] == 0
    conn.close()
```

**Step 2: テスト失敗を確認**

**Step 3: export.py を実装**

```python
# scripts/export.py
"""verified/ → arch_snippets.db エクスポート."""

from __future__ import annotations

import json
import shutil
import sqlite3
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parent.parent
VERIFIED_DIR = PROJECT_DIR / "verified"
EXPORT_DIR = PROJECT_DIR / "export"
PATHDESIGNER_DATA = PROJECT_DIR.parent / "pathdesigner" / "backend" / "data"

DB_SCHEMA = """
CREATE TABLE IF NOT EXISTS arch_snippets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    element TEXT NOT NULL,
    method TEXT NOT NULL,
    code TEXT NOT NULL,
    parameters TEXT,
    description TEXT,
    difficulty TEXT,
    embedding BLOB
);
"""


def export_to_db(
    verified_dir: Path,
    db_path: Path,
) -> int:
    """verified/ の OK エントリを SQLite にエクスポート."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    conn.execute(DB_SCHEMA)
    conn.execute("DELETE FROM arch_snippets")  # 毎回全件再構築

    count = 0
    for entry in sorted(verified_dir.iterdir()):
        meta_path = entry / "meta.json"
        code_path = entry / "build123d.py"
        if not meta_path.exists() or not code_path.exists():
            continue

        meta = json.loads(meta_path.read_text())

        # OK のみエクスポート
        if meta.get("review_status") != "ok":
            continue

        code = code_path.read_text()

        conn.execute(
            "INSERT OR REPLACE INTO arch_snippets (id, name, element, method, code, parameters, description, difficulty) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                meta["id"],
                meta.get("name", ""),
                meta.get("element", ""),
                meta.get("construction_method", ""),
                code,
                json.dumps(meta.get("parameters", {}), ensure_ascii=False),
                meta.get("description", ""),
                meta.get("difficulty", ""),
            ),
        )
        count += 1

    conn.commit()
    conn.close()
    return count


def main():
    EXPORT_DIR.mkdir(exist_ok=True)
    db_path = EXPORT_DIR / "arch_snippets.db"

    count = export_to_db(VERIFIED_DIR, db_path)
    print(f"📦 {count} 件エクスポート → {db_path}")

    # PathDesigner にコピー
    if PATHDESIGNER_DATA.exists():
        dest = PATHDESIGNER_DATA / "arch_snippets.db"
        shutil.copy2(db_path, dest)
        print(f"📋 PathDesigner にコピー → {dest}")


if __name__ == "__main__":
    main()
```

**Note:** embedding 列は Phase C の Task 9 で sqlite-vec 統合時に実装する。初期版はテキスト検索のみ。

**Step 4: テスト実行**

```bash
uv run pytest tests/test_export.py -v
```

**Step 5: コミット**

```bash
git add scripts/export.py tests/test_export.py
git commit -m "feat: add export.py — verified entries to SQLite DB"
```

---

### Task 9: PathDesigner — arch_rag.py (ベクトル検索)

**Files:**
- Create: `pathdesigner/backend/arch_rag.py`
- Create: `pathdesigner/backend/tests/test_arch_rag.py`

**Step 1: テストを書く**

```python
# backend/tests/test_arch_rag.py
import json
import sqlite3
from pathlib import Path
import pytest
from arch_rag import ArchRAG


@pytest.fixture
def rag_db(tmp_path):
    db_path = tmp_path / "arch_snippets.db"
    conn = sqlite3.connect(str(db_path))
    conn.execute("""
        CREATE TABLE arch_snippets (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            element TEXT NOT NULL,
            method TEXT NOT NULL,
            code TEXT NOT NULL,
            parameters TEXT,
            description TEXT,
            difficulty TEXT,
            embedding BLOB
        )
    """)
    conn.execute(
        "INSERT INTO arch_snippets (id, name, element, method, code, description) VALUES (?, ?, ?, ?, ?, ?)",
        ("arch-001", "ルーバースクリーン", "facade/louver", "louver_array",
         "from build123d import *\n# louver code", "角度調整ルーバー"),
    )
    conn.execute(
        "INSERT INTO arch_snippets (id, name, element, method, code, description) VALUES (?, ?, ?, ?, ?, ?)",
        ("arch-002", "ワッフルテーブル", "furniture/table", "waffle",
         "from build123d import *\n# waffle code", "スリット嵌合テーブル"),
    )
    conn.commit()
    conn.close()
    return db_path


def test_search_by_text(rag_db):
    rag = ArchRAG(rag_db)
    results = rag.search("ルーバー", limit=5)
    assert len(results) >= 1
    assert any(r.element == "facade/louver" for r in results)


def test_search_filter_element(rag_db):
    rag = ArchRAG(rag_db)
    results = rag.search("", element="furniture/table", limit=5)
    assert all(r.element == "furniture/table" for r in results)


def test_search_empty_db(tmp_path):
    db_path = tmp_path / "empty.db"
    conn = sqlite3.connect(str(db_path))
    conn.execute("""
        CREATE TABLE arch_snippets (
            id TEXT PRIMARY KEY, name TEXT, element TEXT, method TEXT,
            code TEXT, parameters TEXT, description TEXT, difficulty TEXT, embedding BLOB
        )
    """)
    conn.commit()
    conn.close()

    rag = ArchRAG(db_path)
    results = rag.search("anything")
    assert results == []
```

**Step 2: テスト失敗を確認**

```bash
cd /Users/hajimetokura/OKRA_local/apps/pathdesigner/backend
uv run pytest tests/test_arch_rag.py -v
```

**Step 3: arch_rag.py を実装**

初期版はテキスト LIKE 検索。ベクトル検索はデータ量が増えた段階で sqlite-vec に移行。

```python
# backend/arch_rag.py
"""建築コードスニペットの検索 (RAG)."""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from pathlib import Path


@dataclass
class ArchSnippet:
    id: str
    name: str
    element: str
    method: str
    code: str
    description: str


class ArchRAG:
    """arch_snippets.db からの検索."""

    def __init__(self, db_path: Path | str):
        self.db_path = Path(db_path)

    def search(
        self,
        query: str = "",
        element: str | None = None,
        method: str | None = None,
        limit: int = 5,
    ) -> list[ArchSnippet]:
        if not self.db_path.exists():
            return []

        conn = sqlite3.connect(str(self.db_path))
        conn.row_factory = sqlite3.Row

        conditions = []
        params: list = []

        if query:
            conditions.append("(name LIKE ? OR description LIKE ? OR code LIKE ?)")
            q = f"%{query}%"
            params.extend([q, q, q])

        if element:
            conditions.append("element = ?")
            params.append(element)

        if method:
            conditions.append("method = ?")
            params.append(method)

        where = " AND ".join(conditions) if conditions else "1=1"
        sql = f"SELECT id, name, element, method, code, description FROM arch_snippets WHERE {where} LIMIT ?"
        params.append(limit)

        rows = conn.execute(sql, params).fetchall()
        conn.close()

        return [
            ArchSnippet(
                id=r["id"],
                name=r["name"],
                element=r["element"],
                method=r["method"],
                code=r["code"],
                description=r["description"] or "",
            )
            for r in rows
        ]
```

**Step 4: テスト実行**

```bash
cd /Users/hajimetokura/OKRA_local/apps/pathdesigner/backend
uv run pytest tests/test_arch_rag.py -v
```

**Step 5: コミット**

```bash
git add backend/arch_rag.py backend/tests/test_arch_rag.py
git commit -m "feat: add arch_rag.py — architecture snippet search for RAG"
```

---

### Task 10: PathDesigner — llm_client.py に RAG 注入

**Files:**
- Modify: `pathdesigner/backend/llm_client.py` — `_build_system_prompt`, `refine_code`, `generate_pipeline`
- Modify: `pathdesigner/backend/tests/test_llm_client.py`

**Step 1: テストを書く**

```python
# 既存の test_llm_client.py に追加

from arch_rag import ArchSnippet


def test_build_system_prompt_with_rag():
    examples = [
        ArchSnippet(
            id="arch-001", name="ルーバー", element="facade/louver",
            method="louver_array", code="from build123d import *\n# louver",
            description="テスト",
        ),
    ]
    prompt = _build_system_prompt("general", rag_examples=examples)
    assert "ルーバー" in prompt
    assert "facade/louver" in prompt
    assert "# louver" in prompt


def test_build_system_prompt_without_rag():
    prompt = _build_system_prompt("general", rag_examples=None)
    assert "関連する建築コード例" not in prompt
```

**Step 2: テスト失敗を確認**

**Step 3: `_build_system_prompt` を修正**

`llm_client.py` の `_build_system_prompt` に `rag_examples` パラメータを追加:

```python
def _build_system_prompt(
    profile: str = "general",
    include_reference: bool = False,
    rag_examples: list | None = None,  # ← 追加
) -> str:
    # ... 既存コード ...

    # RAG例を注入
    if rag_examples:
        prompt += "\n\n## 関連する建築コード例\n"
        prompt += "以下は検証済みの建築コードです。参考にしてください。\n\n"
        for ex in rag_examples:
            prompt += f"### {ex.name} ({ex.element} / {ex.method})\n"
            prompt += f"```python\n{ex.code}\n```\n\n"

    # ... 既存の include_reference 処理 ...
    return prompt
```

**Step 4: `refine_code` に rag_examples を追加**

```python
async def refine_code(
    self,
    current_code: str,
    message: str,
    history: list[dict],
    profile: str = "general",
    rag_examples: list | None = None,  # ← 追加
) -> str:
    coder_model = PIPELINE_MODELS["coder"]
    use_reference = _model_has_large_context(coder_model)
    system = _build_system_prompt(profile, include_reference=use_reference, rag_examples=rag_examples)
    # ... 以降は同じ
```

**Step 5: `generate_pipeline` にも同様に追加**

`generate_pipeline` 内の `_build_system_prompt` 呼び出し箇所に `rag_examples` を渡す。

**Step 6: テスト実行**

```bash
cd /Users/hajimetokura/OKRA_local/apps/pathdesigner/backend
uv run pytest tests/test_llm_client.py -v
```

**Step 7: コミット**

```bash
git add backend/llm_client.py backend/tests/test_llm_client.py
git commit -m "feat: inject RAG examples into LLM system prompt"
```

---

### Task 11: PathDesigner — main.py エンドポイントで RAG 呼び出し

**Files:**
- Modify: `pathdesigner/backend/main.py` — `/ai-cad/generate`, `/ai-cad/refine`
- Modify: `pathdesigner/backend/tests/test_api_ai_cad.py`

**Step 1: テストを書く**

```python
# test_api_ai_cad.py に追加

def test_generate_with_rag(client, tmp_path):
    """arch_snippets.db が存在する場合、RAG検索が走る."""
    # arch_snippets.db をセットアップ
    # ... (既存テストパターンに合わせる)
    # レスポンスにエラーがないことを確認
```

**Step 2: main.py を修正**

```python
# main.py に追加

from arch_rag import ArchRAG

_arch_rag: ArchRAG | None = None

def _get_arch_rag() -> ArchRAG | None:
    global _arch_rag
    db_path = Path(__file__).parent / "data" / "arch_snippets.db"
    if db_path.exists() and _arch_rag is None:
        _arch_rag = ArchRAG(db_path)
    return _arch_rag
```

`/ai-cad/generate` 内:

```python
# RAG検索
rag = _get_arch_rag()
rag_examples = None
if rag and full_prompt.strip():
    rag_examples = rag.search(full_prompt, limit=3)

# generate_pipeline に渡す
code, objects, step_bytes = await llm.generate_pipeline(
    full_prompt,
    ...,
    rag_examples=rag_examples,
)
```

`/ai-cad/refine` 内:

```python
rag = _get_arch_rag()
rag_examples = None
if rag:
    rag_examples = rag.search(req.message, limit=3)

code = await llm.refine_code(
    ...,
    rag_examples=rag_examples,
)
```

**Step 3: テスト実行**

```bash
cd /Users/hajimetokura/OKRA_local/apps/pathdesigner/backend
uv run pytest tests/ -v
```

**Step 4: コミット**

```bash
git add backend/main.py backend/tests/test_api_ai_cad.py
git commit -m "feat: integrate RAG search into /ai-cad/generate and /ai-cad/refine"
```

---

### Task 12: 建築プロファイル追加

**Files:**
- Modify: `pathdesigner/backend/llm_client.py` — `_PROFILES` に `architecture` 追加

**Step 1: テストを書く**

```python
# test_llm_client.py に追加

def test_architecture_profile_exists():
    assert "architecture" in _PROFILES
    assert _PROFILES["architecture"]["use_rag"] is True
```

**Step 2: プロファイルを追加**

```python
# llm_client.py の _PROFILES に追加
"architecture": {
    "name": "建築設計",
    "description": "建築要素（壁・窓・階段・ファサード・パビリオン等）の設計",
    "cheatsheet": _ARCH_CHEATSHEET,
    "use_rag": True,
},
```

`_ARCH_CHEATSHEET` は建築向けのパターン集を定義（構法パターン、よく使うAPI、注意点）。

**Step 3: テスト実行**

```bash
uv run pytest tests/test_llm_client.py -v
```

**Step 4: コミット**

```bash
git add backend/llm_client.py backend/tests/test_llm_client.py
git commit -m "feat: add architecture prompt profile with RAG integration"
```

---

## 実装順序まとめ

| Phase | Task | 内容 | 依存 |
|-------|------|------|------|
| A | 1 | プロジェクトスキャフォールド | なし |
| A | 2 | verify.py (コード検証) | Task 1 |
| A | 3 | convert.py (CQ→b3d変換) | Task 1 |
| A | 4 | collect_github.py (GitHub収集) | Task 1 |
| A | 5 | generate_batch.py (LLM一括生成) | Task 2, 3 |
| A | 6 | monitor.py (進捗+fill) | Task 5 |
| B | 7 | sync_review.py (Sheets連携) | Task 6 |
| C | 8 | export.py (DB出力) | Task 2 |
| C | 9 | arch_rag.py (検索) | Task 8 |
| C | 10 | llm_client.py RAG注入 | Task 9 |
| C | 11 | main.py エンドポイント統合 | Task 10 |
| C | 12 | 建築プロファイル追加 | Task 10 |
