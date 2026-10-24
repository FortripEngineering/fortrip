{{#if claude-skill cli}}
## Before giving the payment link

`{{tool:hotels book}}` answers with an unpaid order: `status` `awaiting_payment`, its `reference` (the support number), `price.total`, the stay and its terms, and `payment.url`, a Fortrip page that recaps the order and continues to payment on Stripe. Nothing is charged until the user pays.

1. Show the order's total and currency, the stay (hotel, room, dates, rooms and guests per room) and every term: meals, cancellation (status, deadline, penalties) and fees payable at the property, unknowns included.
2. End that reply by asking the user to confirm, and wait for a clear yes. Urgency is not consent.
3. Then give `payment.url` exactly as returned: don't shorten, rebuild or re-encode it.

{{/if}}
{{#if mcp}}
- Before you give `payment.url`, show the user the order's total and currency, the stay and every term, end that reply by asking the user to confirm, and wait for a clear yes. Then give `payment.url` exactly as returned, to this user only: anyone holding it can pay.
{{/if}}
{{#if claude-skill cli}}
- `payment.url` works like a payment credential: anyone holding it can pay. Give it to this user only, never in shared channels, documents, logs or tickets. With `requiresSignIn: true` (an order started on the Fortrip website), the user signs in to pay.
- The link expires at `payment.expiresAt`; the order is then `expired`. To order the stay again, get offers again, and confirm the new order with the user before giving its link.
- An order `awaiting_payment` whose `payment.url` is null had its link unreadable this time: read it again with `{{tool:orders get}}`.
{{/if}}
- Never ask for, accept or pass on payment card details; payment happens only on the payment page.{{#if claude-skill cli}} A card number in a guest name, the contact or the special requests is rejected{{#if cli}} with exit 2{{/if}}.{{/if}}
{{#if claude-skill cli}}

## After payment

Check the order with `{{tool:orders get}}`:

- `confirming` while the hotel confirms, then `confirmed` with the hotel's `confirmationNumber`.
- `failed`: no stay was booked; `payment.status` says whether the payment was released or refunded.
- `needs_attention`: Fortrip is looking into it; the user can email {{support}} with the `reference`.
- `manageUrl` is the user's own page for the order.
{{/if}}
