# Create an order from an offer. Nothing is charged until it is paid.
# It can take a couple of minutes. A call that timed out is safe to send again:
# https://docs.fortrip.ai/api#retries
# Needs FORTRIP_TOKEN, a Fortrip access token (see Sign in above), and httpx.
import json
import os

import httpx

token = os.environ["FORTRIP_TOKEN"]

body = {
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

response = httpx.post(
    "https://api.fortrip.ai/v1/orders",
    headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    json=body,
    timeout=180,
)
if response.is_error:
    raise SystemExit(f"HTTP {response.status_code}: {response.text}")
result = response.json()
print(json.dumps(result, indent=2))
