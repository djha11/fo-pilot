from scanner import scan_vertical_spreads
from learning import apply_learning, build_profile


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


def test_paper_threshold_accepts_candidate_above_75_percent():
    lower = _row(23549, put_pop=0.80)
    upper = _row(23550, put_pop=0.80)
    lower["put_options"]["market_data"]["ask_price"] = 9
    upper["put_options"]["market_data"]["bid_price"] = 9.5
    result = scan_vertical_spreads([lower, upper], lot_size=75, minimum_pop=0.75)
    assert len(result) == 1
    assert result[0]["legs"][0]["entry_price"] == 9.5
    assert result[0]["expected_value_status"] == "EV_UNCALIBRATED"
    assert "target_reward_risk" in result[0]


def test_research_mode_retains_but_classifies_below_pop_candidate():
    lower = _row(23549, put_pop=0.70)
    upper = _row(23550, put_pop=0.70)
    lower["put_options"]["market_data"]["ask_price"] = 9
    upper["put_options"]["market_data"]["bid_price"] = 9.5

    result = scan_vertical_spreads(
        [lower, upper], lot_size=75, minimum_pop=0.75, include_rejected=True
    )

    assert len(result) == 1
    assert result[0]["qualified_for_paper_entry"] is False
    assert "POP_BELOW_MINIMUM" in result[0]["rejection_reasons"]


def test_research_mode_is_not_truncated_to_five_candidates():
    rows = [_row(23540 + strike, put_pop=0.80) for strike in range(8)]
    for row in rows:
        row["put_options"]["market_data"]["ask_price"] = 9
        row["put_options"]["market_data"]["bid_price"] = 9.5

    result = scan_vertical_spreads(
        rows, lot_size=1, minimum_pop=0.75, include_rejected=True
    )

    assert len(result) > 5
    assert [item["rank"] for item in result] == list(range(1, len(result) + 1))


def test_accepts_only_when_both_limits_pass():
    lower = _row(23549)
    upper = _row(23550)
    lower["put_options"]["market_data"]["ask_price"] = 9
    upper["put_options"]["market_data"]["bid_price"] = 9.5
    result = scan_vertical_spreads([lower, upper], lot_size=75)
    assert len(result) == 1
    assert result[0]["probability_of_profit"] >= 0.95
    assert result[0]["max_loss_inr"] <= 350


def test_learning_waits_for_enough_evidence():
    profile = build_profile("Bull Put Spread", False, wins=4, total=5)
    assert profile.active is False
    assert profile.score_adjustment == 0


def test_bad_history_lowers_rank_score_but_not_risk_fields():
    profile = build_profile("Bull Put Spread", False, wins=20, total=30)
    candidate = {
        "strategy": "Bull Put Spread", "expiry_day": False, "score": 90.0,
        "probability_of_profit": 0.96, "max_loss_inr": 300, "rationale": [],
    }
    learned = apply_learning(candidate, {("Bull Put Spread", False): profile})
    assert learned["score"] < 90
    assert learned["probability_of_profit"] == 0.96
    assert learned["max_loss_inr"] == 300


def test_good_history_can_only_adjust_score_within_cap():
    profile = build_profile("Bear Call Spread", True, wins=100, total=100)
    candidate = {"strategy": "Bear Call Spread", "expiry_day": True, "score": 98, "rationale": []}
    learned = apply_learning(candidate, {("Bear Call Spread", True): profile})
    assert learned["score"] <= 100
    assert profile.score_adjustment <= 5
