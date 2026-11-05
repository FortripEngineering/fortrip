#!/usr/bin/env bash
# Sign in with the OAuth device flow and print an access token.
# Needs curl and jq. Prints the access token; export it as FORTRIP_TOKEN.
set -euo pipefail

config=$(curl -sS --fail-with-body --max-time 60 "https://api.fortrip.ai/v1/auth/config")
client_id=$(jq -r .clientId <<<"$config")
token_endpoint=$(jq -r .tokenEndpoint <<<"$config")

device=$(curl -sS --fail-with-body --max-time 60 "$(jq -r .deviceAuthorizationEndpoint <<<"$config")" \
  -d client_id="$client_id" \
  --data-urlencode scope="$(jq -r .scopes <<<"$config")")
device_code=$(jq -r '.device_code // empty' <<<"$device")
if [ -z "$device_code" ]; then
  echo "No device_code in the answer: $device" >&2
  exit 1
fi
echo "Open $(jq -r '.verification_uri_complete // .verification_uri' <<<"$device") and approve the sign-in." >&2

interval=$(jq -r '.interval // 5' <<<"$device")
deadline=$((SECONDS + $(jq -r '.expires_in // 600' <<<"$device")))

while [ "$SECONDS" -lt "$deadline" ]; do
  sleep "$interval"
  token=$(curl -sS --max-time 60 "$token_endpoint" \
    -d grant_type=urn:ietf:params:oauth:grant-type:device_code \
    -d device_code="$device_code" \
    -d client_id="$client_id")
  case "$(jq -r '.error // empty' <<<"$token")" in
    "") jq -r .access_token <<<"$token"; exit 0 ;;
    authorization_pending) ;;
    slow_down) interval=$((interval + 5)) ;;
    *) echo "$token" >&2; exit 1 ;;
  esac
done
echo "The sign-in expired before it was approved. Run this again." >&2
exit 1
