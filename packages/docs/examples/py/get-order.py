# Read an order, and print the link to pay it (payment_link) when it awaits payment.
# Needs FORTRIP_TOKEN, a Fortrip access token (see Sign in above), and httpx.
import os

import httpx

token = os.environ["FORTRIP_TOKEN"]

response = httpx.get(
    "https://api.fortrip.ai/v1/orders/ord_Wr4tY7uI0oPa3SdF6gHj",
    headers={"Authorization": f"Bearer {token}"},
    timeout=60,
)
if response.is_error:
    raise SystemExit(f"HTTP {response.status_code}: {response.text}")
order = response.json()
link = (order.get("payment") or {}).get("url")
if not link:
    raise SystemExit("The order has no payment link: it is not awaiting payment, or read it again.")
print(link)
