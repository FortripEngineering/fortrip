#!/usr/bin/env bash
# Check an API key: print the account it acts as.
# Needs FORTRIP_TOKEN, a Fortrip API key (ak_…) or access token.
set -euo pipefail

curl -sS --fail-with-body --max-time 60 "https://api.fortrip.ai/v1/me" \
  -H "Authorization: Bearer $FORTRIP_TOKEN" \
  | jq '{userId, email}'
