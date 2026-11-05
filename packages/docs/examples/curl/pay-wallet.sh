#!/usr/bin/env bash
# Pay an order with Alipay or WeChat Pay: opens the payment.
# Needs FORTRIP_TOKEN, a Fortrip access token (see device-login).
set -euo pipefail

curl -sS --fail-with-body --max-time 60 -X POST "https://api.fortrip.ai/v1/orders/ord_Wr4tY7uI0oPa3SdF6gHj/pay" \
  -H "Authorization: Bearer $FORTRIP_TOKEN" \
  -H "Content-Type: application/json" \
  --data @- <<'JSON'
{
  "method": "alipay_wechat_pay",
  "total": {
    "amount": "132.40",
    "currency": "USD"
  }
}
JSON
