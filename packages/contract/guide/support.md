{{#if claude-skill cli}}
## Cancelling an order

`{{tool:orders get}}` and `{{tool:orders list}}` say on each order's Cancel line what can be done to it now. A paid order that can be cancelled has the penalty under its terms and the refund, what was paid less the penalty, both in the order's currency; an unpaid one can be closed instead. Otherwise the line says what blocks both.

1. Show the user the stay (hotel, dates) and the penalty and the refund on the Cancel line (amount and currency). A refund of 0 means nothing is paid back: say so plainly.
2. End that reply by asking the user to confirm the cancellation, and wait for a clear yes.
3. Then {{#if claude-skill}}make the call{{/if}}{{#if cli}}run the command{{/if}} the Cancel line gives, exactly as shown: `{{tool:orders cancel}}` with `{{arg:maximumPenalty}}` set to the penalty on that line{{#if cli}}, its amount (the CLI takes the currency from the order){{/if}}. Never state a refund the order's text doesn't show, and never choose or work out an amount yourself.

The order is then cancelling, and cancelled once the hotel has cancelled and the refund is issued: check it with `{{tool:orders get}}`, which then says what the cancellation kept and returned. If the hotel refuses, the order is confirmed again and its Cancel line says so. `cancellation_changed` means the penalty is now higher than the one the user agreed to: read the order again and ask the user again. `order_not_cancellable` says which of cancelling and closing applies to the order now, or what blocks both; nothing is ever cancelled or closed by the other one.

Close an unpaid order only once the user says they no longer want it: {{#if claude-skill}}call{{/if}}{{#if cli}}run{{/if}} `{{tool:orders cancel}}` with {{#if claude-skill}}`close: true`{{/if}}{{#if cli}}`--close`{{/if}}. It then reads as not paid, and nothing is charged. `payment_in_progress` means a payment of it is under way: read it again shortly.{{#if cli}} Without `--max-penalty` or `--close`, `{{tool:orders cancel}}` is refused with exit 2 and nothing is sent: `{{tool:orders get}}` shows the order's Cancel line, with the command to run.{{/if}}

## Changes and support

{{/if}}
{{#if mcp}}Cancel a paid order only after the user confirmed the penalty and the refund on its Cancel line; close an unpaid one only once they say they no longer want it. For changes{{/if}}{{#if claude-skill}}These tools can't change an order: for changes{{/if}}{{#if cli}}The CLI can't change an order: for changes{{/if}}, a cancellation that `{{tool:orders cancel}}` can't make, or other problems, the user emails {{support}} with the order's reference (never its payment link).
