# Search hotels in a city.
# Needs FORTRIP_TOKEN, a Fortrip access token (see Sign in above), and httpx.
import json
import os

import httpx

token = os.environ["FORTRIP_TOKEN"]

body = {
  "destination": {
    "kind": "place_name",
    "name": "Kyoto",
    "countryCode": "JP"
  },
  "stay": {
    "checkIn": "2027-03-10",
    "checkOut": "2027-03-12",
    "rooms": [
      {
        "adults": 2,
        "childrenAges": []
      }
    ]
  },
  "filters": {
    "amenities": [
      "wifi"
    ]
  },
  "sort": "price_asc"
}

response = httpx.post(
    "https://api.fortrip.ai/v1/hotels/search",
    headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    json=body,
    timeout=60,
)
if response.is_error:
    raise SystemExit(f"HTTP {response.status_code}: {response.text}")
result = response.json()
print(json.dumps(result, indent=2))
