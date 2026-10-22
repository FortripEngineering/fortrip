{{#if claude-skill cli}}
## Prices and currency

{{/if}}
- In `{{tool:rates}}`, `totalPrice` is the whole stay for all rooms, and `dailyPrices` are per room per night.{{#if claude-skill cli}} To compare with a per-night or per-room budget, divide the total by the nights and rooms, or use `dailyPrices`.{{/if}}
- Pass `{{arg:currency}}`{{#if claude-skill cli}} to `{{tool:search}}` and `{{tool:rates}}`{{/if}}: `CNY` (the default) or `USD`, to suit the user's language or location.{{#if cli}} Without `--currency`, the CLI uses the currency in `--body`, then `FORTRIP_CURRENCY`, then `CNY`.{{/if}}{{#if claude-skill cli}} Prices are converted at Stripe's exchange rate, or a fixed fallback rate when Stripe is unavailable; `fx` says which, and is `null` when nothing needed converting.{{/if}}
{{#if claude-skill cli}}
- `{{arg:priceMin}}` and `{{arg:priceMax}}` on `{{tool:search}}` bound the indicative nightly price, in that currency.
{{/if}}
- The charge is the `amount` in the `currency` that `{{tool:book}}` returns (currently USD). A converted price is a reference: never present it as the charge.{{#if claude-skill cli}} Stripe's page may also show the charge in the user's local currency, at Stripe's rate. Fees paid at the hotel are separate, in their own currency.{{/if}}
