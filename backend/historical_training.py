from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from math import sqrt
from statistics import mean, pstdev

START_DATE = date(2022, 1, 1)
INSTRUMENT_KEY = "NSE_INDEX|Nifty 50"
HOLDOUT_FRACTION = 0.20
MIN_TRAINING_DAYS = 500
MIN_VALIDATION_DAYS = 100


@dataclass(frozen=True)
class DailyRegime:
    day: str
    gap_pct: float
    range_pct: float
    return_pct: float
    realized_vol_pct: float


def _percentile(values: list[float], percentile: float) -> float:
    ordered = sorted(values)
    if not ordered:
        return 0.0
    index = min(len(ordered) - 1, max(0, round((len(ordered) - 1) * percentile)))
    return ordered[index]


def candles_to_daily(candles: list[list]) -> list[DailyRegime]:
    grouped: dict[str, list[list]] = {}
    for candle in sorted(candles, key=lambda item: item[0]):
        grouped.setdefault(str(candle[0])[:10], []).append(candle)
    result: list[DailyRegime] = []
    previous_close: float | None = None
    for day, rows in sorted(grouped.items()):
        opening, close = float(rows[0][1]), float(rows[-1][4])
        high = max(float(row[2]) for row in rows)
        low = min(float(row[3]) for row in rows)
        intraday_returns = []
        for older, newer in zip(rows, rows[1:]):
            old_close = float(older[4])
            if old_close:
                intraday_returns.append((float(newer[4]) / old_close - 1) * 100)
        gap = ((opening / previous_close - 1) * 100) if previous_close else 0.0
        result.append(DailyRegime(
            day=day,
            gap_pct=round(gap, 5),
            range_pct=round((high - low) / opening * 100, 5),
            return_pct=round((close / opening - 1) * 100, 5),
            realized_vol_pct=round(pstdev(intraday_returns) * sqrt(len(intraday_returns)) if len(intraday_returns) > 1 else 0.0, 5),
        ))
        previous_close = close
    return result


def train_loss_avoidance_filter(days: list[DailyRegime]) -> dict:
    split = int(len(days) * (1 - HOLDOUT_FRACTION))
    training, validation = days[:split], days[split:]
    if len(training) < MIN_TRAINING_DAYS or len(validation) < MIN_VALIDATION_DAYS:
        return {"activated": False, "reason": "INSUFFICIENT_HISTORY", "training_days": len(training), "validation_days": len(validation)}
    thresholds = {
        "max_abs_gap_pct": round(_percentile([abs(d.gap_pct) for d in training], 0.90), 4),
        "max_range_pct": round(_percentile([d.range_pct for d in training], 0.90), 4),
        "max_realized_vol_pct": round(_percentile([d.realized_vol_pct for d in training], 0.90), 4),
    }
    def accepted(day: DailyRegime) -> bool:
        return abs(day.gap_pct) <= thresholds["max_abs_gap_pct"] and day.range_pct <= thresholds["max_range_pct"] and day.realized_vol_pct <= thresholds["max_realized_vol_pct"]
    accepted_validation = [day for day in validation if accepted(day)]
    stress_rate = mean([abs(day.return_pct) >= 1.0 for day in accepted_validation]) if accepted_validation else 1.0
    baseline_stress_rate = mean([abs(day.return_pct) >= 1.0 for day in validation])
    activated = len(accepted_validation) >= 60 and stress_rate < baseline_stress_rate
    return {
        "activated": activated,
        "model_type": "MARKET_REGIME_FILTER",
        "purpose": "Reject historically unstable conditions; never estimate option profit probability",
        "history_start": days[0].day,
        "history_end": days[-1].day,
        "training_days": len(training),
        "validation_days": len(validation),
        "accepted_validation_days": len(accepted_validation),
        "validation_stress_rate": round(stress_rate, 4),
        "baseline_stress_rate": round(baseline_stress_rate, 4),
        "thresholds": thresholds,
        "guardrails_locked": True,
    }


def regime_is_safe(day: DailyRegime, report: dict | None) -> tuple[bool, list[str]]:
    if not report or not report.get("activated"):
        return True, ["Historical regime filter is not active"]
    thresholds = report.get("thresholds") or {}
    checks = {
        "opening gap": abs(day.gap_pct) <= float(thresholds.get("max_abs_gap_pct", 0)),
        "intraday range": day.range_pct <= float(thresholds.get("max_range_pct", 0)),
        "realized volatility": day.realized_vol_pct <= float(thresholds.get("max_realized_vol_pct", 0)),
    }
    failed = [name for name, passed in checks.items() if not passed]
    return not failed, failed or ["Current market regime is within validated thresholds"]


async def fetch_history(start: date = START_DATE, end: date | None = None) -> list[list]:
    import httpx
    from upstox import MARKET_API_BASE_URL, UpstoxMarketDataError, _analytics_headers

    end = end or date.today()
    candles: list[list] = []
    cursor = start
    async with httpx.AsyncClient(timeout=40.0) as client:
        while cursor <= end:
            period_end = min(cursor + timedelta(days=89), end)
            key = httpx.URL("https://x/" + INSTRUMENT_KEY).raw_path.decode().split("/", 1)[1]
            url = f"{MARKET_API_BASE_URL}/v3/historical-candle/{key}/minutes/30/{period_end.isoformat()}/{cursor.isoformat()}"
            response = await client.get(url, headers=_analytics_headers())
            if response.status_code != 200:
                raise UpstoxMarketDataError(f"Historical candles failed for {cursor} to {period_end}: HTTP {response.status_code}")
            candles.extend(response.json().get("data", {}).get("candles", []))
            cursor = period_end + timedelta(days=1)
            await asyncio.sleep(0.15)
    unique = {str(candle[0]): candle for candle in candles}
    return list(unique.values())


async def run_training() -> dict:
    from database import save_training_run

    started = datetime.now(timezone.utc)
    candles = await fetch_history()
    report = train_loss_avoidance_filter(candles_to_daily(candles))
    report["trained_at"] = started.isoformat()
    report["candle_count"] = len(candles)
    save_training_run(report)
    return report


if __name__ == "__main__":
    print(json.dumps(asyncio.run(run_training()), indent=2))
