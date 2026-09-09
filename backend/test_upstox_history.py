from datetime import date

from history_window import historical_date_chunks


def test_history_ranges_stay_below_upstox_month_limit():
    chunks = historical_date_chunks(date(2026, 7, 1), date(2026, 9, 9))

    assert chunks[0] == (date(2026, 7, 1), date(2026, 7, 28))
    assert chunks[-1][1] == date(2026, 9, 9)
    assert all((end - start).days <= 27 for start, end in chunks)
    assert all(chunks[index][1].toordinal() + 1 == chunks[index + 1][0].toordinal() for index in range(len(chunks) - 1))
