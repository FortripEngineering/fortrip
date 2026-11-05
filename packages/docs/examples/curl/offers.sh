#!/usr/bin/env bash
# Get live offers for a hotel.
# Needs FORTRIP_TOKEN, a Fortrip access token (see Sign in above).
set -euo pipefail

curl -sS --fail-with-body --max-time 60 -X POST "https://api.fortrip.ai/v1/hotels/offers" \
  -H "Authorization: Bearer $FORTRIP_TOKEN" \
  -H "Content-Type: application/json" \
  --data @- <<'JSON'
{
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
JSON
