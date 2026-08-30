"""
The off-chain trail store.

The chain holds ``keccak256(trail)``; this holds the trail. That split is the
whole point of the design — an agent's reasoning stays private until someone
challenges it, and when it is revealed the hash proves it was not rewritten in
the meantime.

SQLite because the store has exactly one writer, needs to survive a restart, and
should not be another service a judge has to install. Rows are keyed by
attestation id and carry the trail hash the orchestrator committed, so a lookup
can be verified without trusting the row.
"""

from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path
from typing import Any

from .canonical import hash_trail
from .models import DecisionTrail

__all__ = ["TrailStore"]

_SCHEMA = """
CREATE TABLE IF NOT EXISTS trails (
    attestation_id INTEGER PRIMARY KEY,
    agent_id       INTEGER NOT NULL,
    trail_hash     TEXT    NOT NULL,
    body           TEXT    NOT NULL,
    source         TEXT    NOT NULL,
    model          TEXT,
    created_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS trails_by_hash  ON trails (trail_hash);
CREATE INDEX IF NOT EXISTS trails_by_agent ON trails (agent_id);
"""


class TrailStore:
    """Durable trail storage, keyed by attestation id and indexed by hash.

    Safe to call from the request handlers and the orchestrator loop at the same
    time: every call takes a lock and uses its own short-lived cursor.
    """

    def __init__(self, path: Path | str):
        self._path = Path(path)
        self._lock = threading.Lock()
        if self._path.parent != Path(""):
            self._path.parent.mkdir(parents=True, exist_ok=True)
        # check_same_thread=False because FastAPI's threadpool and the
        # orchestrator task are different threads; the lock does the guarding.
        self._db = sqlite3.connect(str(self._path), check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        with self._lock:
            self._db.executescript(_SCHEMA)
            self._db.commit()

    def close(self) -> None:
        with self._lock:
            self._db.close()

    # ----------------------------------------------------------------- writes

    def put(
        self,
        *,
        attestation_id: int,
        agent_id: int,
        body: dict[str, Any],
        trail_hash: str,
        source: str,
        model: str | None,
        created_at: int,
    ) -> None:
        """Stores a trail body against its commitment.

        Rejects a body whose hash does not match the commitment being recorded:
        a store that can hold a trail the chain never committed to is a store
        that can be used to lie about what an agent decided.
        """
        recomputed = hash_trail(body)
        if recomputed.lower() != trail_hash.lower():
            raise ValueError(
                f"refusing to store trail for attestation {attestation_id}: "
                f"body hashes to {recomputed}, commitment is {trail_hash}"
            )

        with self._lock:
            self._db.execute(
                """
                INSERT INTO trails (attestation_id, agent_id, trail_hash, body, source, model, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(attestation_id) DO UPDATE SET
                    agent_id   = excluded.agent_id,
                    trail_hash = excluded.trail_hash,
                    body       = excluded.body,
                    source     = excluded.source,
                    model      = excluded.model,
                    created_at = excluded.created_at
                """,
                (
                    attestation_id,
                    agent_id,
                    trail_hash,
                    json.dumps(body, ensure_ascii=False),
                    source,
                    model,
                    created_at,
                ),
            )
            self._db.commit()

    def clear(self) -> None:
        with self._lock:
            self._db.execute("DELETE FROM trails")
            self._db.commit()

    # ------------------------------------------------------------------ reads

    def get(self, attestation_id: int) -> DecisionTrail | None:
        """The revealed trail for an attestation, or None if it was never stored."""
        with self._lock:
            row = self._db.execute(
                "SELECT * FROM trails WHERE attestation_id = ?", (attestation_id,)
            ).fetchone()
        if row is None:
            return None

        body = json.loads(row["body"])
        return DecisionTrail(
            attestationId=row["attestation_id"],
            agentId=row["agent_id"],
            policy=body["policy"],
            inputs=body["inputs"],
            reasoning=body["reasoning"],
            output=body["output"],
            source=row["source"],
            model=row["model"],
            nonce=body["nonce"],
            trailHash=row["trail_hash"],
        )

    def body(self, attestation_id: int) -> dict[str, Any] | None:
        """The raw committed body, as it was hashed."""
        with self._lock:
            row = self._db.execute(
                "SELECT body FROM trails WHERE attestation_id = ?", (attestation_id,)
            ).fetchone()
        return json.loads(row["body"]) if row else None

    def count(self) -> int:
        with self._lock:
            return int(self._db.execute("SELECT COUNT(*) FROM trails").fetchone()[0])
