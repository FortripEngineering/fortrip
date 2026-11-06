#!/usr/bin/env bash
# Read an order, and print its payment link when it awaits payment.
# Needs FORTRIP_TOKEN, a Fortrip access token (see Sign in above).
set -euo pipefail

link=$(curl -sS --fail-with-body --max-time 60 "https://api.fortrip.ai/v1/orders/ord_Wr4tY7uI0oPa3SdF6gHj" \
  -H "Authorization: Bearer $FORTRIP_TOKEN" \
  | jq -r '.payment.url // empty')
if [ -z "$link" ]; then
  echo "The order has no payment link: it is not awaiting payment, or read it again." >&2
  exit 1
fi
echo "$link"
