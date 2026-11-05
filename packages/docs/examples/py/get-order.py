# Read an order, and print the link to pay it (payment_link) when it awaits payment.
# Needs FORTRIP_TOKEN, a Fortrip access token (see device-login), and httpx.
import json
import os

import httpx

token = os.environ["FORTRIP_TOKEN"]

response = httpx.get(
    "https://api.fortrip.ai/v1/orders/ord_Wr4tY7uI0oPa3SdF6gHj",
    headers={"Authorization": f"Bearer {token}"},
)
order = response.json()
if response.is_error:
    raise SystemExit(json.dumps(order, indent=2))
print(order["payment"]["url"])
