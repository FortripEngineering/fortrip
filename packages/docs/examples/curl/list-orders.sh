#!/usr/bin/env bash
# List your orders, newest first.
# Needs FORTRIP_TOKEN, a Fortrip access token (see device-login).
set -euo pipefail

curl -sS "https://api.fortrip.ai/v1/orders?limit=10" \
  -H "Authorization: Bearer $FORTRIP_TOKEN"
