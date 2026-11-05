# Create an order from an offer. Nothing is charged until it is paid.
# Needs FORTRIP_TOKEN, a Fortrip access token (see device-login), and httpx.
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
    headers={"Authorization": f"Bearer {token}"},
    json=body,
)
result = response.json()
if response.is_error:
    raise SystemExit(json.dumps(result, indent=2))
print(json.dumps(result, indent=2))
