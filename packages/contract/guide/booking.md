{{#if claude-skill cli}}
## Booking

{{/if}}
- Call `{{tool:hotels book}}` only for the rate the user picked{{#if claude-skill cli}}, with exactly the hotel, `{{arg:items.offerId}}`, dates, `{{arg:stay.rooms}}`, `adults` and `childrenAges` used in `{{tool:hotels offers}}`{{/if}}.
- Guest names: Latin letters as on the passport (Müller → Mueller), first and last name 1–{{limit:guestName}} characters each{{#if cli}}, as `--guest "First Last"` (the last word is the last name; `"First Last:2"` puts the guest in room 2){{/if}}.{{#if claude-skill cli}} At least one guest per room, no more than the room sleeps.{{/if}}
{{#if claude-skill cli}}
- A contact name (up to {{limit:contactFirstName}} characters) and phone ({{limit:contactPhoneMin}}–{{limit:contactPhoneMax}} characters) are required; an email is optional. Special requests must be in English and aren't guaranteed.
- One booking covers at most {{limit:nightsSupplier}} nights; book a longer stay as separate bookings.
{{/if}}
- `{{tool:hotels book}}` can take up to about two minutes{{#if cli}}: allow the command at least 3 minutes{{/if}}. If it times out, {{#if cli}}run it again with identical flags{{/if}}{{#if mcp claude-skill}}call it again with the same details{{/if}}: it resumes the same order{{#if claude-skill cli}}, with the same or a refreshed payment link{{/if}}.
{{#if cli}}
- `{{tool:hotels book}}` takes only these fields: a `--body` with any other field (such as `nationality`) is rejected with exit 2.
{{/if}}
