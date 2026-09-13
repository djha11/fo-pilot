import asyncio
from datetime import date, datetime, timedelta, timezone
from enum import Enum

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from instruments import load_nifty_derivatives, refresh_nse_instruments
from database import (
    current_paper_position,
    initialise_database,
    learning_summary,
    latest_training_run,
    load_learning_profiles,
    save_completed_trade,
    save_scan,
    paper_trading_summary,
    get_engine_setting,
    set_engine_setting,
)
from learning import apply_learning
from historical_training import DailyRegime, candles_to_daily, regime_is_safe
from scanner import scan_vertical_spreads
from paper_engine import maybe_enter, maybe_exit, paper_pnl
from market_clock import indian_market_date
from strategy_config import (
    CAPITAL_INR, EXPERIMENTAL_SCORE_WEIGHTS, MAX_DAILY_LOSS_INR,
    MAX_LOSS_PER_TRADE_INR, MAX_NEW_TRADES_PER_DAY,
    MAX_SIMULTANEOUS_STRATEGIES, MIN_EXPECTED_VALUE,
    MIN_TARGET_REWARD_RISK, MODEL_VERSION, PAPER_MAX_DAILY_LOSS_INR,
    PAPER_MAX_LOSS_PER_TRADE_INR, PAPER_MIN_POP, PAPER_MIN_TARGET_REWARD_RISK,
    PROFIT_TARGET_RATIO, REAL_MIN_POP, STRATEGY_VERSION,
)
from ai_advisor import analyse as ai_analyse, status as ai_status
from upstox import (
    UpstoxMarketDataError,
    UpstoxSandboxError,
    get_ltp,
    get_intraday_candles,
    get_historical_candles_range,
    get_market_status,
    get_option_chain,
    place_multi_order,
)


app = FastAPI(title="F&O Pilot Paper Engine", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://fo-pilot-risk-engine.siajha18.chatgpt.site"],
    allow_methods=["GET", "POST", "PUT"],
    allow_headers=["Content-Type"],
)

MAX_LOSS_PER_TRADE = MAX_LOSS_PER_TRADE_INR
DAILY_LOSS_LIMIT = MAX_DAILY_LOSS_INR
MIN_PROBABILITY_OF_PROFIT = REAL_MIN_POP
PAPER_MIN_PROBABILITY_OF_PROFIT = PAPER_MIN_POP
MAX_OPEN_POSITIONS = MAX_SIMULTANEOUS_STRATEGIES


automation_task = None


@app.on_event("startup")
async def startup():
    global automation_task
    try:
        initialise_database()
    except Exception:
        # Market data remains usable if persistence is temporarily unavailable.
        pass
    automation_task = asyncio.create_task(paper_automation_loop())


@app.on_event("shutdown")
async def shutdown():
    if automation_task:
        automation_task.cancel()


class Mode(str, Enum):
    PAPER = "PAPER"
    LIVE = "LIVE"


class Approval(BaseModel):
    opportunity_id: str = Field(min_length=1, max_length=100)
    estimated_probability: float = Field(ge=0, le=1)
    planned_max_loss: float = Field(gt=0)
    daily_realized_loss: float = Field(ge=0)
    open_positions: int = Field(ge=0)
    mode: Mode = Mode.PAPER


class OrderLeg(BaseModel):
    instrument_token: str = Field(pattern=r"^NSE_FO\|.+")
    quantity: int = Field(gt=0)
    transaction_type: str = Field(pattern=r"^(BUY|SELL)$")
    order_type: str = Field(default="LIMIT", pattern=r"^(LIMIT|MARKET|SL|SL-M)$")
    price: float = Field(ge=0)
    trigger_price: float = Field(default=0, ge=0)


class StrategyApproval(Approval):
    legs: list[OrderLeg] = Field(min_length=1, max_length=4)


class CompletedPaperTrade(BaseModel):
    opportunity_id: str = Field(min_length=1, max_length=100)
    strategy: str = Field(min_length=1, max_length=60)
    expiry_day: bool
    opened_at: datetime | None = None
    closed_at: datetime | None = None
    predicted_pop: float = Field(ge=0, le=1)
    planned_max_loss_inr: float = Field(gt=0, le=MAX_LOSS_PER_TRADE)
    realized_pnl_inr: float
    charges_inr: float = Field(default=0, ge=0)
    exit_reason: str = Field(min_length=1, max_length=80)
    market_features: dict = Field(default_factory=dict)


class AutomationSetting(BaseModel):
    automatic_order_placement: bool


class PaperTradingSettings(BaseModel):
    automatic_order_placement: bool
    paper_minimum_probability_of_profit: float = Field(ge=0.50, le=0.99)
    expiry_day_minimum_probability_of_profit: float = Field(ge=0.50, le=0.995)
    minimum_target_reward_risk: float = Field(ge=0.0, le=5.0)
    minimum_expected_value_inr: float = Field(ge=0.0, le=100000)
    paper_max_loss_per_trade_inr: float = Field(gt=0, le=10000)
    paper_max_daily_loss_inr: float = Field(gt=0, le=25000)
    max_new_trades_per_day: int = Field(ge=1, le=20)
    profit_target_ratio: float = Field(ge=0.10, le=1.0)
    timed_exit: str = Field(pattern=r"^(09:(1[5-9]|[2-5][0-9])|1[0-4]:[0-5][0-9]|15:([0-2][0-9]))$")


def paper_settings() -> dict:
    defaults = {
        "automatic_order_placement": True,
        "paper_minimum_probability_of_profit": PAPER_MIN_PROBABILITY_OF_PROFIT,
        "expiry_day_minimum_probability_of_profit": 0.97,
        "minimum_target_reward_risk": PAPER_MIN_TARGET_REWARD_RISK,
        "minimum_expected_value_inr": MIN_EXPECTED_VALUE,
        "paper_max_loss_per_trade_inr": PAPER_MAX_LOSS_PER_TRADE_INR,
        "paper_max_daily_loss_inr": PAPER_MAX_DAILY_LOSS_INR,
        "max_new_trades_per_day": MAX_NEW_TRADES_PER_DAY,
        "profit_target_ratio": PROFIT_TARGET_RATIO,
        "timed_exit": "15:15",
    }
    saved = get_engine_setting("paper_trading_settings", {})
    if isinstance(saved, dict):
        defaults.update({key: saved[key] for key in defaults if key in saved})
    # Compatibility with the earlier standalone automation toggle.
    defaults["automatic_order_placement"] = bool(
        get_engine_setting("automatic_order_placement", defaults["automatic_order_placement"])
    )
    return defaults


@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "fo-pilot-paper-engine",
        "mode": "PAPER_ONLY",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/v1/risk-policy")
def risk_policy():
    configured = paper_settings()
    return {
        "capital_inr": CAPITAL_INR,
        "max_loss_per_trade_inr": MAX_LOSS_PER_TRADE,
        "paper_max_loss_per_trade_inr": configured["paper_max_loss_per_trade_inr"],
        "paper_max_daily_loss_inr": configured["paper_max_daily_loss_inr"],
        "daily_loss_limit_inr": DAILY_LOSS_LIMIT,
        "minimum_probability_of_profit": MIN_PROBABILITY_OF_PROFIT,
        "paper_minimum_probability_of_profit": configured["paper_minimum_probability_of_profit"],
        "expiry_day_minimum_probability_of_profit": configured["expiry_day_minimum_probability_of_profit"],
        "max_open_positions": MAX_OPEN_POSITIONS,
        "max_new_trades_per_day": configured["max_new_trades_per_day"],
        "minimum_target_reward_risk": MIN_TARGET_REWARD_RISK,
        "paper_minimum_target_reward_risk": configured["minimum_target_reward_risk"],
        "minimum_expected_value": configured["minimum_expected_value_inr"],
        "profit_target_ratio": configured["profit_target_ratio"],
        "timed_exit": configured["timed_exit"],
        "strategy_version": STRATEGY_VERSION,
        "model_version": MODEL_VERSION,
        "score_weights": EXPERIMENTAL_SCORE_WEIGHTS,
        "live_trading_enabled": False,
        "automatic_order_placement": configured["automatic_order_placement"],
    }


@app.get("/v1/settings/automation")
def automation_setting():
    return {**paper_settings(), "mode": "PAPER_ONLY"}


@app.put("/v1/settings/automation")
def update_automation_setting(setting: AutomationSetting):
    if not set_engine_setting("automatic_order_placement", setting.automatic_order_placement):
        raise HTTPException(503, "Settings storage is unavailable")
    return {"saved": True, "automatic_order_placement": setting.automatic_order_placement, "mode": "PAPER_ONLY"}


@app.put("/v1/settings/paper")
def update_paper_settings(settings: PaperTradingSettings):
    if settings.expiry_day_minimum_probability_of_profit < settings.paper_minimum_probability_of_profit:
        raise HTTPException(422, "Expiry-day POP cannot be below the normal paper POP")
    if settings.paper_max_loss_per_trade_inr > settings.paper_max_daily_loss_inr:
        raise HTTPException(422, "Per-trade loss cannot exceed the daily loss budget")
    payload = settings.model_dump()
    if not set_engine_setting("paper_trading_settings", payload):
        raise HTTPException(503, "Settings storage is unavailable")
    set_engine_setting("automatic_order_placement", settings.automatic_order_placement)
    return {"saved": True, **payload, "mode": "PAPER_ONLY"}


@app.get("/v1/market/nifty")
async def nifty_market():
    try:
        body, status = await asyncio.gather(get_ltp(), get_market_status("NSE"))
    except UpstoxMarketDataError as exc:
        raise HTTPException(502, str(exc)) from exc
    quote = next(iter(body.get("data", {}).values()), {})
    return {
        "instrument": "NIFTY 50",
        "last_price": quote.get("last_price"),
        "previous_close": quote.get("cp"),
        "source": "UPSTOX_ANALYTICS",
        "read_only": True,
        "market_status": status.get("status", "UNKNOWN"),
        "market_is_open": status.get("status") == "NORMAL_OPEN",
        "market_status_updated_at": status.get("last_updated"),
        "as_of": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/v1/market/nifty/chart")
async def nifty_chart(
    interval: int = Query(default=5),
    days: int = Query(default=5, ge=1, le=30),
):
    if interval not in {1, 2, 5, 15, 30}:
        raise HTTPException(422, "Chart interval must be 1, 2, 5, 15 or 30 minutes")
    # EC2 runs in UTC. Use the exchange calendar date so the just-completed
    # Indian session is available immediately after midnight IST.
    today = indian_market_date()
    lookback_days = max(days + 4, int(days * 1.7) + 7)
    try:
        intraday, history, status = await asyncio.gather(
            get_intraday_candles(interval=interval),
            get_historical_candles_range(today - timedelta(days=lookback_days), today - timedelta(days=1), interval=interval),
            get_market_status("NSE"),
        )
    except UpstoxMarketDataError as exc:
        raise HTTPException(502, str(exc)) from exc
    unique = {str(row[0]): row for row in [*history, *intraday]}
    candles = sorted(unique.values(), key=lambda row: row[0])
    sessions = sorted({str(row[0])[:10] for row in candles})
    selected_sessions = sessions[-days:]
    candles = [row for row in candles if str(row[0])[:10] in selected_sessions]
    points = [
        {"time": row[0], "open": row[1], "high": row[2], "low": row[3], "close": row[4]}
        for row in sorted(candles, key=lambda value: value[0])
    ]
    return {
        "instrument": "NIFTY 50", "interval": f"{interval} minute", "sessions": selected_sessions,
        "requested_days": days, "points": points,
        "market_status": status.get("status", "UNKNOWN"),
        "market_is_open": status.get("status") == "NORMAL_OPEN",
        "as_of": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/v1/opportunities")
async def opportunities():
    configured = paper_settings()
    expiries = ("current_week", "next_week")
    try:
        results = await asyncio.gather(
            *(get_option_chain(expiry) for expiry in expiries),
            get_intraday_candles(),
            get_ltp(),
        )
        chains, intraday_candles, quote_body = results[:-2], results[-2], results[-1]
    except UpstoxMarketDataError as exc:
        raise HTTPException(502, str(exc)) from exc

    scanned = sum(len(chain) for chain in chains)
    profiles = load_learning_profiles()
    research_candidates = []
    for chain in chains:
        research_candidates.extend(
            apply_learning(item, profiles)
            for item in scan_vertical_spreads(
                chain, minimum_pop=configured["paper_minimum_probability_of_profit"],
                include_rejected=True,
                minimum_target_reward_risk=configured["minimum_target_reward_risk"],
                minimum_expected_value=configured["minimum_expected_value_inr"],
                expiry_day_minimum_pop=configured["expiry_day_minimum_probability_of_profit"],
            )
        )
    research_candidates.sort(
        key=lambda item: (
            item["probability_of_profit"], item["score"], item["max_profit_inr"]
        ),
        reverse=True,
    )
    training_report = latest_training_run()
    current_days = candles_to_daily(intraday_candles)
    if current_days and intraday_candles:
        quote = next(iter(quote_body.get("data", {}).values()), {})
        previous_close = float(quote.get("cp") or 0)
        opening = float(sorted(intraday_candles, key=lambda candle: candle[0])[0][1])
        current = current_days[-1]
        current_days[-1] = DailyRegime(
            current.day,
            round((opening / previous_close - 1) * 100, 5) if previous_close else 0.0,
            current.range_pct,
            current.return_pct,
            current.realized_vol_pct,
        )
    regime_safe, regime_reasons = regime_is_safe(current_days[-1], training_report) if current_days else (False, ["Current regime data is unavailable"])
    regime_pass = not training_report or not training_report.get("activated") or regime_safe
    for candidate in research_candidates:
        candidate["qualification_checks"]["REGIME"] = regime_pass
        if not regime_pass and "REGIME_FILTER_BLOCKED" not in candidate["rejection_reasons"]:
            candidate["rejection_reasons"].append("REGIME_FILTER_BLOCKED")
        candidate["qualified_for_paper_entry"] = not candidate["rejection_reasons"]
        # Explicit paper orders may override analytical opinions (POP, EV,
        # reward/risk and regime). Mechanical validity is never overridden.
        hard_manual_blocks = {"INSUFFICIENT_LIQUIDITY", "DATA_QUALITY_FAILED"}
        candidate["manual_entry_eligible"] = (
            candidate["max_profit_inr"] > 0
            and not hard_manual_blocks.intersection(candidate["rejection_reasons"])
        )
        candidate["final_classification"] = (
            "PAPER_SELECTED_ELIGIBLE" if candidate["qualified_for_paper_entry"]
            else "MANUAL_POP_REVIEW" if candidate["manual_entry_eligible"]
            else "PAPER_RESEARCH_ONLY"
        )
    qualified = [item for item in research_candidates if item["qualified_for_paper_entry"]]
    # The dashboard receives the complete ranked research universe. Automatic
    # execution still consumes only qualified candidates below.
    items = research_candidates
    for rank, item in enumerate(items, start=1):
        item["rank"] = rank
    payload = {
        "items": items,
        "decision": "TRADE_CANDIDATES" if qualified else "NO_TRADE",
        "reason": (
            "Qualified candidates are ready for one-tap paper approval."
            if qualified
            else f"Historical loss-avoidance filter blocked trading: {', '.join(regime_reasons)}."
            if training_report and training_report.get("activated") and not regime_safe
            else "No spread passed POP, ₹350 loss, reward/risk, liquidity and regime checks."
        ),
        "contracts_scanned": scanned,
        "expiries_scanned": list(expiries),
        "risk_policy": {
            "paper_minimum_probability_of_profit": configured["paper_minimum_probability_of_profit"],
            "real_minimum_probability_of_profit": MIN_PROBABILITY_OF_PROFIT,
            "max_loss_per_trade_inr": MAX_LOSS_PER_TRADE,
            "paper_max_loss_per_trade_inr": configured["paper_max_loss_per_trade_inr"],
            "paper_max_daily_loss_inr": configured["paper_max_daily_loss_inr"],
            "minimum_target_reward_risk": MIN_TARGET_REWARD_RISK,
            "paper_minimum_target_reward_risk": configured["minimum_target_reward_risk"],
            "expected_value_status": "POSITIVE_PROXY_REQUIRED",
            "live_trading_enabled": False,
        },
        "research": {
            "generated_candidates": len(research_candidates),
            "qualified_candidates": len(qualified),
            "research_only_candidates": len(research_candidates) - len(qualified),
            "rejection_reason_counts": {
                reason: sum(reason in item["rejection_reasons"] for item in research_candidates)
                for reason in sorted({reason for item in research_candidates for reason in item["rejection_reasons"]})
            },
            "ev_status": "EV_UNCALIBRATED",
            "strategy_version": STRATEGY_VERSION,
            "model_version": MODEL_VERSION,
        },
        "learning": learning_summary(),
        "historical_training": training_report,
        "current_regime": {"safe": regime_safe, "reasons": regime_reasons},
        "as_of": datetime.now(timezone.utc).isoformat(),
    }
    try:
        payload["persisted"] = save_scan({**payload, "research_candidates": research_candidates})
    except Exception:
        payload["persisted"] = False
    return payload


@app.get("/v1/paper/portfolio")
async def paper_portfolio():
    summary = paper_trading_summary()
    position = current_paper_position()
    if position:
        try:
            chain = await get_option_chain(position["expiry"])
            unrealized = paper_pnl(position, chain)
        except UpstoxMarketDataError:
            unrealized = None
        position = {**position, "unrealized_pnl_inr": unrealized}
    return {
        **summary, "open_position": position,
        "capital_inr": CAPITAL_INR, "mode": "PAPER_AUTOMATIC",
        "real_trading_enabled": False,
    }


async def paper_automation_cycle():
    status = await get_market_status("NSE")
    market_open = status.get("status") == "NORMAL_OPEN"
    if not market_open:
        return

    # Persist a fresh view of the complete research universe every market-minute,
    # including while an existing paper position is being managed.
    scan = await opportunities()
    position = current_paper_position()
    if position:
        chain = await get_option_chain(position["expiry"])
        pnl = paper_pnl(position, chain)
        if pnl is not None:
            maybe_exit(position, pnl)
        return
    if paper_settings()["automatic_order_placement"]:
        maybe_enter(
            [item for item in scan["items"] if item.get("qualified_for_paper_entry")],
            market_open=True,
        )


@app.post("/v1/paper/orders/{opportunity_id}")
async def place_paper_order(opportunity_id: str):
    status = await get_market_status("NSE")
    if status.get("status") != "NORMAL_OPEN":
        raise HTTPException(409, "Paper orders can only be placed while the market is open")
    if current_paper_position():
        raise HTTPException(409, "A paper position is already open")
    scan = await opportunities()
    candidate = next((item for item in scan["items"] if item["id"] == opportunity_id), None)
    if not candidate:
        raise HTTPException(404, "This opportunity is no longer available")
    if not candidate.get("manual_entry_eligible", False):
        raise HTTPException(409, "This opportunity has invalid live prices or insufficient liquidity")
    opened = maybe_enter([candidate], market_open=True, manual=True)
    if not opened:
        raise HTTPException(409, "Risk limits prevented this paper order")
    return {"accepted": True, "mode": "PAPER", "position": opened}


async def paper_automation_loop():
    while True:
        try:
            await paper_automation_cycle()
        except Exception:
            pass
        # Revalue open positions and evaluate entries frequently during market hours.
        await asyncio.sleep(5 if current_paper_position() else 15)


@app.get("/v1/learning/summary")
def get_learning_summary():
    return {**learning_summary(), "historical_training": latest_training_run()}


@app.get("/v1/ai/status")
def get_ai_status():
    return ai_status()


@app.post("/v1/ai/analysis")
async def get_ai_analysis(force: bool = Query(default=False)):
    # The model receives the same bounded, ranked research snapshot shown on the
    # dashboard. It is advisory and has no access to broker/order functions.
    return await ai_analyse(await opportunities(), force=force)


@app.post("/v1/learning/completed-paper-trade")
def record_completed_paper_trade(trade: CompletedPaperTrade):
    if not save_completed_trade(trade.model_dump(mode="json")):
        raise HTTPException(503, "Trade learning database is unavailable")
    return {"recorded": True, "learning": learning_summary()}


@app.post("/v1/instruments/nifty/refresh")
def refresh_instruments():
    try:
        size = refresh_nse_instruments()
    except Exception as exc:
        raise HTTPException(502, "Unable to refresh Upstox instruments") from exc
    return {"refreshed": True, "compressed_bytes": size}


@app.get("/v1/instruments/nifty")
def nifty_instruments(limit: int = 500):
    rows = load_nifty_derivatives()
    return {"count": len(rows), "items": rows[: min(max(limit, 1), 2000)]}


@app.post("/v1/orders/approve")
def approve_order(order: Approval):
    if order.mode != Mode.PAPER:
        raise HTTPException(403, "Live trading is disabled")
    if order.estimated_probability < PAPER_MIN_PROBABILITY_OF_PROFIT:
        raise HTTPException(422, "Probability threshold not met")
    if order.planned_max_loss > MAX_LOSS_PER_TRADE:
        raise HTTPException(422, "Per-trade loss limit exceeded")
    if order.daily_realized_loss >= DAILY_LOSS_LIMIT:
        raise HTTPException(422, "Daily loss limit reached")
    if order.open_positions >= MAX_OPEN_POSITIONS:
        raise HTTPException(422, "Only one simultaneous position is allowed")
    return {
        "accepted": True,
        "mode": "PAPER",
        "opportunity_id": order.opportunity_id,
        "state": "QUEUED_FOR_PAPER_EXECUTION",
    }


@app.post("/v1/orders/approve-and-place")
def approve_and_place(order: StrategyApproval):
    approve_order(order)
    tag = f"fo-pilot-{order.opportunity_id}"[:40]
    legs = []
    for index, leg in enumerate(order.legs, start=1):
        legs.append(
            {
                "correlation_id": f"leg-{index}",
                "quantity": leg.quantity,
                "product": "D",
                "validity": "DAY",
                "price": leg.price,
                "tag": tag,
                "instrument_token": leg.instrument_token,
                "order_type": leg.order_type,
                "transaction_type": leg.transaction_type,
                "disclosed_quantity": 0,
                "trigger_price": leg.trigger_price,
                "is_amo": False,
                "slice": False,
                "market_protection": -1,
            }
        )
    try:
        result = place_multi_order(legs)
    except UpstoxSandboxError as exc:
        raise HTTPException(502, str(exc)) from exc
    return {
        "accepted": True,
        "mode": "UPSTOX_SANDBOX",
        "opportunity_id": order.opportunity_id,
        "broker_response": result,
    }


@app.post("/v1/positions/{position_id}/exit")
async def manual_exit(position_id: int):
    position = current_paper_position()
    if not position or position["id"] != position_id:
        raise HTTPException(404, "Open paper position not found")
    try:
        chain = await get_option_chain(position["expiry"])
    except UpstoxMarketDataError as exc:
        raise HTTPException(502, str(exc)) from exc
    pnl = paper_pnl(position, chain)
    if pnl is None:
        raise HTTPException(502, "Unable to value the paper position")
    closed = maybe_exit(position, pnl, manual=True)
    return {"accepted": bool(closed), "position": closed, "mode": "PAPER"}
