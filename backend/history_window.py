from datetime import date, timedelta


def historical_date_chunks(start: date, end: date) -> list[tuple[date, date]]:
    """Split minute history into ranges safely below Upstox's one-month cap."""
    chunks = []
    cursor = start
    while cursor <= end:
        chunk_end = min(cursor + timedelta(days=27), end)
        chunks.append((cursor, chunk_end))
        cursor = chunk_end + timedelta(days=1)
    return chunks
