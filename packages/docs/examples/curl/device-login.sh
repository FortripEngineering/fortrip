#!/usr/bin/env bash
# Sign in with the OAuth device flow and print an access token.
# Needs curl and jq. Prints the access token; export it as FORTRIP_TOKEN.
set -euo pipefail

config=$(curl -sS "https://api.fortrip.ai/v1/auth/config")
client_id=$(jq -r .clientId <<<"$config")
token_endpoint=$(jq -r .tokenEndpoint <<<"$config")

device=$(curl -sS "$(jq -r .deviceAuthorizationEndpoint <<<"$config")" \
  -d client_id="$client_id" \
  --data-urlencode scope="$(jq -r .scopes <<<"$config")")
echo "Open $(jq -r '.verification_uri_complete // .verification_uri' <<<"$device") and approve the sign-in." >&2

device_code=$(jq -r .device_code <<<"$device")
interval=$(jq -r '.interval // 5' <<<"$device")

while true; do
  sleep "$interval"
  token=$(curl -sS "$token_endpoint" \
    -d grant_type=urn:ietf:params:oauth:grant-type:device_code \
    -d device_code="$device_code" \
    -d client_id="$client_id")
  case "$(jq -r '.error // empty' <<<"$token")" in
    "") jq -r .access_token <<<"$token"; break ;;
    authorization_pending) ;;
    slow_down) interval=$((interval + 5)) ;;
    *) echo "$token" >&2; exit 1 ;;
  esac
done
