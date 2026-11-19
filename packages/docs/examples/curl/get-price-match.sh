#!/usr/bin/env bash
# Read a price match: its state, and the new offer once it is matched.
# Needs FORTRIP_TOKEN, a Fortrip access token (see Sign in above).
set -euo pipefail

curl -sS --fail-with-body --max-time 60 "https://api.fortrip.ai/v1/price-matches/clm_Hk5vN8cR2xTq6Wm9Lp3Z" \
  -H "Authorization: Bearer $FORTRIP_TOKEN"
