import os

import httpx


SANDBOX_MULTI_ORDER_URL = "https://sandbox.upstox.com/v2/order/multi/place"
MARKET_API_BASE_URL = "https://api.upstox.com"


class UpstoxSandboxError(RuntimeError):
    pass


class UpstoxMarketDataError(RuntimeError):
    pass


def _analytics_headers() -> dict[str, str]:
    token = os.getenv("UPSTOX_ANALYTICS_TOKEN")
    if not token:
        raise UpstoxMarketDataError("Upstox analytics token is not configured")
    return {
        "Accept": "application/json",
        "Authorization": f"Bearer {token}",
    }


async def get_ltp(instrument_key: str = "NSE_INDEX|Nifty 50") -> dict:
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(
                f"{MARKET_API_BASE_URL}/v3/market-quote/ltp",
                headers=_analytics_headers(),
                params={"instrument_key": instrument_key},
            )
            response.raise_for_status()
    except httpx.HTTPError as exc:
        raise UpstoxMarketDataError("Unable to fetch the latest Upstox quote") from exc
    return response.json()


async def get_option_chain(
    expiry: str, instrument_key: str = "NSE_INDEX|Nifty 50"
) -> list[dict]:
    try:
        async with httpx.AsyncClient(timeout=25.0) as client:
            response = await client.get(
                f"{MARKET_API_BASE_URL}/v2/option/chain",
                headers=_analytics_headers(),
                params={"instrument_key": instrument_key, "expiry_date": expiry},
            )
            response.raise_for_status()
    except httpx.HTTPError as exc:
        raise UpstoxMarketDataError(
            f"Unable to fetch the Upstox option chain for {expiry}"
        ) from exc
    body = response.json()
    if body.get("status") != "success" or not isinstance(body.get("data"), list):
        raise UpstoxMarketDataError("Upstox returned an invalid option-chain response")
    return body["data"]


async def get_intraday_candles(
    instrument_key: str = "NSE_INDEX|Nifty 50", interval: int = 30
) -> list[list]:
    encoded_key = httpx.URL("https://x/" + instrument_key).raw_path.decode().split("/", 1)[1]
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.get(
                f"{MARKET_API_BASE_URL}/v3/historical-candle/intraday/{encoded_key}/minutes/{interval}",
                headers=_analytics_headers(),
            )
            response.raise_for_status()
    except httpx.HTTPError as exc:
        raise UpstoxMarketDataError("Unable to fetch current intraday candles") from exc
    return response.json().get("data", {}).get("candles", [])


def place_multi_order(legs: list[dict]) -> dict:
    token = os.getenv("UPSTOX_SANDBOX_TOKEN")
    if not token:
        raise UpstoxSandboxError("Upstox sandbox token is not configured")

    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}",
    }
    try:
        response = httpx.post(
            SANDBOX_MULTI_ORDER_URL,
            headers=headers,
            json=legs,
            timeout=15.0,
        )
    except httpx.HTTPError as exc:
        raise UpstoxSandboxError("Upstox sandbox is unavailable") from exc

    if response.status_code not in (200, 207):
        message = "Upstox sandbox rejected the order"
        try:
            body = response.json()
            message = body.get("message") or message
        except ValueError:
            pass
        raise UpstoxSandboxError(message)
    return response.json()
