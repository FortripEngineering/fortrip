{{#if claude-skill cli}}
## Booking

{{/if}}
- Call `{{tool:hotels book}}` only for the rate the user picked{{#if claude-skill cli}}, with exactly the hotel, `{{arg:roomId}}`, `{{arg:ratePlanCode}}`, dates, `{{arg:rooms}}`, `{{arg:adults}}` and `{{arg:childrenAges}}` used in `{{tool:hotels rates}}`{{/if}}.
- Guest names: Latin letters as on the passport (Müller → Mueller), first and last name 1–{{limit:guestName}} characters each{{#if cli}}, as `--guest "First Last"` (the last word is the last name; `"First Last:2"` puts the guest in room 2){{/if}}.{{#if claude-skill cli}} At least one guest per room, no more than the room sleeps.{{/if}}
{{#if claude-skill cli}}
- A contact name (up to {{limit:contactName}} characters) and phone ({{limit:contactPhoneMin}}–{{limit:contactPhoneMax}} characters) are required; an email is optional. Special requests must be in English and aren't guaranteed.
- One booking covers at most {{limit:nights}} nights; book a longer stay as separate bookings.
{{/if}}
- The `{{arg:nationality}}` given to `{{tool:hotels rates}}` isn't sent with the booking: a rate restricted by nationality may change or be refused.
- `{{tool:hotels book}}` can take up to about two minutes{{#if cli}}: allow the command at least 3 minutes{{/if}}. If it times out, {{#if cli}}run it again with identical flags{{/if}}{{#if mcp claude-skill}}call it again with the same details{{/if}}: it resumes the same order{{#if claude-skill cli}}, with the same or a refreshed payment link{{/if}}.
{{#if cli}}
- `{{tool:hotels book}}` takes only these fields: a `--body` with any other field (such as `nationality`) is rejected with exit 2.
{{/if}}
