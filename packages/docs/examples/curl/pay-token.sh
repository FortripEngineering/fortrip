#!/usr/bin/env bash
# Pay an order with a Stripe shared payment token.
# Needs FORTRIP_TOKEN, a Fortrip access token (see device-login).
set -euo pipefail

curl -sS -X POST "https://api.fortrip.ai/v1/orders/ord_Wr4tY7uI0oPa3SdF6gHj/pay" \
  -H "Authorization: Bearer $FORTRIP_TOKEN" \
  -H "Content-Type: application/json" \
  --data @- <<'JSON'
{
  "sharedPaymentToken": "spt_ExampleTokenFromTheUsersLinkWallet",
  "total": {
    "amount": "132.40",
    "currency": "USD"
  }
}
JSON
