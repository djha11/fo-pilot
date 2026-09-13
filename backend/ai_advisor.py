import asyncio
import json
import os
import time
from pathlib import Path

import httpx


OPENAI_URL = "https://api.openai.com/v1/responses"
DEFAULT_MODEL = "gpt-5.4-mini"
MIN_REFRESH_SECONDS = 900
MAX_CALLS_PER_DAY = 20
MAX_OUTPUT_TOKENS = 700
SECRET_FILE = Path("/run/secrets/openai.env")

_cache: dict = {}
_lock = asyncio.Lock()
_day = ""
_calls_today = 0


def _api_key() -> str:
    value = os.getenv("OPENAI_API_KEY", "").strip()
    if value:
        return value
    try:
        for line in SECRET_FILE.read_text(encoding="utf-8").splitlines():
            if line.startswith("OPENAI_API_KEY="):
                return line.split("=", 1)[1].strip()
    except OSError:
        pass
    return ""


def status() -> dict:
    return {
        "configured": bool(_api_key()),
        "mode": "ADVISORY_ONLY",
        "model": os.getenv("OPENAI_MODEL", DEFAULT_MODEL),
        "minimum_refresh_seconds": MIN_REFRESH_SECONDS,
        "maximum_calls_per_day": MAX_CALLS_PER_DAY,
        "calls_today": _calls_today,
        "can_place_orders": False,
        "can_change_risk_settings": False,
    }


def _compact_snapshot(snapshot: dict) -> dict:
    candidates = snapshot.get("items", [])[:8]
    return {
        "as_of": snapshot.get("as_of"),
        "decision": snapshot.get("decision"),
        "market_regime": snapshot.get("current_regime"),
        "risk_policy": snapshot.get("risk_policy"),
        "learning": snapshot.get("learning"),
        "candidates": [
            {
                "id": item.get("id"),
                "rank": item.get("rank"),
                "strategy": item.get("strategy"),
                "expiry": item.get("expiry"),
                "pop": item.get("probability_of_profit"),
                "target_inr": item.get("profit_target_inr"),
                "max_profit_inr": item.get("max_profit_inr"),
                "max_loss_inr": item.get("max_loss_inr"),
                "target_reward_risk": item.get("target_reward_risk"),
                "expected_value_inr": item.get("expected_value_inr"),
                "qualified": item.get("qualified_for_paper_entry"),
                "rejection_reasons": item.get("rejection_reasons", []),
            }
            for item in candidates
        ],
    }


async def analyse(snapshot: dict, force: bool = False) -> dict:
    global _cache, _day, _calls_today
    now = time.time()
    today = time.strftime("%Y-%m-%d", time.gmtime(now))
    if _day != today:
        _day, _calls_today = today, 0
    if _cache and not force and now - _cache.get("generated_epoch", 0) < MIN_REFRESH_SECONDS:
        return _cache
    key = _api_key()
    if not key:
        return {**status(), "available": False, "reason": "OpenAI secret is not mounted"}
    if _calls_today >= MAX_CALLS_PER_DAY:
        return {**status(), "available": False, "reason": "Daily AI analysis limit reached"}

    async with _lock:
        if _cache and not force and now - _cache.get("generated_epoch", 0) < MIN_REFRESH_SECONDS:
            return _cache
        payload = {
            "model": os.getenv("OPENAI_MODEL", DEFAULT_MODEL),
            "store": False,
            "max_output_tokens": MAX_OUTPUT_TOKENS,
            "reasoning": {"effort": "low"},
            "instructions": (
                "You are an advisory risk analyst for a PAPER-ONLY Indian index-options dashboard. "
                "Analyse only the supplied snapshot. Never claim certainty or guaranteed profit. "
                "Do not place trades, change thresholds, or override mechanical risk/liquidity checks. "
                "Return concise JSON with keys: summary (string), regime (string), key_risks (array of strings), "
                "candidate_notes (array of objects with id and note), missing_evidence (array of strings), "
                "confidence (LOW, MEDIUM, or HIGH)."
            ),
            "input": json.dumps(_compact_snapshot(snapshot), separators=(",", ":"), default=str),
            "text": {"format": {"type": "json_object"}, "verbosity": "low"},
        }
        async with httpx.AsyncClient(timeout=45) as client:
            response = await client.post(
                OPENAI_URL,
                headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                json=payload,
            )
        _calls_today += 1
        if response.status_code >= 400:
            return {**status(), "available": False, "reason": f"OpenAI request failed ({response.status_code})"}
        body = response.json()
        output_text = body.get("output_text")
        if not output_text:
            output_text = "".join(
                content.get("text", "")
                for item in body.get("output", [])
                for content in item.get("content", [])
                if content.get("type") == "output_text"
            )
        try:
            analysis = json.loads(output_text)
        except (TypeError, json.JSONDecodeError):
            analysis = {"summary": output_text or "No analysis returned", "confidence": "LOW"}
        _cache = {
            **status(),
            "available": True,
            "analysis": analysis,
            "usage": body.get("usage", {}),
            "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now)),
            "generated_epoch": now,
        }
        return _cache
