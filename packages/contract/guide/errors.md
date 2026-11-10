{{#if claude-skill cli}}
## Errors

{{#if claude-skill}}A tool error{{/if}}{{#if cli}}An error on stderr{{/if}} carries `code`, `message` and `retryable`, and `retryAfterSeconds` when waiting helps; many carry `details`. Search errors are under Search. Ordering errors:

| `code` | Do this |
|---|---|
| `offer_changed` (409) | The price or terms changed since the offer: `changes` lists every change (`worse` says which are worse for the user) and `offer` is the new offer. Show the user every change and ask again; if they still want it, order the new offer |
| `offer_expired` (409) | Get offers again and let the user choose again |
| `offer_unavailable` (422) | The offer is sold out or was refused: get offers again and let the user choose again |
| `order_in_progress` (409) | The order is still being created, or still being confirmed when cancelling it: wait `retryAfterSeconds`, then {{#if claude-skill}}call again with the same details{{/if}}{{#if cli}}run the command again with identical flags{{/if}} |
| `offer_already_ordered` (409) | This offer was already ordered with other details: show that order (`orderId`) instead. An offer is ordered once, even when its order failed or expired: to order with other details, get offers again |
| `stay_unsupported` (422) | `mixed_occupancy`: order once per party; `max_nights`: at most `max` nights per order |
| `currency_unavailable` (422) | Prices in `details.currency` aren't available yet: tell the user, and ask whether to see USD prices |
| `stay_in_past` (422) | Check-in has passed in the hotel's time zone: ask for new dates |
| `ordering_paused` (503) | Ordering is paused on Fortrip's side: tell the user, and try again only after `retryAfterSeconds` |

Any code:

- `invalid_request` (400): `details.issues` lists each bad field; fix them. For amenities, `details.filterable` lists those that can filter.
- `cursor_invalid` (400): the page is gone; search again from the first page.
- `not_found` (404): no such hotel, or no such order for this user.
- `rate_limited` (429): wait `retryAfterSeconds`, then retry once.
- `service_unavailable` (503) and `supplier_unavailable` (503 or 504): wait `retryAfterSeconds`, then retry once with the same details; if it fails again, tell the user.
- Any other code: read `message`. If `retryable` is true, wait `retryAfterSeconds` and retry once; otherwise tell the user instead of guessing.
{{/if}}
