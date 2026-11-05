# Cancel an order under its terms, accepting no penalty.
# Needs FORTRIP_TOKEN, a Fortrip access token (see device-login), and httpx.
import json
import os

import httpx

token = os.environ["FORTRIP_TOKEN"]

body = {
  "maximumPenalty": 0
}

response = httpx.post(
    "https://api.fortrip.ai/v1/orders/ord_Wr4tY7uI0oPa3SdF6gHj/cancel",
    headers={"Authorization": f"Bearer {token}"},
    json=body,
)
result = response.json()
if response.is_error:
    raise SystemExit(json.dumps(result, indent=2))
print(json.dumps(result, indent=2))
