{{#if claude-skill cli}}
## Errors

{{#if claude-skill}}A tool error{{/if}}{{#if cli}}An error on stderr{{/if}} starts with "Error" and its code, then says what happened, whether a retry can help and after how many seconds, and what to do next. Search errors are under Search. Ordering errors:

| Code | Do this |
|---|---|
| `offer_changed` | The price or terms changed since the offer: the error lists every change (marking those worse for the user) and the new offer. Show the user every change and ask again; if they still want it, order the new offer |
| `offer_expired` | Get offers again and let the user choose again |
| `offer_unavailable` | The offer is sold out or was refused, and other offers for the same room may be gone too: get offers again and let the user choose again |
| `order_in_progress` | The order is still being created, or still being confirmed when cancelling it: wait as long as the error says, then {{#if claude-skill}}call again with the same details{{/if}}{{#if cli}}run the command again with identical flags{{/if}} |
| `offer_already_ordered` | This offer was already ordered with other details: show the order the error names instead. An offer is ordered once, even when its order failed, expired or was closed: to order with other details, get offers again |
| `stay_unsupported` | Rooms for different parties: order once per party. Too many nights: the error says the most one order takes |
| `currency_unavailable` | Prices in that currency aren't available yet: tell the user, and ask whether to see USD prices |
| `stay_in_past` | Check-in has passed in the hotel's time zone: ask for new dates |
| `ordering_paused` | Ordering is paused on Fortrip's side: tell the user, and try again only after the wait the error gives |

Any code:

- `invalid_request`: the error lists each bad field and what is wrong with it; fix them.
- `cursor_invalid`: the page is gone; start again from the first page.
- `not_found`: no such hotel, or no such order for this user.
- `rate_limited`: wait as long as the error says, then retry once.
- `service_unavailable` and `supplier_unavailable`: wait as long as the error says, then retry once with the same details; if it fails again, tell the user.
- Any other code: read what the error says. If it is retryable, wait as long as it says and retry once; otherwise tell the user instead of guessing.
{{/if}}
