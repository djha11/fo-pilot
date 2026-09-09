import json
import os
from contextlib import contextmanager

import psycopg


def _connection_config() -> str | dict | None:
    if os.getenv("DATABASE_URL"):
        return os.environ["DATABASE_URL"]
    password = os.getenv("POSTGRES_PASSWORD")
    user = os.getenv("POSTGRES_USER", "postgres")
    database = os.getenv("POSTGRES_DB", "postgres")
    if not password:
        return None
    return {
        "host": "fo-pilot-postgres",
        "port": 5432,
        "user": user,
        "password": password,
        "dbname": database,
    }


@contextmanager
def connection():
    config = _connection_config()
    if not config:
        yield None
        return
    kwargs = {"conninfo": config} if isinstance(config, str) else config
    with psycopg.connect(**kwargs, connect_timeout=5) as conn:
        yield conn


def initialise_database() -> bool:
    with connection() as conn:
        if conn is None:
            return False
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS market_scans (
                id BIGSERIAL PRIMARY KEY,
                scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                underlying TEXT NOT NULL,
                spot NUMERIC,
                decision TEXT NOT NULL,
                qualified_count INTEGER NOT NULL,
                payload JSONB NOT NULL
            )
            """
        )
        conn.commit()
        return True


def save_scan(payload: dict) -> bool:
    with connection() as conn:
        if conn is None:
            return False
        items = payload.get("items") or []
        spot = items[0].get("underlying_spot") if items else payload.get("spot")
        conn.execute(
            """
            INSERT INTO market_scans
                (underlying, spot, decision, qualified_count, payload)
            VALUES (%s, %s, %s, %s, %s::jsonb)
            """,
            (
                "NIFTY 50",
                spot,
                payload.get("decision", "NO_TRADE"),
                len(items),
                json.dumps(payload),
            ),
        )
        conn.commit()
        return True
