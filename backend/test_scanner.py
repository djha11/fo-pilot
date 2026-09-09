from scanner import scan_vertical_spreads


def _row(strike, spot=23600, put_pop=0.96, call_pop=0.96):
    def option(kind, pop):
        return {
            "instrument_key": f"NSE_FO|{kind}{strike}",
            "market_data": {
                "bid_price": 10 if strike == 23550 else 12,
                "ask_price": 10.5 if strike == 23550 else 12.5,
                "bid_qty": 75,
                "ask_qty": 75,
                "oi": 750,
            },
            "option_greeks": {"pop": pop},
        }

    return {
        "expiry": "2030-09-12",
        "strike_price": strike,
        "underlying_spot_price": spot,
        "put_options": option("PE", put_pop),
        "call_options": option("CE", call_pop),
    }


def test_rejects_spread_over_loss_cap():
    assert scan_vertical_spreads([_row(23500), _row(23550)]) == []


def test_rejects_probability_below_threshold():
    rows = [_row(23549, put_pop=0.94), _row(23550, put_pop=0.94)]
    assert scan_vertical_spreads(rows) == []


def test_accepts_only_when_both_limits_pass():
    lower = _row(23549)
    upper = _row(23550)
    lower["put_options"]["market_data"]["ask_price"] = 9
    upper["put_options"]["market_data"]["bid_price"] = 9.5
    result = scan_vertical_spreads([lower, upper], lot_size=75)
    assert len(result) == 1
    assert result[0]["probability_of_profit"] >= 0.95
    assert result[0]["max_loss_inr"] <= 350
