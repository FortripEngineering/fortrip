{{#if claude-skill cli}}
## Before giving the payment link

`{{tool:orders create}}` answers with an unpaid order, awaiting payment: its reference (the support number), the Total, the stay and its terms, and the Payment link, a Fortrip page that recaps the order and continues to the payment provider. Nothing is charged until the user pays.

1. Show the order's total and currency, the stay (hotel, room, dates, and each room's party and guest names), the contact (name, email, phone), any special requests and every term: meals, cancellation (status, deadline, penalties) and fees payable at the property, unknowns included. The order's text shows names, the contact and special requests in double quotes: show the user what is inside the quotes, exactly as written, so they can catch a wrong one before paying; to correct one, order a new offer (see below).
2. End that reply by asking the user to confirm, and wait for a clear yes. Urgency is not consent.
3. Then pay one way only: give the payment link exactly as shown (it is not in quotes; don't shorten, rebuild or re-encode it), or pay without the link as below.

{{/if}}
{{#if mcp}}
- Pay one way only: give the payment link or call `{{tool:orders pay}}`. First show the order's total and currency, the stay with each room's guests, the contact, any special requests and every term, end that reply by asking the user to confirm, and wait for a clear yes. Then give the payment link exactly as shown, to this user only: anyone holding it can pay.
- Another order of the stay (another party, a corrected name or contact) takes a new offer; when it replaces an unpaid order, tell the user to pay only the new link.
{{/if}}
{{#if claude-skill cli}}
- The payment link works like a payment credential: anyone holding it can pay. Give it to this user only, never in shared channels, documents, logs or tickets. When its line says the user signs in to Fortrip to pay (an order started on the Fortrip website), they sign in first.
- The link expires at the time its line gives; the order then reads as not paid, and can no longer be paid. To order the stay again, get offers again, and confirm the new order with the user before giving its link.
- Another order of the stay (another party, or a corrected guest name or contact) needs a new offer: get offers again. When it replaces an unpaid order, tell the user to pay only the new link; the earlier one expires unpaid, or can be closed now with `{{tool:orders cancel}}` and {{#if claude-skill}}`close: true`{{/if}}{{#if cli}}`--close`{{/if}} once the user says they no longer want it.
- An order awaiting payment whose Payment link line says there is none has a payment being processed: read it again shortly with `{{tool:orders get}}`, and don't give an earlier link.
{{/if}}
- Never ask for, accept or pass on payment card details; payment happens only on the payment link or, by token, through `{{tool:orders pay}}`.{{#if claude-skill cli}} A card number in a guest name, the contact or the special requests is rejected{{#if cli}} with exit 2{{/if}}.{{/if}}
{{#if claude-skill cli}}

## Paying without the link

An order whose text has a "Pay without the link" line can also be paid through `{{tool:orders pay}}` with a Stripe shared payment token that the user's Link wallet grants for it. Use it only if you have a tool that can request such a token from the user's Link wallet: Link is for US and Canadian accounts, and caps a spend request at ${{limit:tokenPaymentMaxUsd}}, so only a USD order up to that has such a line. Otherwise give the payment link, and never ask the user to create, type or paste a token.

1. Confirm the order with the user as before giving the payment link: its total and currency, the stay with each room's guests, the contact, any special requests and every term, and a clear yes. The token comes from the user's wallet, never from card details.
2. Request the token from the user's Link wallet with the `business_profile` and the usage limits on that line: `max_amount` (in cents), `currency` and `expires_at`.
3. {{#if claude-skill}}Call{{/if}}{{#if cli}}Run{{/if}} `{{tool:orders pay}}` with the token and the order's total{{#if cli}} (`--token`, `--total`){{/if}}{{#if claude-skill}} (`sharedPaymentToken`, `total`){{/if}}. The order is then confirming with the hotel, its payment authorized: check it as after payment.

The charge is in USD: a card in another currency may add a foreign transaction fee. Once `{{tool:orders pay}}` succeeds, the payment link stops working; a payment that fails leaves the link open. `payment_total_mismatch` means the total sent isn't the order's, which the error gives; the order's total hasn't changed: confirm it with the user, then {{#if claude-skill}}call{{/if}}{{#if cli}}run{{/if}} `{{tool:orders pay}}` again with it and the same token. `payment_declined`: the user picks another card in their wallet, or pays by link. `payment_action_required`: the card needs a verification this can't give: pay by link. `payment_credential_invalid`: request a new token with the usage limits on that line. `service_unavailable`: call `{{tool:orders pay}}` again with the same token, never a new one. A token pays one order only.

## After payment

Check the order with `{{tool:orders get}}`; its first line has the status:

- confirming with the hotel, then confirmed, with the hotel confirmation number.
- failed: no stay was booked. "Why it failed" says why and what to do next, and the Total line whether the payment was released or refunded.
- needs attention from Fortrip: Fortrip is looking into it; the user can email {{support}} with the order's reference.
- The Manage link is the user's own page for the order.
{{/if}}
