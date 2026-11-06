{{#if claude-skill cli}}
## Cancelling an order

`{{tool:orders get}}` and `{{tool:orders list}}` say of each order whether the user can cancel it now (`cancel.available`). A paid order (`cancel.reason` `cancellable`) then has the penalty under its terms (`cancel.penalty`) and the refund, what was paid less the penalty (`cancel.refund`), both in the charge currency; an unpaid one (`unpaid`) can be closed instead. Otherwise `cancel.reason` says why not.

1. Show the user the stay (hotel, dates), `cancel.penalty` and `cancel.refund` (amount and currency). A refund of 0 means nothing is paid back: say so plainly.
2. End that reply by asking the user to confirm the cancellation, and wait for a clear yes.
3. Then {{#if claude-skill}}call{{/if}}{{#if cli}}run{{/if}} `{{tool:orders cancel}}` with `{{arg:maximumPenalty}}` set to `cancel.penalty` as shown{{#if cli}}, its amount: the CLI takes the currency from the order{{/if}}. Never state a refund the order didn't return, and never choose or work out an amount yourself.

The order is then `cancelling`, and `cancelled` once the hotel has cancelled and the refund is issued: check it with `{{tool:orders get}}`. If the hotel refuses, the order is `confirmed` again with `cancel.reason` `refused`. `cancellation_changed` (409) means the penalty is now higher than the one the user agreed to: read the order again and ask the user again. `order_not_cancellable` (409) says why in `reason`.

Close an unpaid order only once the user says they no longer want it: {{#if claude-skill}}call{{/if}}{{#if cli}}run{{/if}} `{{tool:orders cancel}}` {{#if claude-skill}}without `maximumPenalty`{{/if}}{{#if cli}}with `--close`{{/if}}. It becomes `expired`, and nothing is charged. `payment_in_progress` (409) means a payment of it is under way: read it again shortly.{{#if cli}} Without `--max-penalty` or `--close`, `{{tool:orders cancel}}` changes nothing: it prints the penalty and the refund, or that the order can be closed, and exits 2.{{/if}}

## Changes and support

{{/if}}
{{#if mcp}}For changes{{/if}}{{#if claude-skill}}These tools can't change an order: for changes{{/if}}{{#if cli}}The CLI can't change an order: for changes{{/if}}, a cancellation that `{{tool:orders cancel}}` can't make, or other problems, the user emails {{support}} with the order's `reference` (never `payment.url`).
