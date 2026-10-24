{{#if claude-skill cli}}
## Errors

{{#if claude-skill}}A tool error{{/if}}{{#if cli}}An error on stderr{{/if}} carries `code`, `message` and `retryable`, and `retryAfterSeconds` when waiting helps; many carry `details`. Search errors are under Search. Ordering errors:

| `code` | Do this |
|---|---|
| `offer_changed` (409) | The price or terms changed since the offer: `changes` lists every change (`worse` says which are worse for the user) and `offer` is the new offer. Show the user every change and ask again; if they still want it, order the new offer, and confirm the new order before giving its link |
| `offer_expired` (409) | Get offers again and let the user choose again |
| `offer_unavailable` (422) | The offer is sold out or was refused: get offers again and let the user choose again |
| `order_in_progress` (409) | The same order is still being created: wait `retryAfterSeconds`, then {{#if claude-skill}}call again with the same details{{/if}}{{#if cli}}run the command again with identical flags{{/if}} |
| `offer_already_ordered` (409) | This offer was already ordered with other details: show that order (`orderId`) instead. An offer is ordered once |
| `order_exists` (409) | This stay already has an order (`orderId`, `status`): show it instead of ordering again. This also blocks ordering the same offer, dates and rooms again for another party, ordering a stay again after it was cancelled, ordering while the user's own website checkout for the stay is open (up to 3 hours 45 minutes) and ordering again a stay whose earlier order failed at the hotel. For those, the user emails {{support}} |
| `order_attempts_exhausted` (409) | This order can't be tried again: the user emails {{support}} with its `reference` |
| `order_removed` (410) | The order was never completed and no payment is held: get offers again and order the new offer (the order keeps its `orderId`) |
| `stay_unsupported` (422) | `mixed_occupancy`: order once per party; `max_nights`: at most `max` nights per order |
| `stay_in_past` (422) | Check-in has passed in the hotel's time zone: ask for new dates |
| `ordering_paused` (503) | Ordering is paused on Fortrip's side: tell the user, and try again only after `retryAfterSeconds` (10 minutes or more) |

Any code:

- `invalid_request` (400): `details.issues` lists each bad field; fix them. For amenities, `details.filterable` lists those that can filter.
- `cursor_invalid` (400): the page is gone; search again from the first page.
- `not_found` (404): no such hotel, or no such order for this user.
- `rate_limited` (429): wait `retryAfterSeconds`, then retry once.
- `service_unavailable` (503) and `supplier_unavailable` (503 or 504): wait `retryAfterSeconds`, then retry once with the same details; if it fails again, tell the user.
- Any other code: read `message`. If `retryable` is true, wait `retryAfterSeconds` and retry once; otherwise tell the user instead of guessing.
{{/if}}
