{{#if claude-skill cli}}
## Ordering

{{/if}}
- Call `{{tool:orders create}}` only for the offer the user picked, with at least one guest per room{{#if claude-skill cli}}, named as the user gave them{{/if}}; never invent guests.{{#if claude-skill cli}} Room 1 is the offer's first room, and a room takes no more guests than it sleeps.{{/if}}
{{#if claude-skill}}
- The offer's `offerId` goes inside the one item of `items`, and nowhere else in the arguments.
{{/if}}
{{#if claude-skill cli}}
- Guest names: Latin letters as on the passport (Müller → Mueller), first and last name 1–{{limit:guestName}} characters each{{#if cli}}, as `--guest 1:John:Smith` (room 1, first name, last name){{/if}}.
- The contact's name (up to {{limit:contactName}} characters), email and phone (with its country code) are all required. Special requests must be in English and aren't guaranteed.
{{/if}}
- `{{tool:orders create}}` can take about two minutes{{#if cli}}: allow the command at least 3 minutes{{/if}}. If it times out, {{#if cli}}run it again with identical flags{{/if}}{{#if mcp claude-skill}}call it again with the same details{{/if}}: it returns the same order.
{{#if cli}}
- `{{tool:orders create}}` takes only these fields: a `--body` with any other field (such as `nationality`) is rejected with exit 2.
{{/if}}
