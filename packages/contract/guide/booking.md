{{#if claude-skill cli}}
## Ordering

{{/if}}
- Call `{{tool:hotels book}}` only for the offer the user picked, with at least one guest per room{{#if claude-skill cli}}, named as the user gave them{{/if}}; never invent guests.{{#if claude-skill cli}} Room 1 is the offer's first room, and a room takes no more guests than it sleeps.{{/if}}
- Guest names: Latin letters as on the passport (Müller → Mueller), first and last name 1–{{limit:guestName}} characters each{{#if cli}}, as `--guest 1:John:Smith` (room 1, first name, last name){{/if}}.
{{#if claude-skill cli}}
- The contact's first and last name (up to {{limit:contactFirstName}} characters each), email and phone (with its country code) are all required. Special requests must be in English and aren't guaranteed.
{{/if}}
- `{{tool:hotels book}}` can take up to about two minutes{{#if cli}}: allow the command at least 3 minutes{{/if}}. If it times out, {{#if cli}}run it again with identical flags{{/if}}{{#if mcp claude-skill}}call it again with the same details{{/if}}: it returns the same order.
{{#if mcp}}
- On `offer_changed`, show the user every change and ask again before ordering the new offer.
{{/if}}
{{#if cli}}
- `{{tool:hotels book}}` takes only these fields: a `--body` with any other field (such as `nationality`) is rejected with exit 2.
{{/if}}
