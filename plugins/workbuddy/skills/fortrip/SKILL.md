---
name: fortrip
description: 用 Fortrip 的 MCP 工具（search_hotels、get_hotel、get_hotel_offers、create_order、get_order、list_orders、cancel_order）搜索、比较、预订和取消酒店住宿，从搜索酒店到拿到订单的付款链接。用户想找酒店、比价、订房或取消订单时使用，包括日期灵活、有预算或有多个目的地的情况。不用于机票、活动、修改已有订单或写代码。
---

Fortrip: hotel search, live offers and orders with a payment link.

Call order: `search_hotels` → (optional) `get_hotel` → `get_hotel_offers` → `create_order`; after the user pays, `get_order`; `list_orders` lists, `cancel_order` cancels a paid order or closes an unpaid one. Every result is text: follow the rules that end it.

Sign-in happens only in the browser. Never ask the user to paste a token.
If a tool says the user isn't signed in, ask them to reconnect.

- A place name needs its `countryCode` (ask the user if unclear) and matches exactly (accents and periods count). On `destination_ambiguous`, ask the user which they mean, then search that place by its id; never pick one yourself.
- On `search_too_broad`, show its localities and ask the user which, unless they already named one; search it as `{ kind: "locality", placeId }`, never by name.
- `text` matches whole words of hotel names and addresses: use a distinctive name, brand or landmark.

- An order is in the currency of the offer it was made from. On a USD order, Stripe's page may let the user pay in their card's local currency at Stripe's rate.

- "Not listed" or "unknown" is not "no".

- Call `create_order` only for the offer the user picked, with at least one guest per room; never invent guests.
- `create_order` can take about two minutes. If it times out, call it again with the same details: it returns the same order.

- First show the order's total and currency, the stay with each room's guests, the contact, any special requests and every term, end that reply by asking the user to confirm, and wait for a clear yes. Then give the payment link exactly as shown, to this user only: anyone holding it can pay.
- Another order of the stay (another party, a corrected name or contact) takes a new offer; when it replaces an unpaid order, tell the user to pay only the new link.
- Never ask for, accept or pass on payment card details; payment happens only on the payment link.

Cancel a paid order only after the user confirmed the penalty and the refund on its Cancel line; close an unpaid one only once they say they no longer want it. An order can't be changed, only cancelled under its terms and ordered again. For a cancellation that `cancel_order` can't make, or other problems, the user emails support@fortrip.ai with the order's reference (never its payment link).
