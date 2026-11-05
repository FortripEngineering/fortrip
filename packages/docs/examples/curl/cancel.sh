#!/usr/bin/env bash
# Cancel an order under its terms, accepting no penalty.
# Needs FORTRIP_TOKEN, a Fortrip access token (see device-login).
set -euo pipefail

curl -sS -X POST "https://api.fortrip.ai/v1/orders/ord_Wr4tY7uI0oPa3SdF6gHj/cancel" \
  -H "Authorization: Bearer $FORTRIP_TOKEN" \
  -H "Content-Type: application/json" \
  --data @- <<'JSON'
{
  "maximumPenalty": 0
}
JSON
