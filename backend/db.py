"""SQLite database for AI CAD generation history."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

import aiosqlite

_SCHEMA = """\
CREATE TABLE IF NOT EXISTS generations (
    id TEXT PRIMARY KEY,
    prompt TEXT NOT NULL,
    image_path TEXT,
    code TEXT NOT NULL,
    result_json TEXT,
    step_path TEXT,
    model_used TEXT NOT NULL,
    status TEXT NOT NULL,
    error_message TEXT,
    tags TEXT,
    conversation_history TEXT,
    created_at TEXT NOT NULL
);
"""


class GenerationDB:
    """Async SQLite wrapper for generation storage."""

    def __init__(self, db_path: str | Path):
        self._db_path = str(db_path)
        self._conn: aiosqlite.Connection | None = None

    async def init(self):
        """Open connection and create tables."""
        self._conn = await aiosqlite.connect(self._db_path)
        self._conn.row_factory = aiosqlite.Row
        await self._conn.executescript(_SCHEMA)
        # Migrate: add conversation_history if missing
        cursor = await self._conn.execute("PRAGMA table_info(generations)")
        cols = {row[1] for row in await cursor.fetchall()}
        if "conversation_history" not in cols:
            await self._conn.execute(
                "ALTER TABLE generations ADD COLUMN conversation_history TEXT"
            )
        await self._conn.commit()

    async def close(self):
        if self._conn:
            await self._conn.close()

    async def save_generation(
        self,
        prompt: str,
        code: str,
        result_json: str | None,
        model_used: str,
        status: str,
        image_path: str | None = None,
        step_path: str | None = None,
        error_message: str | None = None,
        tags: str | None = None,
        conversation_history: str | None = None,
    ) -> str:
        """Save a generation record. Returns the generation ID."""
        gen_id = uuid.uuid4().hex[:12]
        now = datetime.now(timezone.utc).isoformat()
        await self._conn.execute(
            """INSERT INTO generations
               (id, prompt, image_path, code, result_json, step_path,
                model_used, status, error_message, tags,
                conversation_history, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (gen_id, prompt, image_path, code, result_json, step_path,
             model_used, status, error_message, tags,
             conversation_history, now),
        )
        await self._conn.commit()
        return gen_id

    async def get_generation(self, gen_id: str) -> dict | None:
        """Get a single generation by ID."""
        cursor = await self._conn.execute(
            "SELECT * FROM generations WHERE id = ?", (gen_id,)
        )
        row = await cursor.fetchone()
        return dict(row) if row else None

    async def list_generations(
        self,
        search: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[dict]:
        """List generations, most recent first."""
        if search:
            cursor = await self._conn.execute(
                """SELECT id, prompt, model_used, status, created_at
                   FROM generations
                   WHERE prompt LIKE ?
                   ORDER BY created_at DESC LIMIT ? OFFSET ?""",
                (f"%{search}%", limit, offset),
            )
        else:
            cursor = await self._conn.execute(
                """SELECT id, prompt, model_used, status, created_at
                   FROM generations
                   ORDER BY created_at DESC LIMIT ? OFFSET ?""",
                (limit, offset),
            )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]

    async def update_generation(
        self,
        gen_id: str,
        **fields,
    ) -> None:
        """Update fields on an existing generation record."""
        allowed = {"code", "result_json", "step_path", "status",
                   "error_message", "tags", "conversation_history"}
        updates = {k: v for k, v in fields.items() if k in allowed and v is not None}
        if not updates:
            return
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        values = list(updates.values()) + [gen_id]
        await self._conn.execute(
            f"UPDATE generations SET {set_clause} WHERE id = ?", values
        )
        await self._conn.commit()

    async def delete_generation(self, gen_id: str):
        """Delete a generation record."""
        await self._conn.execute(
            "DELETE FROM generations WHERE id = ?", (gen_id,)
        )
        await self._conn.commit()


# ── Snippet DB ────────────────────────────────────────────────────────────────

_SNIPPETS_SCHEMA = """\
CREATE TABLE IF NOT EXISTS snippets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    tags TEXT,
    code TEXT NOT NULL,
    thumbnail_png TEXT,
    source_generation_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
"""


class SnippetsDB:
    """Async SQLite wrapper for snippet storage."""

    def __init__(self, db_path: str | Path):
        self._db_path = str(db_path)
        self._conn: aiosqlite.Connection | None = None

    async def init(self):
        self._conn = await aiosqlite.connect(self._db_path)
        self._conn.row_factory = aiosqlite.Row
        await self._conn.executescript(_SNIPPETS_SCHEMA)
        await self._conn.commit()

    async def close(self):
        if self._conn:
            await self._conn.close()

    async def save_snippet(
        self,
        name: str,
        code: str,
        tags: list[str] | None = None,
        thumbnail_png: str | None = None,
        source_generation_id: str | None = None,
    ) -> str:
        snippet_id = uuid.uuid4().hex[:12]
        now = datetime.now(timezone.utc).isoformat()
        await self._conn.execute(
            "INSERT INTO snippets (id, name, tags, code, thumbnail_png, source_generation_id, created_at, updated_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (snippet_id, name, json.dumps(tags or []), code, thumbnail_png, source_generation_id, now, now),
        )
        await self._conn.commit()
        return snippet_id

    async def get_snippet(self, snippet_id: str) -> dict | None:
        cursor = await self._conn.execute("SELECT * FROM snippets WHERE id = ?", (snippet_id,))
        row = await cursor.fetchone()
        return dict(row) if row else None

    async def list_snippets(
        self, q: str = "", limit: int = 50, offset: int = 0
    ) -> tuple[list[dict], int]:
        search_val = f"%{q}%"
        cursor = await self._conn.execute(
            "SELECT * FROM snippets WHERE name LIKE ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
            (search_val, limit, offset),
        )
        rows = await cursor.fetchall()
        count_cursor = await self._conn.execute(
            "SELECT COUNT(*) FROM snippets WHERE name LIKE ?", (search_val,)
        )
        total = (await count_cursor.fetchone())[0]
        return [dict(r) for r in rows], total

    async def delete_snippet(self, snippet_id: str) -> bool:
        cursor = await self._conn.execute("DELETE FROM snippets WHERE id = ?", (snippet_id,))
        await self._conn.commit()
        return cursor.rowcount > 0
