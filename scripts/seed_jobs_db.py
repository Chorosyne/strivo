#!/usr/bin/env python3
"""Seed a jobs.db with N synthetic 'Recording' rows matching the exact
schema/JSON shape strivo-core's PersistDb reads (src/recording/persist.rs,
src/recording/job.rs) — used for the V07 pooled-connection A/B/C benchmark.
Idempotent: drops+recreates the file at the given path.
"""
import json
import random
import sqlite3
import sys
import uuid
from datetime import datetime, timedelta, timezone

SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
    id           TEXT PRIMARY KEY,
    kind         TEXT NOT NULL,
    payload      TEXT NOT NULL,
    state        TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    attempts     INTEGER NOT NULL DEFAULT 0,
    last_error   TEXT,
    episode_dir  TEXT
);
CREATE INDEX IF NOT EXISTS idx_jobs_state ON jobs(state);
CREATE INDEX IF NOT EXISTS idx_jobs_kind_updated ON jobs(kind, updated_at DESC);

CREATE TABLE IF NOT EXISTS catalog (
    platform        TEXT NOT NULL,
    channel_id      TEXT NOT NULL,
    vod_id          TEXT NOT NULL,
    title           TEXT NOT NULL,
    published_at    TEXT,
    episode_dir     TEXT,
    recorded_at     TEXT,
    transcribed_at  TEXT,
    PRIMARY KEY (platform, channel_id, vod_id)
);
CREATE INDEX IF NOT EXISTS idx_catalog_recorded ON catalog(recorded_at);

CREATE TABLE IF NOT EXISTS blocklist (
    platform    TEXT NOT NULL,
    channel_id  TEXT NOT NULL,
    vod_id      TEXT NOT NULL DEFAULT '',
    reason      TEXT,
    created_at  TEXT NOT NULL,
    PRIMARY KEY (platform, channel_id, vod_id)
);
"""

PLATFORMS = ["Twitch", "YouTube", "Patreon"]
STATES = ["finished"] * 8 + ["failed"] * 1 + ["interrupted"] * 1


def rfc3339(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def main():
    path = sys.argv[1]
    n = int(sys.argv[2]) if len(sys.argv) > 2 else 50_000

    conn = sqlite3.connect(path)
    conn.executescript(SCHEMA)
    conn.execute("PRAGMA journal_mode=WAL")

    base = datetime(2024, 1, 1, tzinfo=timezone.utc)
    rows = []
    for i in range(n):
        job_id = str(uuid.uuid4())
        started = base + timedelta(minutes=i * 3)
        updated = started + timedelta(minutes=random.randint(5, 240))
        state = STATES[i % len(STATES)]
        journal_state = "finished" if state == "finished" else state
        job_state = "Finished" if state == "finished" else "Failed"
        channel_id = f"channel-{i % 500}"
        payload = {
            "id": job_id,
            "channel_id": channel_id,
            "channel_name": f"Channel {i % 500}",
            "platform": PLATFORMS[i % len(PLATFORMS)],
            "state": job_state,
            "output_path": f"/data/recordings/{channel_id}/{job_id}.mkv",
            "started_at": rfc3339(started),
            "bytes_written": random.randint(10_000_000, 5_000_000_000),
            "duration_secs": random.uniform(300, 14400),
            "transcode": bool(i % 3 == 0),
            "error": "stream ended unexpectedly" if state == "failed" else None,
            "stream_title": f"Synthetic stream #{i}",
            "watched": bool(i % 5 == 0),
            "playlist": None,
            "thumbnail_url": f"https://example.invalid/thumb/{job_id}.jpg",
            "source_url": None,
        }
        rows.append(
            (
                job_id,
                "Recording",
                json.dumps(payload),
                journal_state,
                rfc3339(started),
                rfc3339(updated),
                0,
                payload["error"],
                None,
            )
        )

    conn.executemany(
        """INSERT INTO jobs
           (id, kind, payload, state, created_at, updated_at, attempts, last_error, episode_dir)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        rows,
    )
    conn.commit()
    conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    count = conn.execute("SELECT COUNT(*) FROM jobs").fetchone()[0]
    conn.close()
    print(f"seeded {count} rows into {path}")


if __name__ == "__main__":
    main()
