#!/usr/bin/env bash
# Read an order, and print the link to pay it (payment_link) when it awaits payment.
# Needs FORTRIP_TOKEN, a Fortrip access token (see device-login).
set -euo pipefail

curl -sS "https://api.fortrip.ai/v1/orders/ord_Wr4tY7uI0oPa3SdF6gHj" \
  -H "Authorization: Bearer $FORTRIP_TOKEN" \
  | jq -r '.payment.url'
