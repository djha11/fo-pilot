import json
import os
from contextlib import contextmanager

import psycopg

from learning import LearningProfile, build_profile


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
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS completed_paper_trades (
                id BIGSERIAL PRIMARY KEY,
                opportunity_id TEXT NOT NULL UNIQUE,
                strategy TEXT NOT NULL,
                expiry_day BOOLEAN NOT NULL,
                opened_at TIMESTAMPTZ,
                closed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                predicted_pop NUMERIC NOT NULL CHECK (predicted_pop BETWEEN 0 AND 1),
                planned_max_loss_inr NUMERIC NOT NULL CHECK (planned_max_loss_inr > 0),
                realized_pnl_inr NUMERIC NOT NULL,
                charges_inr NUMERIC NOT NULL DEFAULT 0,
                exit_reason TEXT NOT NULL,
                market_features JSONB NOT NULL DEFAULT '{}'::jsonb
            )
            """
        )
        conn.commit()
        return True


def save_completed_trade(trade: dict) -> bool:
    with connection() as conn:
        if conn is None:
            return False
        conn.execute(
            """
            INSERT INTO completed_paper_trades
                (opportunity_id, strategy, expiry_day, opened_at, closed_at,
                 predicted_pop, planned_max_loss_inr, realized_pnl_inr,
                 charges_inr, exit_reason, market_features)
            VALUES (%s, %s, %s, %s, COALESCE(%s, NOW()), %s, %s, %s, %s, %s, %s::jsonb)
            ON CONFLICT (opportunity_id) DO UPDATE SET
                closed_at = EXCLUDED.closed_at,
                realized_pnl_inr = EXCLUDED.realized_pnl_inr,
                charges_inr = EXCLUDED.charges_inr,
                exit_reason = EXCLUDED.exit_reason,
                market_features = EXCLUDED.market_features
            """,
            (
                trade["opportunity_id"], trade["strategy"], trade["expiry_day"],
                trade.get("opened_at"), trade.get("closed_at"), trade["predicted_pop"],
                trade["planned_max_loss_inr"], trade["realized_pnl_inr"],
                trade.get("charges_inr", 0), trade["exit_reason"],
                json.dumps(trade.get("market_features") or {}),
            ),
        )
        conn.commit()
        return True


def load_learning_profiles() -> dict[tuple[str, bool], LearningProfile]:
    with connection() as conn:
        if conn is None:
            return {}
        rows = conn.execute(
            """
            SELECT strategy, expiry_day, COUNT(*) AS total,
                   COUNT(*) FILTER (WHERE realized_pnl_inr - charges_inr > 0) AS wins
            FROM completed_paper_trades
            GROUP BY strategy, expiry_day
            """
        ).fetchall()
    return {
        (row[0], row[1]): build_profile(row[0], row[1], row[3], row[2])
        for row in rows
    }


def learning_summary() -> dict:
    profiles = list(load_learning_profiles().values())
    total = sum(profile.completed_trades for profile in profiles)
    wins = sum(profile.profitable_trades for profile in profiles)
    return {
        "mode": "ACTIVE" if any(profile.active for profile in profiles) else "COLLECTING_EVIDENCE",
        "completed_trades": total,
        "profitable_trades": wins,
        "minimum_samples_per_group": 30,
        "guardrails_locked": True,
        "profiles": [profile.__dict__ for profile in profiles],
    }


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
