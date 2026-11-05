#!/usr/bin/env bash
# Create an order from an offer. Nothing is charged until it is paid.
# It can take a couple of minutes. If it times out, send the same body again:
# it answers the same order.
# Needs FORTRIP_TOKEN, a Fortrip access token (see Sign in above).
set -euo pipefail

curl -sS --fail-with-body --max-time 180 -X POST "https://api.fortrip.ai/v1/orders" \
  -H "Authorization: Bearer $FORTRIP_TOKEN" \
  -H "Content-Type: application/json" \
  --data @- <<'JSON'
{
  "contact": {
    "firstName": "Ada",
    "lastName": "Lovelace",
    "email": "ada@example.com",
    "phone": "+14155550132"
  },
  "items": [
    {
      "offerId": "off_Bz6yN1cD5fGh8JkM2pQs",
      "hotel": {
        "rooms": [
          {
            "guests": [
              {
                "firstName": "Ada",
                "lastName": "Lovelace"
              },
              {
                "firstName": "Charles",
                "lastName": "Babbage"
              }
            ]
          }
        ]
      }
    }
  ]
}
JSON
