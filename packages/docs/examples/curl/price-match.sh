#!/usr/bin/env bash
# Ask for a price match: the user saw this stay cheaper on TravelDeals.
# Needs FORTRIP_TOKEN, a Fortrip API key or access token (see step 1 above).
set -euo pipefail

curl -sS --fail-with-body --max-time 60 -X POST "https://api.fortrip.ai/v1/price-matches" \
  -H "Authorization: Bearer $FORTRIP_TOKEN" \
  -H "Content-Type: application/json" \
  --data @- <<'JSON'
{
  "offerId": "off_Bz6yN1cD5fGh8JkM2pQs",
  "site": "TravelDeals",
  "seenTotal": {
    "amount": "120.00",
    "currency": "USD"
  }
}
JSON
