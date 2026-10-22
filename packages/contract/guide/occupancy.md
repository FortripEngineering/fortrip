{{#if claude-skill cli}}
## Occupancy

{{/if}}
- `{{tool:rates}}` and `{{tool:book}}` both require `{{arg:rooms}}` and `{{arg:adults}}`. `{{arg:adults}}` and `{{arg:childrenAges}}` are **per room**, the same in every room: 2 rooms for 4 adults is {{#if cli}}`--rooms 2 --adults 2`{{/if}}{{#if mcp claude-skill}}`rooms: 2, adults: 2`{{/if}}.
{{#if claude-skill cli}}
- If the party doesn't divide evenly across the rooms (3 adults in 2 rooms), ask the user whether to price every room for the larger number or to price and book each occupancy as its own stay.
- Ask each child's age; `{{tool:rates}}` and `{{tool:book}}` need it.
- Limits: 1–{{limit:rooms}} rooms, 1–{{limit:adultsPerRoom}} adults and 0–{{limit:childrenPerRoom}} children (aged 0–{{limit:childAgeMax}}) per room, 1–{{limit:nights}} nights, up to {{limit:ratesHotels}} hotels per `{{tool:rates}}` call.
{{/if}}
