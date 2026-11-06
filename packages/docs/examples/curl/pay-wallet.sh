#!/usr/bin/env bash
# Pay an order with Alipay or WeChat Pay: opens the payment.
# Needs FORTRIP_TOKEN, a Fortrip access token (see Sign in above).
set -euo pipefail

curl -sS --fail-with-body --max-time 180 -X POST "https://api.fortrip.ai/v1/orders/ord_Wr4tY7uI0oPa3SdF6gHj/pay" \
  -H "Authorization: Bearer $FORTRIP_TOKEN" \
  -H "Content-Type: application/json" \
  --data @- <<'JSON'
{
  "method": "stripe_alipay_wechat_pay",
  "total": {
    "amount": "132.40",
    "currency": "USD"
  }
}
JSON
