import json
import os
import hashlib
import hmac
import secrets
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
            CREATE TABLE IF NOT EXISTS paper_positions (
                id BIGSERIAL PRIMARY KEY,
                opportunity_id TEXT NOT NULL,
                strategy TEXT NOT NULL,
                expiry TEXT NOT NULL,
                expiry_day BOOLEAN NOT NULL DEFAULT FALSE,
                predicted_pop NUMERIC NOT NULL,
                planned_max_loss_inr NUMERIC NOT NULL,
                max_profit_inr NUMERIC NOT NULL,
                quantity INTEGER NOT NULL,
                legs JSONB NOT NULL,
                rationale JSONB NOT NULL DEFAULT '[]'::jsonb,
                market_features JSONB NOT NULL DEFAULT '{}'::jsonb,
                status TEXT NOT NULL DEFAULT 'OPEN',
                opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                closed_at TIMESTAMPTZ,
                realized_pnl_inr NUMERIC,
                charges_inr NUMERIC NOT NULL DEFAULT 40,
                exit_reason TEXT
            )
            """
        )
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
            CREATE TABLE IF NOT EXISTS training_runs (
                id BIGSERIAL PRIMARY KEY,
                trained_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                model_type TEXT NOT NULL,
                activated BOOLEAN NOT NULL,
                report JSONB NOT NULL
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
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS engine_settings (
                key TEXT PRIMARY KEY,
                value JSONB NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        conn.execute("""
            CREATE TABLE IF NOT EXISTS dashboard_users (
                email TEXT PRIMARY KEY,
                password_hash TEXT,
                verified_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS dashboard_otps (
                email TEXT PRIMARY KEY REFERENCES dashboard_users(email) ON DELETE CASCADE,
                otp_hash TEXT NOT NULL,
                expires_at TIMESTAMPTZ NOT NULL,
                attempts INTEGER NOT NULL DEFAULT 0,
                requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS dashboard_sessions (
                token_hash TEXT PRIMARY KEY,
                email TEXT NOT NULL REFERENCES dashboard_users(email) ON DELETE CASCADE,
                purpose TEXT NOT NULL,
                expires_at TIMESTAMPTZ NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """)
        conn.commit()
        return True


def ensure_dashboard_users(emails: set[str]) -> None:
    with connection() as conn:
        if conn is None:
            raise RuntimeError("Database unavailable")
        for email in emails:
            conn.execute("INSERT INTO dashboard_users(email) VALUES (%s) ON CONFLICT DO NOTHING", (email,))
        conn.commit()


def save_dashboard_otp(email: str, otp_hash: str) -> None:
    with connection() as conn:
        if conn is None:
            raise RuntimeError("Database unavailable")
        conn.execute("DELETE FROM dashboard_sessions WHERE expires_at < NOW()")
        conn.execute("""INSERT INTO dashboard_otps(email, otp_hash, expires_at)
            VALUES (%s,%s,NOW() + INTERVAL '10 minutes')
            ON CONFLICT(email) DO UPDATE SET otp_hash=EXCLUDED.otp_hash,
            expires_at=EXCLUDED.expires_at, attempts=0, requested_at=NOW()""", (email, otp_hash))
        conn.commit()


def verify_dashboard_otp(email: str, otp_hash: str) -> bool:
    with connection() as conn:
        if conn is None:
            return False
        row = conn.execute("""UPDATE dashboard_otps SET attempts=attempts+1
            WHERE email=%s AND expires_at>NOW() AND attempts<5
            RETURNING otp_hash""", (email,)).fetchone()
        if not row or not hmac.compare_digest(row[0], otp_hash):
            conn.commit()
            return False
        conn.execute("DELETE FROM dashboard_otps WHERE email=%s", (email,))
        conn.execute("UPDATE dashboard_users SET verified_at=NOW(), updated_at=NOW() WHERE email=%s", (email,))
        conn.commit()
        return True


def set_dashboard_password(email: str, password_hash: str) -> None:
    with connection() as conn:
        if conn is None:
            raise RuntimeError("Database unavailable")
        conn.execute("UPDATE dashboard_users SET password_hash=%s, updated_at=NOW() WHERE email=%s AND verified_at IS NOT NULL", (password_hash, email))
        conn.commit()


def dashboard_password_hash(email: str) -> str | None:
    with connection() as conn:
        if conn is None:
            return None
        row = conn.execute("SELECT password_hash FROM dashboard_users WHERE email=%s", (email,)).fetchone()
        return row[0] if row else None


def create_dashboard_session(email: str, purpose: str = "access", hours: int = 12) -> str:
    token = secrets.token_urlsafe(32)
    digest = hashlib.sha256(token.encode()).hexdigest()
    with connection() as conn:
        if conn is None:
            raise RuntimeError("Database unavailable")
        conn.execute("INSERT INTO dashboard_sessions(token_hash,email,purpose,expires_at) VALUES (%s,%s,%s,NOW()+(%s * INTERVAL '1 hour'))", (digest, email, purpose, hours))
        conn.commit()
    return token


def consume_dashboard_session(token: str, purpose: str, delete: bool = False) -> str | None:
    digest = hashlib.sha256(token.encode()).hexdigest()
    with connection() as conn:
        if conn is None:
            return None
        row = conn.execute("SELECT email FROM dashboard_sessions WHERE token_hash=%s AND purpose=%s AND expires_at>NOW()", (digest, purpose)).fetchone()
        if row and delete:
            conn.execute("DELETE FROM dashboard_sessions WHERE token_hash=%s", (digest,))
            conn.commit()
        return row[0] if row else None


def delete_dashboard_session(token: str) -> None:
    digest = hashlib.sha256(token.encode()).hexdigest()
    with connection() as conn:
        if conn is not None:
            conn.execute("DELETE FROM dashboard_sessions WHERE token_hash=%s", (digest,))
            conn.commit()


def get_engine_setting(key: str, default=None):
    with connection() as conn:
        if conn is None:
            return default
        row = conn.execute("SELECT value FROM engine_settings WHERE key=%s", (key,)).fetchone()
        return row[0] if row else default


def set_engine_setting(key: str, value):
    with connection() as conn:
        if conn is None:
            return False
        conn.execute(
            """INSERT INTO engine_settings (key, value) VALUES (%s, %s::jsonb)
               ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()""",
            (key, json.dumps(value)),
        )
        conn.commit()
        return True


def open_paper_position(candidate: dict) -> dict | None:
    with connection() as conn:
        if conn is None:
            return None
        existing = conn.execute(
            "SELECT id FROM paper_positions WHERE status = 'OPEN' LIMIT 1"
        ).fetchone()
        if existing:
            return None
        row = conn.execute(
            """
            INSERT INTO paper_positions
                (opportunity_id, strategy, expiry, expiry_day, predicted_pop,
                 planned_max_loss_inr, max_profit_inr, quantity, legs, rationale,
                 market_features)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s::jsonb,%s::jsonb)
            RETURNING id
            """,
            (
                candidate["id"], candidate["strategy"], candidate["expiry"],
                candidate.get("expiry_day", False), candidate["probability_of_profit"],
                candidate["max_loss_inr"], candidate["max_profit_inr"],
                candidate["legs"][0]["quantity"], json.dumps(candidate["legs"]),
                json.dumps(candidate.get("rationale", [])),
                json.dumps({"underlying_spot": candidate.get("underlying_spot")}),
            ),
        ).fetchone()
        conn.commit()
        return get_paper_position(row[0])


def _position(row) -> dict:
    keys = ["id", "opportunity_id", "strategy", "expiry", "expiry_day",
            "predicted_pop", "planned_max_loss_inr", "max_profit_inr", "quantity",
            "legs", "rationale", "market_features", "status", "opened_at",
            "closed_at", "realized_pnl_inr", "charges_inr", "exit_reason"]
    result = dict(zip(keys, row))
    for key in ("predicted_pop", "planned_max_loss_inr", "max_profit_inr", "realized_pnl_inr", "charges_inr"):
        if result.get(key) is not None:
            result[key] = float(result[key])
    for key in ("opened_at", "closed_at"):
        if result.get(key):
            result[key] = result[key].isoformat()
    return result


def get_paper_position(position_id: int) -> dict | None:
    with connection() as conn:
        if conn is None:
            return None
        row = conn.execute("SELECT * FROM paper_positions WHERE id = %s", (position_id,)).fetchone()
        return _position(row) if row else None


def current_paper_position() -> dict | None:
    with connection() as conn:
        if conn is None:
            return None
        row = conn.execute("SELECT * FROM paper_positions WHERE status = 'OPEN' ORDER BY id DESC LIMIT 1").fetchone()
        return _position(row) if row else None


def close_paper_position(position_id: int, pnl: float, reason: str) -> dict | None:
    with connection() as conn:
        if conn is None:
            return None
        row = conn.execute(
            """UPDATE paper_positions SET status='CLOSED', closed_at=NOW(),
               realized_pnl_inr=%s, exit_reason=%s WHERE id=%s AND status='OPEN'
               RETURNING *""", (pnl, reason, position_id)
        ).fetchone()
        conn.commit()
        return _position(row) if row else None


def paper_trading_summary() -> dict:
    with connection() as conn:
        if conn is None:
            return {"positions": [], "daily_realized_pnl_inr": 0.0}
        rows = conn.execute("SELECT * FROM paper_positions ORDER BY id DESC LIMIT 1000").fetchall()
        daily = conn.execute(
            """SELECT COALESCE(SUM(realized_pnl_inr), 0)
               FROM paper_positions WHERE status='CLOSED'
               AND closed_at >= date_trunc('day', NOW() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'"""
        ).fetchone()[0]
        total = conn.execute(
            """SELECT COALESCE(SUM(realized_pnl_inr), 0)
               FROM paper_positions WHERE status='CLOSED'"""
        ).fetchone()[0]
        trades_today = conn.execute(
            """SELECT COUNT(*) FROM paper_positions
               WHERE opened_at >= date_trunc('day', NOW() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'"""
        ).fetchone()[0]
        return {
            "positions": [_position(row) for row in rows],
            "daily_realized_pnl_inr": float(daily),
            "total_realized_pnl_inr": float(total),
            "new_trades_today": int(trades_today),
        }


def save_training_run(report: dict) -> bool:
    with connection() as conn:
        if conn is None:
            return False
        conn.execute(
            """INSERT INTO training_runs (model_type, activated, report)
               VALUES (%s, %s, %s::jsonb)""",
            (report.get("model_type", "MARKET_REGIME_FILTER"), bool(report.get("activated")), json.dumps(report)),
        )
        conn.commit()
        return True


def latest_training_run() -> dict | None:
    with connection() as conn:
        if conn is None:
            return None
        row = conn.execute("SELECT report FROM training_runs ORDER BY trained_at DESC LIMIT 1").fetchone()
        return row[0] if row else None


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
                int((payload.get("research") or {}).get("qualified_candidates", len(items))),
                json.dumps(payload),
            ),
        )
        conn.commit()
        return True
