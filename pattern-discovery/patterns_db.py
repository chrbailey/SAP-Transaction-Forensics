"""SQLite store for discovered forensic patterns.

Design:
- `patterns` table: each pattern has a lifecycle (pending/confirmed/rejected).
  Status updates are allowed.
- `pattern_observations` table: APPEND-ONLY. Each observation links a pattern
  to a specific transaction ID at a point in time. Triggers prevent
  UPDATE/DELETE — this is the immutable evidence trail.
- `discovery_runs` table: audit log of each critic-loop execution.
"""
from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS patterns (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    detection_signature TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    confidence_basis TEXT NOT NULL,
    first_seen_run_id TEXT NOT NULL,
    last_confirmed_run_id TEXT,
    evidence_count INTEGER NOT NULL DEFAULT 0,
    rejection_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pattern_observations (
    id TEXT PRIMARY KEY,
    pattern_id TEXT NOT NULL REFERENCES patterns(id),
    transaction_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    observed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TRIGGER IF NOT EXISTS pattern_observations_no_update
BEFORE UPDATE ON pattern_observations
BEGIN
    SELECT RAISE(ABORT, 'pattern_observations is append-only: updates not permitted');
END;

CREATE TRIGGER IF NOT EXISTS pattern_observations_no_delete
BEFORE DELETE ON pattern_observations
BEGIN
    SELECT RAISE(ABORT, 'pattern_observations is append-only: deletes not permitted');
END;

CREATE TABLE IF NOT EXISTS discovery_runs (
    id TEXT PRIMARY KEY,
    data_source TEXT NOT NULL,
    candidates_proposed INTEGER NOT NULL DEFAULT 0,
    candidates_confirmed INTEGER NOT NULL DEFAULT 0,
    candidates_rejected INTEGER NOT NULL DEFAULT 0,
    candidates_uncertain INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER,
    status TEXT NOT NULL DEFAULT 'running',
    error_message TEXT,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_observations_pattern ON pattern_observations(pattern_id);
CREATE INDEX IF NOT EXISTS idx_observations_run ON pattern_observations(run_id);
CREATE INDEX IF NOT EXISTS idx_patterns_status ON patterns(status);
"""


def _new_id() -> str:
    return str(uuid.uuid4())


class PatternsDB:
    """SQLite-backed pattern library with append-only observations."""

    def __init__(self, db_path: Union[str, Path]):
        self.db_path = str(db_path)
        self.conn = sqlite3.connect(self.db_path)
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(SCHEMA_SQL)

    def close(self) -> None:
        self.conn.close()

    # ------------------------------------------------------------------
    # Patterns
    # ------------------------------------------------------------------

    def get_pattern_by_name(self, name: str) -> Optional[Dict[str, Any]]:
        row = self.conn.execute(
            "SELECT * FROM patterns WHERE name = ?", (name,)
        ).fetchone()
        return dict(row) if row else None

    def upsert_confirmed_pattern(
        self,
        name: str,
        description: str,
        category: str,
        detection_signature: str,
        confidence_basis: str,
        run_id: str,
        observation_count: int,
    ) -> str:
        """Mark a pattern as confirmed. Returns pattern ID."""
        existing = self.get_pattern_by_name(name)
        now = datetime.utcnow().isoformat()
        if existing:
            new_count = existing["evidence_count"] + observation_count
            self.conn.execute(
                """UPDATE patterns SET
                    status = 'confirmed',
                    description = ?,
                    category = ?,
                    detection_signature = ?,
                    confidence_basis = ?,
                    last_confirmed_run_id = ?,
                    evidence_count = ?,
                    updated_at = ?
                WHERE name = ?""",
                (description, category, detection_signature, confidence_basis,
                 run_id, new_count, now, name),
            )
            self.conn.commit()
            return existing["id"]
        pid = _new_id()
        self.conn.execute(
            """INSERT INTO patterns
                (id, name, description, category, detection_signature,
                 status, confidence_basis, first_seen_run_id,
                 last_confirmed_run_id, evidence_count, updated_at)
            VALUES (?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, ?)""",
            (pid, name, description, category, detection_signature,
             confidence_basis, run_id, run_id, observation_count, now),
        )
        self.conn.commit()
        return pid

    def record_rejection(
        self,
        name: str,
        description: str,
        category: str,
        detection_signature: str,
        confidence_basis: str,
        run_id: str,
    ) -> str:
        """Store a rejected candidate for negative training data."""
        existing = self.get_pattern_by_name(name)
        now = datetime.utcnow().isoformat()
        if existing:
            self.conn.execute(
                """UPDATE patterns SET
                    rejection_count = rejection_count + 1,
                    updated_at = ?
                WHERE name = ?""",
                (now, name),
            )
            self.conn.commit()
            return existing["id"]
        pid = _new_id()
        self.conn.execute(
            """INSERT INTO patterns
                (id, name, description, category, detection_signature,
                 status, confidence_basis, first_seen_run_id,
                 evidence_count, rejection_count, updated_at)
            VALUES (?, ?, ?, ?, ?, 'rejected', ?, ?, 0, 1, ?)""",
            (pid, name, description, category, detection_signature,
             confidence_basis, run_id, now),
        )
        self.conn.commit()
        return pid

    def list_confirmed_patterns(self) -> List[Dict[str, Any]]:
        rows = self.conn.execute(
            "SELECT * FROM patterns WHERE status = 'confirmed' ORDER BY evidence_count DESC"
        ).fetchall()
        return [dict(r) for r in rows]

    def list_all_patterns(self) -> List[Dict[str, Any]]:
        rows = self.conn.execute("SELECT * FROM patterns ORDER BY updated_at DESC").fetchall()
        return [dict(r) for r in rows]

    # ------------------------------------------------------------------
    # Observations (append-only)
    # ------------------------------------------------------------------

    def record_observations(
        self,
        pattern_id: str,
        transaction_ids: List[str],
        run_id: str,
    ) -> int:
        """Append observations linking a pattern to specific transactions."""
        rows = [(_new_id(), pattern_id, tid, run_id) for tid in transaction_ids]
        self.conn.executemany(
            """INSERT INTO pattern_observations
                (id, pattern_id, transaction_id, run_id)
            VALUES (?, ?, ?, ?)""",
            rows,
        )
        self.conn.commit()
        return len(rows)

    def get_observations_for_pattern(self, pattern_id: str) -> List[Dict[str, Any]]:
        rows = self.conn.execute(
            "SELECT * FROM pattern_observations WHERE pattern_id = ? ORDER BY observed_at",
            (pattern_id,),
        ).fetchall()
        return [dict(r) for r in rows]

    # ------------------------------------------------------------------
    # Discovery runs
    # ------------------------------------------------------------------

    def start_run(self, data_source: str) -> str:
        rid = _new_id()
        self.conn.execute(
            """INSERT INTO discovery_runs (id, data_source) VALUES (?, ?)""",
            (rid, data_source),
        )
        self.conn.commit()
        return rid

    def complete_run(
        self,
        run_id: str,
        candidates_proposed: int,
        candidates_confirmed: int,
        candidates_rejected: int,
        candidates_uncertain: int,
        duration_ms: int,
        status: str = "completed",
        error_message: Optional[str] = None,
    ) -> None:
        self.conn.execute(
            """UPDATE discovery_runs SET
                candidates_proposed = ?,
                candidates_confirmed = ?,
                candidates_rejected = ?,
                candidates_uncertain = ?,
                duration_ms = ?,
                status = ?,
                error_message = ?,
                completed_at = ?
            WHERE id = ?""",
            (candidates_proposed, candidates_confirmed, candidates_rejected,
             candidates_uncertain, duration_ms, status, error_message,
             datetime.utcnow().isoformat(), run_id),
        )
        self.conn.commit()

    def get_run(self, run_id: str) -> Optional[Dict[str, Any]]:
        row = self.conn.execute(
            "SELECT * FROM discovery_runs WHERE id = ?", (run_id,)
        ).fetchone()
        return dict(row) if row else None

    # ------------------------------------------------------------------
    # For Worker prompt context
    # ------------------------------------------------------------------

    def get_prior_patterns_json(self) -> str:
        """Serialize confirmed patterns as JSON for the Worker prompt."""
        patterns = self.list_confirmed_patterns()
        return json.dumps(
            [
                {
                    "name": p["name"],
                    "description": p["description"],
                    "category": p["category"],
                    "detection_signature": p["detection_signature"],
                    "evidence_count": p["evidence_count"],
                }
                for p in patterns
            ],
            indent=2,
        )
