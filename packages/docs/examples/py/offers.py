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
    "requireFreeCancellation": true
  }
}

response = httpx.post(
    "https://api.fortrip.ai/v1/hotels/offers",
    headers={"Authorization": f"Bearer {token}"},
    json=body,
)
result = response.json()
if response.is_error:
    raise SystemExit(json.dumps(result, indent=2))
print(json.dumps(result, indent=2))
