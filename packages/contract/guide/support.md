{{#if claude-skill cli}}
## Cancelling an order

`{{tool:orders get}}` and `{{tool:orders list}}` say of each order whether the user can cancel it now (`cancel.available`), and then the penalty under its terms (`cancel.penalty`) and the refund, what was paid less the penalty (`cancel.refund`), both in the charge currency; otherwise `cancel.reason` says why not.

1. Show the user the stay (hotel, dates), `cancel.penalty` and `cancel.refund` (amount and currency). A refund of 0 means nothing is paid back: say so plainly.
2. End that reply by asking the user to confirm the cancellation, and wait for a clear yes.
3. Then {{#if claude-skill}}call{{/if}}{{#if cli}}run{{/if}} `{{tool:orders cancel}}` with `{{arg:maximumPenalty}}` set to `cancel.penalty.amount` as shown. Never state a refund the order didn't return, and never choose or work out an amount yourself.

The order is then `cancelling`, and `cancelled` once the hotel has cancelled and the refund is issued: check it with `{{tool:orders get}}`. If the hotel refuses, the order is `confirmed` again with `cancel.reason` `refused`. `cancellation_changed` (409) means the penalty is now higher than the one the user agreed to: read the order again and ask the user again. `order_not_cancellable` (409) says why in `reason`.{{#if cli}} Without `--max-penalty`, `{{tool:orders cancel}}` cancels nothing: it prints the penalty and the refund and exits 2.{{/if}}

## Changes and support

{{/if}}
{{#if mcp}}For changes{{/if}}{{#if claude-skill}}These tools can't change an order: for changes{{/if}}{{#if cli}}The CLI can't change an order: for changes{{/if}}, a cancellation that `{{tool:orders cancel}}` can't make, or other problems, the user emails {{support}} with the order's `reference` (never `payment.url`).
