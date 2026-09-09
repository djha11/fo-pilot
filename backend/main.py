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
)
from learning import apply_learning
from historical_training import DailyRegime, candles_to_daily, regime_is_safe
from scanner import scan_vertical_spreads
from paper_engine import maybe_enter, maybe_exit, paper_pnl
from market_clock import indian_market_date
from upstox import (
    UpstoxMarketDataError,
    UpstoxSandboxError,
    get_ltp,
    get_intraday_candles,
    get_historical_candles,
    get_market_status,
    get_option_chain,
    place_multi_order,
)


app = FastAPI(title="F&O Pilot Paper Engine", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://fo-pilot-risk-engine.siajha18.chatgpt.site"],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

MAX_LOSS_PER_TRADE = 350.0
DAILY_LOSS_LIMIT = 600.0
MIN_PROBABILITY_OF_PROFIT = 0.95
PAPER_MIN_PROBABILITY_OF_PROFIT = 0.75
MAX_OPEN_POSITIONS = 1


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
    return {
        "capital_inr": 50000,
        "max_loss_per_trade_inr": MAX_LOSS_PER_TRADE,
        "daily_loss_limit_inr": DAILY_LOSS_LIMIT,
        "minimum_probability_of_profit": MIN_PROBABILITY_OF_PROFIT,
        "paper_minimum_probability_of_profit": PAPER_MIN_PROBABILITY_OF_PROFIT,
        "max_open_positions": MAX_OPEN_POSITIONS,
        "live_trading_enabled": False,
    }


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
    try:
        intraday, history, status = await asyncio.gather(
            get_intraday_candles(interval=interval),
            get_historical_candles(today - timedelta(days=days + 4), today - timedelta(days=1), interval=interval),
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
    items = []
    for chain in chains:
            items.extend(apply_learning(item, profiles) for item in scan_vertical_spreads(chain, minimum_pop=PAPER_MIN_PROBABILITY_OF_PROFIT))
    items.sort(
        key=lambda item: (
            item["probability_of_profit"], item["score"], item["max_profit_inr"]
        ),
        reverse=True,
    )
    items = items[:5]
    for rank, item in enumerate(items, start=1):
        item["rank"] = rank
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
    if training_report and training_report.get("activated") and not regime_safe:
        items = []
    payload = {
        "items": items,
        "decision": "TRADE_CANDIDATES" if items else "NO_TRADE",
        "reason": (
            "Qualified candidates are ready for one-tap paper approval."
            if items
            else f"Historical loss-avoidance filter blocked trading: {', '.join(regime_reasons)}."
            if training_report and training_report.get("activated") and not regime_safe
            else "No spread passed the 75% paper POP and ₹350 all-in loss limits."
        ),
        "contracts_scanned": scanned,
        "expiries_scanned": list(expiries),
        "risk_policy": {
            "paper_minimum_probability_of_profit": PAPER_MIN_PROBABILITY_OF_PROFIT,
            "real_minimum_probability_of_profit": MIN_PROBABILITY_OF_PROFIT,
            "max_loss_per_trade_inr": MAX_LOSS_PER_TRADE,
            "live_trading_enabled": False,
        },
        "learning": learning_summary(),
        "historical_training": training_report,
        "current_regime": {"safe": regime_safe, "reasons": regime_reasons},
        "as_of": datetime.now(timezone.utc).isoformat(),
    }
    try:
        payload["persisted"] = save_scan(payload)
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
        "capital_inr": 50000, "mode": "PAPER_AUTOMATIC",
        "real_trading_enabled": False,
    }


async def paper_automation_cycle():
    status = await get_market_status("NSE")
    market_open = status.get("status") == "NORMAL_OPEN"
    position = current_paper_position()
    if position:
        chain = await get_option_chain(position["expiry"])
        pnl = paper_pnl(position, chain)
        if pnl is not None:
            maybe_exit(position, pnl)
        return
    if not market_open:
        return
    scan = await opportunities()
    maybe_enter(scan["items"], market_open=True)


async def paper_automation_loop():
    while True:
        try:
            await paper_automation_cycle()
        except Exception:
            pass
        await asyncio.sleep(60)


@app.get("/v1/learning/summary")
def get_learning_summary():
    return {**learning_summary(), "historical_training": latest_training_run()}


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
    if order.estimated_probability < MIN_PROBABILITY_OF_PROFIT:
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
