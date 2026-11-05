# Sign in with the OAuth device flow and print an access token.
# Prints the access token; export it as FORTRIP_TOKEN. Needs httpx.
import sys
import time

import httpx

config_response = httpx.get("https://api.fortrip.ai/v1/auth/config", timeout=60)
if config_response.is_error:
    raise SystemExit(f"HTTP {config_response.status_code}: {config_response.text}")
config = config_response.json()

device_response = httpx.post(
    config["deviceAuthorizationEndpoint"],
    data={"client_id": config["clientId"], "scope": config["scopes"]},
    timeout=60,
)
if device_response.is_error:
    raise SystemExit(f"HTTP {device_response.status_code}: {device_response.text}")
device = device_response.json()
if "device_code" not in device:
    raise SystemExit(f"No device_code in the answer: {device}")
verification = device.get("verification_uri_complete") or device["verification_uri"]
print(f"Open {verification} and approve the sign-in.", file=sys.stderr)

interval = device.get("interval", 5)
deadline = time.monotonic() + device.get("expires_in", 600)
while time.monotonic() < deadline:
    time.sleep(interval)
    # The token endpoint answers 400 with an error while the user hasn't approved.
    token = httpx.post(
        config["tokenEndpoint"],
        data={
            "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
            "device_code": device["device_code"],
            "client_id": config["clientId"],
        },
        timeout=60,
    ).json()
    if "error" not in token:
        print(token["access_token"])
        raise SystemExit(0)
    if token["error"] == "slow_down":
        interval += 5
    elif token["error"] != "authorization_pending":
        raise SystemExit(str(token))
raise SystemExit("The sign-in expired before it was approved. Run this again.")
