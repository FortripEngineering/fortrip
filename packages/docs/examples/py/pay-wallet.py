# Pay an order with Alipay or WeChat Pay: opens the payment.
# Needs FORTRIP_TOKEN, a Fortrip access token (see device-login), and httpx.
import json
import os

import httpx

token = os.environ["FORTRIP_TOKEN"]

body = {
  "method": "alipay_wechat_pay",
  "total": {
    "amount": "132.40",
    "currency": "USD"
  }
}

response = httpx.post(
    "https://api.fortrip.ai/v1/orders/ord_Wr4tY7uI0oPa3SdF6gHj/pay",
    headers={"Authorization": f"Bearer {token}"},
    json=body,
)
result = response.json()
if response.is_error:
    raise SystemExit(json.dumps(result, indent=2))
print(json.dumps(result, indent=2))
