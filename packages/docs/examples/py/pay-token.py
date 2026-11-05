# Pay an order with a Link token.
# Needs FORTRIP_TOKEN, a Fortrip access token (see Sign in above), and httpx.
import json
import os

import httpx

token = os.environ["FORTRIP_TOKEN"]

body = {
  "sharedPaymentToken": "spt_ExampleTokenFromTheUsersLinkWallet",
  "total": {
    "amount": "132.40",
    "currency": "USD"
  }
}

response = httpx.post(
    "https://api.fortrip.ai/v1/orders/ord_Wr4tY7uI0oPa3SdF6gHj/pay",
    headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    json=body,
    timeout=180,
)
if response.is_error:
    raise SystemExit(f"HTTP {response.status_code}: {response.text}")
result = response.json()
print(json.dumps(result, indent=2))
