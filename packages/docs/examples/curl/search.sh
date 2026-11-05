#!/usr/bin/env bash
# Search hotels in a city.
# Needs FORTRIP_TOKEN, a Fortrip access token (see device-login).
set -euo pipefail

curl -sS -X POST "https://api.fortrip.ai/v1/hotels/search" \
  -H "Authorization: Bearer $FORTRIP_TOKEN" \
  -H "Content-Type: application/json" \
  --data @- <<'JSON'
{
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
JSON
