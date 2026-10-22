{{#if claude-skill cli}}
## Before giving the payment link

`{{tool:book}}` returns `paymentUrl`, `statusUrl`, `orderUrl`, `amount`, `currency`, `terms` and `stay`. Nothing is charged until the user pays.

1. Show the `stay` (hotel, room, dates, nights, rooms, adults and children's ages per room), the `amount` and `currency` to be charged, and every item in `terms`: meal plan (`boardCode` with `boardCount`), cancellation (`refundable`, `freeCancelUntil`, the `cancellation` ladder), confirmation (`isInstantConfirm`, `confirmByMins`) and `payAtHotelFees`.
2. End that reply by asking the user to confirm, and wait for a clear yes. Urgency is not consent.
3. Then give `paymentUrl` exactly as returned: don't shorten, rebuild or re-encode it. It opens a Fortrip page that recaps the booking and continues to payment on Stripe.

{{/if}}
{{#if mcp}}
- Before you give `paymentUrl`, show the user the `stay`, `amount`, `currency` and every item in `terms` that `{{tool:book}}` returned, end that reply by asking them to confirm, and wait for their explicit confirmation. Then give `paymentUrl` exactly as returned, to this user only: anyone holding it can pay.
{{/if}}
- If `amount` or `terms` is null, don't give the link: call `{{tool:book}}` again with the same details, and if either is still null, tell the user to contact {{support}}.
{{#if claude-skill cli}}
- `paymentUrl` works like a payment credential: anyone holding it can pay. Give it to this user only, never in shared channels, documents, logs or tickets. It expires about 3 hours 45 minutes after it was created; for a fresh one, call `{{tool:book}}` again with the same details.
- `statusUrl` is the same page: after payment it shows the booking's confirmation progress, without signing in. `orderUrl` is the user's signed-in order page.
{{/if}}
- Never ask for, accept or pass on payment card details; payment happens only on the payment page.{{#if claude-skill cli}} A card number in a guest name, the contact name or the special requests is rejected{{#if cli}} with exit 2{{/if}}.{{/if}}
