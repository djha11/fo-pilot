from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import date
from math import isfinite


MIN_POP = 0.95
EXPIRY_DAY_MIN_POP = 0.97
MAX_LOSS = 350.0
ESTIMATED_CHARGES = 40.0


@dataclass
class Opportunity:
    id: str
    rank: int
    strategy: str
    expiry: str
    expiry_day: bool
    probability_of_profit: float
    max_profit_inr: float
    max_loss_inr: float
    score: float
    underlying_spot: float
    legs: list[dict]
    rationale: list[str]


def _number(value, default=0.0) -> float:
    try:
        result = float(value)
        return result if isfinite(result) else default
    except (TypeError, ValueError):
        return default


def _normalise_pop(value) -> float:
    pop = _number(value)
    if pop > 1:
        pop /= 100
    return min(max(pop, 0.0), 1.0)


def _option(row: dict, side: str) -> dict:
    value = row.get(f"{side}_options")
    return value if isinstance(value, dict) else {}


def _market(option: dict) -> dict:
    value = option.get("market_data")
    return value if isinstance(value, dict) else {}


def _greeks(option: dict) -> dict:
    value = option.get("option_greeks")
    return value if isinstance(value, dict) else {}


def _is_liquid(option: dict) -> bool:
    market = _market(option)
    return (
        _number(market.get("bid_price")) > 0
        and _number(market.get("ask_price")) > 0
        and _number(market.get("bid_qty")) > 0
        and _number(market.get("ask_qty")) > 0
        and _number(market.get("oi")) > 0
    )


def _expiry_day(expiry: str) -> bool:
    try:
        return date.fromisoformat(expiry) == date.today()
    except ValueError:
        return False


def scan_vertical_spreads(
    chain: list[dict], lot_size: int = 75, minimum_pop: float = MIN_POP
) -> list[dict]:
    if not chain:
        return []
    rows = sorted(chain, key=lambda row: _number(row.get("strike_price")))
    spot = _number(rows[0].get("underlying_spot_price"))
    expiry = str(rows[0].get("expiry") or "")
    is_expiry_day = _expiry_day(expiry)
    min_pop = max(minimum_pop, EXPIRY_DAY_MIN_POP if is_expiry_day else minimum_pop)
    candidates: list[Opportunity] = []

    for index in range(len(rows) - 1):
        lower, upper = rows[index], rows[index + 1]
        lower_strike = _number(lower.get("strike_price"))
        upper_strike = _number(upper.get("strike_price"))
        width = upper_strike - lower_strike
        if width <= 0:
            continue

        # Bull put credit spread: sell higher-strike put, buy lower-strike put.
        short_put, long_put = _option(upper, "put"), _option(lower, "put")
        if upper_strike < spot and _is_liquid(short_put) and _is_liquid(long_put):
            short_market, long_market = _market(short_put), _market(long_put)
            credit = _number(short_market.get("bid_price")) - _number(
                long_market.get("ask_price")
            )
            pop = _normalise_pop(_greeks(short_put).get("pop"))
            max_profit = max(credit * lot_size - ESTIMATED_CHARGES, 0)
            max_loss = max((width - credit) * lot_size + ESTIMATED_CHARGES, 0)
            if credit > 0 and pop >= min_pop and max_loss <= MAX_LOSS:
                candidates.append(
                    _build(
                        "Bull Put Spread", expiry, is_expiry_day, pop, max_profit,
                        max_loss, spot, short_put, long_put, upper_strike,
                        lower_strike, "SELL", "BUY", lot_size,
                    )
                )

        # Bear call credit spread: sell lower-strike call, buy higher-strike call.
        short_call, long_call = _option(lower, "call"), _option(upper, "call")
        if lower_strike > spot and _is_liquid(short_call) and _is_liquid(long_call):
            short_market, long_market = _market(short_call), _market(long_call)
            credit = _number(short_market.get("bid_price")) - _number(
                long_market.get("ask_price")
            )
            pop = _normalise_pop(_greeks(short_call).get("pop"))
            max_profit = max(credit * lot_size - ESTIMATED_CHARGES, 0)
            max_loss = max((width - credit) * lot_size + ESTIMATED_CHARGES, 0)
            if credit > 0 and pop >= min_pop and max_loss <= MAX_LOSS:
                candidates.append(
                    _build(
                        "Bear Call Spread", expiry, is_expiry_day, pop, max_profit,
                        max_loss, spot, short_call, long_call, lower_strike,
                        upper_strike, "SELL", "BUY", lot_size,
                    )
                )

    candidates.sort(
        key=lambda item: (item.probability_of_profit, item.score, item.max_profit_inr),
        reverse=True,
    )
    for rank, item in enumerate(candidates[:5], start=1):
        item.rank = rank
    return [asdict(item) for item in candidates[:5]]


def _build(
    strategy: str,
    expiry: str,
    expiry_day: bool,
    pop: float,
    max_profit: float,
    max_loss: float,
    spot: float,
    short_option: dict,
    long_option: dict,
    short_strike: float,
    long_strike: float,
    short_action: str,
    long_action: str,
    lot_size: int,
) -> Opportunity:
    reward_risk = max_profit / max(max_loss, 1)
    score = min(100.0, pop * 80 + min(reward_risk, 1) * 20)
    option_type = "PE" if "Put" in strategy else "CE"
    opportunity_id = (
        f"nifty-{expiry}-{strategy.lower().replace(' ', '-')}-"
        f"{int(short_strike)}-{int(long_strike)}"
    )
    return Opportunity(
        id=opportunity_id,
        rank=0,
        strategy=strategy,
        expiry=expiry,
        expiry_day=expiry_day,
        probability_of_profit=round(pop, 4),
        max_profit_inr=round(max_profit, 2),
        max_loss_inr=round(max_loss, 2),
        score=round(score, 1),
        underlying_spot=round(spot, 2),
        legs=[
            {
                "instrument_token": short_option.get("instrument_key"),
                "transaction_type": short_action,
                "quantity": lot_size,
                "strike": short_strike,
                "option_type": option_type,
                "entry_price": round(_number(_market(short_option).get("bid_price")), 2),
            },
            {
                "instrument_token": long_option.get("instrument_key"),
                "transaction_type": long_action,
                "quantity": lot_size,
                "strike": long_strike,
                "option_type": option_type,
                "entry_price": round(_number(_market(long_option).get("ask_price")), 2),
            },
        ],
        rationale=[
            f"Upstox option-chain POP is {pop:.1%}",
            f"Worst-case loss including estimated charges is ₹{max_loss:.0f}",
            "Both legs have bid, ask, quantity and open interest",
        ],
    )
