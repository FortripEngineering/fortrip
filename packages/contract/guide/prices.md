{{#if claude-skill cli}}
## Prices and currency

- A search price (`price.fromPerRoomNight`) is indicative and not bookable: the lowest price of one unit (a room or, at a hostel, possibly a bed) per night, for any party and often any date, and it can be well above or below the offers. Call it an estimate, quote `{{tool:hotels offers}}` prices, and never call a search result available or bookable. `price: null` means there is no indicative price, not that the hotel is full; about half the hotels have none for given dates.
{{/if}}
{{#if mcp}}
- Search prices are indicative, not bookable: quote `{{tool:hotels offers}}` prices.
{{/if}}
- {{#if claude-skill cli}}In an offer or order, {{/if}}`price.total` is the whole stay for all rooms and is what is charged, in USD for offers and the orders made from them.{{#if claude-skill cli}} `perNightAllRooms` is the total per night; to compare with a per-room budget, also divide by the rooms.{{/if}} Stripe's page may let the user pay in their card's local currency at Stripe's rate (Adaptive Pricing){{#if claude-skill cli}}: say so plainly, and that the USD total is the price{{/if}}. `approx`{{#if claude-skill cli}}, in `{{arg:displayCurrency}}`, with its `rateDate`,{{/if}} is an estimate, never the charge.
{{#if claude-skill cli}}
- `{{arg:displayCurrency}}`{{#if cli}} (or `FORTRIP_DISPLAY_CURRENCY`){{/if}} is `USD` or `CNY`: `CNY` adds `approx` in yuan to suit a user who thinks in it. It never changes the charge.
- Fees payable at the property (`payAtProperty`) are separate, in the property's own currency, not converted.
- After payment, `payment.localCharge` is what the card paid in its own currency. Orders made on the Fortrip website can be charged in another currency: `payment.chargeCurrency` says which.
{{/if}}
