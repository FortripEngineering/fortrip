# List your orders, newest first.
# Needs FORTRIP_TOKEN, a Fortrip access token (see device-login), and httpx.
import json
import os

import httpx

token = os.environ["FORTRIP_TOKEN"]

response = httpx.get(
    "https://api.fortrip.ai/v1/orders?limit=10",
    headers={"Authorization": f"Bearer {token}"},
)
result = response.json()
if response.is_error:
    raise SystemExit(json.dumps(result, indent=2))
print(json.dumps(result, indent=2))
