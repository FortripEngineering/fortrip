{{#if claude-skill cli}}
## Errors

{{#if claude-skill}}A tool error{{/if}}{{#if cli}}An error on stderr{{/if}} carries `error` (what went wrong) and `status`, and most carry a `reason`:

| `reason` | Do this |
|---|---|
| `already_booked` (409) | This stay is already paid or completed: show `orderUrl` and don't book again |
| `price_or_terms_changed` (409) | The rate changed; `changes` says how. Show the user what changed and re-run `{{tool:hotels offers}}`; if they still want it, call `{{tool:hotels book}}` again and confirm the new price and terms before giving the link |
| `rate_unavailable` (422) | The rate can no longer be booked: re-run `{{tool:hotels offers}}` and let the user choose again |
| `supplier_unavailable` (503 or 504) | Wait `retryAfterSeconds` and retry once with the same details; if it fails again, tell the user |
| `refused` (422) | The booking was refused (a guest name, too many attempts, bookings paused): read `error` and explain it to the user |
{{#if claude-skill}}

Without a `reason`:

- **429**: wait `retryAfterSeconds`, then retry once.
- **503** with `retryable: true` is a brief failure on Fortrip's side (for example, the same booking started twice at once): wait `retryAfterSeconds`, then retry once with the same details.
- **500** and **502** are generic failures: read `error` and tell the user instead of guessing.
{{/if}}
{{/if}}
