# Check an API key: print the account it acts as.
# Needs FORTRIP_TOKEN, a Fortrip API key (ak_…) or access token, and httpx.
import os

import httpx

token = os.environ["FORTRIP_TOKEN"]

response = httpx.get(
    "https://api.fortrip.ai/v1/me",
    headers={"Authorization": f"Bearer {token}"},
    timeout=60,
)
if response.is_error:
    raise SystemExit(f"HTTP {response.status_code}: {response.text}")
me = response.json()
print(me["userId"], me["email"])
