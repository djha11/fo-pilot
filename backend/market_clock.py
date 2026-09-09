from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo


IST = ZoneInfo("Asia/Kolkata")


def indian_market_date(now: datetime | None = None) -> date:
    """Return the NSE calendar date independently of the server timezone."""
    return (now or datetime.now(timezone.utc)).astimezone(IST).date()
