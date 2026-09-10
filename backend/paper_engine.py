from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from database import (
    close_paper_position,
    current_paper_position,
    open_paper_position,
    paper_trading_summary,
    save_completed_trade,
)
from strategy_config import (
    MAX_NEW_TRADES_PER_DAY, PAPER_MAX_DAILY_LOSS_INR,
    PAPER_MAX_LOSS_PER_TRADE_INR,
    PAPER_MIN_POP, PROFIT_TARGET_RATIO,
)

IST = ZoneInfo("Asia/Kolkata")
PROFIT_CAPTURE_RATIO = PROFIT_TARGET_RATIO
TIME_EXIT_HOUR = 15
TIME_EXIT_MINUTE = 15


def paper_pnl(position: dict, chain_rows: list[dict]) -> float | None:
    options = {}
    for row in chain_rows:
        for side in ("call_options", "put_options"):
            option = row.get(side) or {}
            key = option.get("instrument_key")
            if key:
                options[key] = option.get("market_data") or {}
    total = 0.0
    for leg in position["legs"]:
        market = options.get(leg["instrument_token"])
        if not market:
            return None
        entry = float(leg["entry_price"])
        quantity = int(leg["quantity"])
        if leg["transaction_type"] == "SELL":
            exit_price = float(market.get("ask_price") or 0)
            total += (entry - exit_price) * quantity
        else:
            exit_price = float(market.get("bid_price") or 0)
            total += (exit_price - entry) * quantity
    return round(total - float(position.get("charges_inr") or 0), 2)


def maybe_exit(position: dict, pnl: float, now: datetime | None = None, manual: bool = False) -> dict | None:
    now = now or datetime.now(IST)
    reason = None
    if manual:
        reason = "MANUAL_EXIT"
    elif pnl >= float(position["max_profit_inr"]) * PROFIT_CAPTURE_RATIO:
        reason = "PROFIT_TARGET"
    elif pnl <= -float(position["planned_max_loss_inr"]):
        reason = "MAX_LOSS_GUARD"
    elif (now.hour, now.minute) >= (TIME_EXIT_HOUR, TIME_EXIT_MINUTE):
        reason = "TIME_EXIT_15_15"
    if not reason:
        return None
    closed = close_paper_position(position["id"], pnl, reason)
    if closed:
        save_completed_trade({
            "opportunity_id": f"{closed['opportunity_id']}-{closed['id']}",
            "strategy": closed["strategy"], "expiry_day": closed["expiry_day"],
            "opened_at": closed["opened_at"], "closed_at": closed["closed_at"],
            "predicted_pop": closed["predicted_pop"],
            "planned_max_loss_inr": closed["planned_max_loss_inr"],
            # completed_paper_trades stores gross P&L and subtracts charges in learning.
            "realized_pnl_inr": closed["realized_pnl_inr"] + closed["charges_inr"],
            "charges_inr": closed["charges_inr"], "exit_reason": reason,
            "market_features": closed.get("market_features") or {},
        })
    return closed


def maybe_enter(candidates: list[dict], market_open: bool) -> dict | None:
    if not market_open or not candidates or current_paper_position():
        return None
    summary = paper_trading_summary()
    if summary["daily_realized_pnl_inr"] <= -PAPER_MAX_DAILY_LOSS_INR:
        return None
    if summary.get("new_trades_today", 0) >= MAX_NEW_TRADES_PER_DAY:
        return None
    candidate = candidates[0]
    remaining_daily_risk = PAPER_MAX_DAILY_LOSS_INR + min(0.0, summary["daily_realized_pnl_inr"])
    if not candidate.get("qualified_for_paper_entry", False):
        return None
    if candidate["probability_of_profit"] < PAPER_MIN_POP or candidate["max_loss_inr"] > PAPER_MAX_LOSS_PER_TRADE_INR:
        return None
    if candidate["max_loss_inr"] > remaining_daily_risk:
        return None
    return open_paper_position(candidate)
