import asyncio
from datetime import datetime, timezone
from enum import Enum

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from instruments import load_nifty_derivatives, refresh_nse_instruments
from database import initialise_database, save_scan
from scanner import scan_vertical_spreads
from upstox import (
    UpstoxMarketDataError,
    UpstoxSandboxError,
    get_ltp,
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
MAX_OPEN_POSITIONS = 1


@app.on_event("startup")
def startup():
    try:
        initialise_database()
    except Exception:
        # Market data remains usable if persistence is temporarily unavailable.
        pass


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
        "max_open_positions": MAX_OPEN_POSITIONS,
        "live_trading_enabled": False,
    }


@app.get("/v1/market/nifty")
async def nifty_market():
    try:
        body = await get_ltp()
    except UpstoxMarketDataError as exc:
        raise HTTPException(502, str(exc)) from exc
    quote = next(iter(body.get("data", {}).values()), {})
    return {
        "instrument": "NIFTY 50",
        "last_price": quote.get("last_price"),
        "previous_close": quote.get("cp"),
        "source": "UPSTOX_ANALYTICS",
        "read_only": True,
        "as_of": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/v1/opportunities")
async def opportunities():
    expiries = ("current_week", "next_week")
    try:
        chains = await asyncio.gather(*(get_option_chain(expiry) for expiry in expiries))
    except UpstoxMarketDataError as exc:
        raise HTTPException(502, str(exc)) from exc

    scanned = sum(len(chain) for chain in chains)
    items = []
    for chain in chains:
        items.extend(scan_vertical_spreads(chain))
    items.sort(
        key=lambda item: (
            item["probability_of_profit"], item["score"], item["max_profit_inr"]
        ),
        reverse=True,
    )
    items = items[:5]
    for rank, item in enumerate(items, start=1):
        item["rank"] = rank
    payload = {
        "items": items,
        "decision": "TRADE_CANDIDATES" if items else "NO_TRADE",
        "reason": (
            "Qualified candidates are ready for one-tap paper approval."
            if items
            else "No spread passed the 95% POP and ₹350 all-in loss limits."
        ),
        "contracts_scanned": scanned,
        "expiries_scanned": list(expiries),
        "risk_policy": {
            "minimum_probability_of_profit": MIN_PROBABILITY_OF_PROFIT,
            "max_loss_per_trade_inr": MAX_LOSS_PER_TRADE,
            "live_trading_enabled": False,
        },
        "as_of": datetime.now(timezone.utc).isoformat(),
    }
    try:
        payload["persisted"] = save_scan(payload)
    except Exception:
        payload["persisted"] = False
    return payload


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
def manual_exit(position_id: str):
    return {
        "accepted": True,
        "position_id": position_id,
        "state": "EXIT_REQUESTED",
        "mode": "PAPER",
    }
