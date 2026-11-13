{{#if claude-skill cli}}
## Prices and currency

- A search price (shown as "estimate from … /room-night") is indicative and not bookable: the lowest price of one unit (a room or, at a hostel, possibly a bed) per night, for any party and often any date, and it can be well above or below the offers. Call it an estimate, quote `{{tool:hotels offers}}` prices, and never call a search result available or bookable. A hotel with "no indicative price" isn't full; about half the hotels have none for given dates.
{{/if}}
- {{#if claude-skill cli}}In an offer or order, the total is the whole stay for all rooms and is what is charged, in the request's `{{arg:currency}}` (`USD` by default); an{{/if}}{{#if mcp}}An{{/if}} order is in the currency of the offer it was made from.{{#if claude-skill cli}} An offer's "average per room-night" is its total divided by the rooms and the nights, for comparison only.{{/if}} On a USD order, Stripe's page may let the user pay in their card's local currency at Stripe's rate{{#if claude-skill cli}} (Adaptive Pricing): say so plainly, and that the total in that currency is the price{{/if}}.
{{#if claude-skill cli}}
- Every price of an answer is in that one currency; don't convert it. `{{arg:currency}}`{{#if cli}} (or `FORTRIP_CURRENCY`){{/if}} is `USD` (the default) or `CNY`.
- Each currency is paid through its own channel, with its own payment methods; the order's payment page shows them. CNY is paid through payment channels in mainland China and suits a user who pays that way.
- A search not in CNY may end with a "Currency:" line when the request or the user's latest sign-in comes from mainland China: offer CNY prices if the user may pay that way, and then use CNY for both the search and the offers.
- Fees payable at the property ("fees not in the total") are separate, in the property's own currency, not converted.
- After payment, "card charged" on the order's Total line is what the card paid in its own currency. An order made on the Fortrip website can be in another currency: its Total says which.
{{/if}}
