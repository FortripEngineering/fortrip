# Ask for a price match: the user saw this stay cheaper on TravelDeals.
# Needs FORTRIP_TOKEN, a Fortrip access token (see Sign in above), and httpx.
import json
import os

import httpx

token = os.environ["FORTRIP_TOKEN"]

body = {
  "offerId": "off_Bz6yN1cD5fGh8JkM2pQs",
  "site": "TravelDeals",
  "seenTotal": {
    "amount": "120.00",
    "currency": "USD"
  }
}

response = httpx.post(
    "https://api.fortrip.ai/v1/price-matches",
    headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    json=body,
    timeout=60,
)
if response.is_error:
    raise SystemExit(f"HTTP {response.status_code}: {response.text}")
result = response.json()
print(json.dumps(result, indent=2))
