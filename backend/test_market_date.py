from datetime import datetime, timezone

from market_clock import indian_market_date


def test_indian_market_date_advances_before_utc_midnight():
    utc_time = datetime(2026, 9, 9, 19, 0, tzinfo=timezone.utc)

    assert indian_market_date(utc_time).isoformat() == "2026-09-10"
