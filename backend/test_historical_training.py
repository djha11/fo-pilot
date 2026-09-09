from historical_training import DailyRegime, candles_to_daily, regime_is_safe, train_loss_avoidance_filter


def test_candles_aggregate_without_future_information():
    candles = [
        ["2025-01-01T09:15:00+05:30", 100, 102, 99, 101, 1, 0],
        ["2025-01-01T09:45:00+05:30", 101, 103, 100, 102, 1, 0],
        ["2025-01-02T09:15:00+05:30", 101, 102, 98, 99, 1, 0],
    ]
    result = candles_to_daily(candles)
    assert len(result) == 2
    assert result[1].gap_pct < 0


def test_training_refuses_small_history():
    days = [DailyRegime(str(i), 0.1, 0.5, 0.1, 0.2) for i in range(100)]
    assert train_loss_avoidance_filter(days)["activated"] is False


def test_walk_forward_filter_uses_untouched_tail():
    days = []
    for index in range(700):
        stressed = index % 10 == 0
        days.append(DailyRegime(str(index), 1.5 if stressed else 0.1, 2.0 if stressed else 0.5, 1.2 if stressed else 0.1, 1.5 if stressed else 0.2))
    report = train_loss_avoidance_filter(days)
    assert report["training_days"] == 560
    assert report["validation_days"] == 140
    assert report["guardrails_locked"] is True


def test_active_filter_blocks_unstable_current_regime():
    report = {"activated": True, "thresholds": {"max_abs_gap_pct": 0.5, "max_range_pct": 1.0, "max_realized_vol_pct": 0.8}}
    safe, reasons = regime_is_safe(DailyRegime("today", 1.2, 2.0, 0.0, 1.1), report)
    assert safe is False
    assert "opening gap" in reasons
