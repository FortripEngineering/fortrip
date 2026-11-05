# Get live offers for a hotel.
# Needs FORTRIP_TOKEN, a Fortrip access token (see device-login), and httpx.
import json
import os

import httpx

token = os.environ["FORTRIP_TOKEN"]

body = {
  "hotelIds": [
    "htl_Qm3xK9vT2pLw7Hn4Rb8Z"
  ],
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
    "requireFreeCancellation": True
  }
}

response = httpx.post(
    "https://api.fortrip.ai/v1/hotels/offers",
    headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    json=body,
    timeout=60,
)
if response.is_error:
    raise SystemExit(f"HTTP {response.status_code}: {response.text}")
result = response.json()
print(json.dumps(result, indent=2))
