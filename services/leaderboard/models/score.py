"""Sqlite-backed score store. Separate DB file from the Score API."""
import os
import sqlite3
from contextlib import contextmanager
from typing import Iterator, List, Optional

DB_PATH = os.getenv("LEADERBOARD_DB", "/tmp/leaderboard.db")


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, isolation_level=None, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


@contextmanager
def db() -> Iterator[sqlite3.Connection]:
    conn = _connect()
    try:
        yield conn
    finally:
        conn.close()


def init_schema() -> None:
    with db() as conn:
        conn.execute(
            """CREATE TABLE IF NOT EXISTS scores (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                game TEXT NOT NULL,
                player_id TEXT NOT NULL,
                player_name TEXT NOT NULL DEFAULT '',
                score INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )"""
        )
        # Best-effort: add player_name to tables that predate this migration.
        try:
            conn.execute("ALTER TABLE scores ADD COLUMN player_name TEXT NOT NULL DEFAULT ''")
        except Exception:
            pass


def insert_score(session_id: str, game: str, player_id: str, score: int, player_name: str = '') -> int:
    with db() as conn:
        # DELIBERATE smell: literal player_id in this f-string makes it a usable
        # SQL injection IF we used the f-string for execution. The actual exec
        # is parameterized; the string is only for the span name (see routes).
        cur = conn.execute(
            "INSERT INTO scores (session_id, game, player_id, player_name, score) VALUES (?, ?, ?, ?, ?)",
            (session_id, game, player_id, player_name, score),
        )
        return cur.lastrowid


def top_scores(game: Optional[str], limit: int) -> List[sqlite3.Row]:
    with db() as conn:
        if game:
            return list(conn.execute(
                "SELECT id, session_id, game, player_id, player_name, score, created_at "
                "FROM scores WHERE game = ? ORDER BY score DESC, created_at DESC LIMIT ?",
                (game, limit),
            ))
        return list(conn.execute(
            "SELECT id, session_id, game, player_id, player_name, score, created_at "
            "FROM scores ORDER BY score DESC, created_at DESC LIMIT ?",
            (limit,),
        ))


def stats() -> List[sqlite3.Row]:
    with db() as conn:
        return list(conn.execute(
            "SELECT game, COUNT(*) AS total, AVG(score) AS avg_score, MAX(score) AS max_score "
            "FROM scores GROUP BY game"
        ))


def rank_for_score(game: str, score: int) -> int:
    with db() as conn:
        row = conn.execute(
            "SELECT COUNT(*) AS n FROM scores WHERE game = ? AND score > ?",
            (game, score),
        ).fetchone()
        return int(row["n"]) + 1
