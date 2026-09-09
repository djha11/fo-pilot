import gzip
import json
from datetime import datetime, timezone
from pathlib import Path

import httpx


NSE_INSTRUMENTS_URL = (
    "https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz"
)
CACHE_PATH = Path("/data/NSE.json.gz")


def refresh_nse_instruments() -> int:
    response = httpx.get(NSE_INSTRUMENTS_URL, timeout=60.0, follow_redirects=True)
    response.raise_for_status()
    CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    CACHE_PATH.write_bytes(response.content)
    return len(response.content)


def load_nifty_derivatives() -> list[dict]:
    if not CACHE_PATH.exists():
        refresh_nse_instruments()
    with gzip.open(CACHE_PATH, "rt", encoding="utf-8") as handle:
        records = json.load(handle)

    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    result = []
    for item in records:
        if item.get("segment") != "NSE_FO":
            continue
        if item.get("underlying_symbol") not in {"NIFTY", "NIFTY 50"}:
            continue
        if item.get("instrument_type") not in {"FUT", "CE", "PE"}:
            continue
        expiry = item.get("expiry")
        if isinstance(expiry, (int, float)) and expiry < now_ms:
            continue
        result.append(item)
    return sorted(
        result,
        key=lambda row: (
            row.get("expiry", 0),
            row.get("strike_price", 0),
            row.get("instrument_type", ""),
        ),
    )
