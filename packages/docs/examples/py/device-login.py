# Sign in with the OAuth device flow and print an access token.
# Prints the access token; export it as FORTRIP_TOKEN. Needs httpx.
import sys
import time

import httpx

config = httpx.get("https://api.fortrip.ai/v1/auth/config").json()

device = httpx.post(
    config["deviceAuthorizationEndpoint"],
    data={"client_id": config["clientId"], "scope": config["scopes"]},
).json()
verification = device.get("verification_uri_complete") or device["verification_uri"]
print(f"Open {verification} and approve the sign-in.", file=sys.stderr)

interval = device.get("interval", 5)
while True:
    time.sleep(interval)
    token = httpx.post(
        config["tokenEndpoint"],
        data={
            "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
            "device_code": device["device_code"],
            "client_id": config["clientId"],
        },
    ).json()
    if "error" not in token:
        print(token["access_token"])
        break
    if token["error"] == "slow_down":
        interval += 5
    elif token["error"] != "authorization_pending":
        raise SystemExit(str(token))
