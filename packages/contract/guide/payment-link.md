{{#if claude-skill cli}}
## Before giving the payment link

`{{tool:hotels book}}` answers with an unpaid order: `status` `awaiting_payment`, its `reference` (the support number), `price.total`, the stay and its terms, and `payment.url`, a Fortrip page that recaps the order and continues to payment on Stripe. Nothing is charged until the user pays.

1. Show the order's total and currency, the stay (hotel, room, dates, rooms and guests per room) and every term: meals, cancellation (status, deadline, penalties) and fees payable at the property, unknowns included.
2. End that reply by asking the user to confirm, and wait for a clear yes. Urgency is not consent.
3. Then give `payment.url` exactly as returned: don't shorten, rebuild or re-encode it.

{{/if}}
{{#if mcp}}
- Pay one way only: give `payment.url` or call `{{tool:orders pay}}`. First show the order's total and currency, the stay and every term, end that reply by asking the user to confirm, and wait for a clear yes. Then give `payment.url` exactly as returned, to this user only: anyone holding it can pay.
{{/if}}
{{#if claude-skill cli}}
- `payment.url` works like a payment credential: anyone holding it can pay. Give it to this user only, never in shared channels, documents, logs or tickets. With `requiresSignIn: true` (an order started on the Fortrip website), the user signs in to pay.
- The link expires at `payment.expiresAt`; the order is then `expired`. To order the stay again, get offers again, and confirm the new order with the user before giving its link.
- Another order of the stay (another party, or a corrected guest name) needs a new offer: get offers again. When it replaces an unpaid order, tell the user to pay only the new link; the earlier one expires unpaid.
- An order `awaiting_payment` whose `payment.url` is null had its link unreadable this time: read it again with `{{tool:orders get}}`.
{{/if}}
- Never ask for, accept or pass on payment card details; payment happens only through Stripe.{{#if claude-skill cli}} A card number in a guest name, the contact or the special requests is rejected{{#if cli}} with exit 2{{/if}}.{{/if}}
{{#if claude-skill cli}}

## Paying without the link

An order whose `payment.methods` has the `stripe_shared_payment_token` entry (in {{#if claude-skill}}a result's text{{/if}}{{#if cli}}the text output{{/if}}, the line "Pay without the link") can also be paid through `{{tool:orders pay}}` with a Stripe shared payment token that the user's Link wallet grants for it. Use it only if you have a tool that can request such a token from the user's Link wallet: Link is for US and Canadian accounts, and caps a spend request at ${{limit:tokenPaymentMaxUsd}}, so a larger order has no such entry. Otherwise give `payment.url`, and never ask the user to create, type or paste a token.

1. Show the user the order's total and currency, the stay (hotel, room, dates, rooms and guests per room) and every term: meals, cancellation and fees payable at the property. End that reply by asking the user to confirm, and wait for a clear yes. The token comes from the user's wallet, never from card details.
2. Request the token from the user's Link wallet with that entry's `handler.config.business_profile` and its `limits`: `maxAmount` (in cents), `currency` and `expiresAt`.
3. {{#if claude-skill}}Call{{/if}}{{#if cli}}Run{{/if}} `{{tool:orders pay}}` with the token and the order's `price.total`{{#if cli}} (`--token`, `--total`){{/if}}{{#if claude-skill}}, the token as `sharedPaymentToken` or in UCP's `payment.instruments`{{/if}}. The order is then `confirming`, its payment `authorized`: check it as after payment.

The charge is in USD: a card in another currency may add a foreign transaction fee. Pay one way only: either give `payment.url` or {{#if claude-skill}}call{{/if}}{{#if cli}}run{{/if}} `{{tool:orders pay}}`. Once `{{tool:orders pay}}` succeeds, `payment.url` stops working; a payment that fails leaves the link open. `payment_total_changed` means the total sent isn't the order's (`details.total`); the order's total hasn't changed: confirm it with the user, then {{#if claude-skill}}call{{/if}}{{#if cli}}run{{/if}} `{{tool:orders pay}}` again with it and the same token. `payment_declined`: the user picks another payment method in their wallet, or pays by link. `payment_action_required`: the card needs a verification this can't give: pay by link. `payment_credential_invalid`: request a new token with that entry's `limits`. `service_unavailable`: call `{{tool:orders pay}}` again with the same token, never a new one. A token pays one order only.

## Paying with Alipay or WeChat Pay

An order whose result text has the line "Pay with Alipay or WeChat Pay" can be paid in the user's Alipay or WeChat wallet, with no token: it is for users who have a mainland-China wallet. {{#if claude-skill}}Call{{/if}}{{#if cli}}Run{{/if}} `{{tool:orders pay}}` {{#if claude-skill}}with `method` `stripe_alipay_wechat_pay`{{/if}}{{#if cli}}the way that line shows{{/if}} and the order's `price.total`, only after the user has confirmed.

1. Show the user the order's total in USD, the stay (hotel, room, dates, rooms and guests per room) and every term: meals, cancellation and fees payable at the property. End that reply by asking the user to confirm, and wait for a clear yes. Pay one way only: `payment.url` or this.
2. Then show the `stripe_alipay_wechat_pay` entry of `payment.methods`: the WeChat Pay code as an image if you can, and both links (WeChat Pay and Alipay). The user pays once, by either. Alipay and WeChat Pay charge at once; if the hotel can't confirm, the payment is refunded in full. The total is in US dollars, and the wallets show it in yuan at their rate.
3. Check the order with `{{tool:orders get}}` until it isn't `awaiting_payment`.

A WeChat Pay code expires {{limit:wechatCodeMinutes}} minutes after it is made, and goes dead earlier if the user opens the Alipay link instead. Then that entry's `wechatPay.qrData` is null: tell the user to open the WeChat link again, or {{#if claude-skill}}call{{/if}}{{#if cli}}run{{/if}} `{{tool:orders pay}}` again for a new code.

WeChat can't scan a code shown on the same phone's screen. Offer both ways, since you can't tell which device the user is on: save the image and scan it from the album (WeChat, then Scan, then Album), or open the WeChat link on another screen; on a phone, the Alipay link opens the Alipay app.

## After payment

Check the order with `{{tool:orders get}}`:

- `confirming` while the hotel confirms, then `confirmed` with the hotel's `confirmationNumber`.
- `failed`: no stay was booked; `payment.status` says whether the payment was released or refunded.
- `needs_attention`: Fortrip is looking into it; the user can email {{support}} with the `reference`.
- `manageUrl` is the user's own page for the order.
{{/if}}
