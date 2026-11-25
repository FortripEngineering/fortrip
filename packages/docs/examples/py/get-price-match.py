# Read a price match: its state, and the new offer once it is matched.
# Needs FORTRIP_TOKEN, a Fortrip API key or access token (see step 1 above), and httpx.
import json
import os

import httpx

token = os.environ["FORTRIP_TOKEN"]

response = httpx.get(
    "https://api.fortrip.ai/v1/price-matches/clm_Hk5vN8cR2xTq6Wm9Lp3Z",
    headers={"Authorization": f"Bearer {token}"},
    timeout=60,
)
if response.is_error:
    raise SystemExit(f"HTTP {response.status_code}: {response.text}")
result = response.json()
print(json.dumps(result, indent=2))
