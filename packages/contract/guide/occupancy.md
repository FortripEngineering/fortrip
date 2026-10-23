{{#if claude-skill cli}}
## Rooms and guests

- {{#if mcp claude-skill}}`stay.rooms` lists each room's party as `{ adults, childrenAges }`: two rooms of 2 adults, one with a child of 6, is `[{ adults: 2, childrenAges: [6] }, { adults: 2, childrenAges: [] }]`{{/if}}{{#if cli}}`--room <adults[:age,…]>`, once per room, gives each room's party: two rooms of 2 adults, one with a child of 6, is `--room 2:6 --room 2`{{/if}}.
- Ask each child's age; offers need it.
- If the party doesn't split evenly across the rooms (3 adults in 2 rooms), ask the user how it splits.
{{/if}}
- Offers and orders take one party per call, every room the same: for different parties, get offers and order once per party.{{#if claude-skill cli}} `{{tool:hotels offers}}` answers `stay_unsupported` (`mixed_occupancy`) for mixed rooms; `{{tool:hotels search}}` accepts them but prices only from the dates, with the note `party_split_required`.{{/if}}
{{#if claude-skill cli}}
- Limits: 1–{{limit:rooms}} rooms, 1–{{limit:adultsPerRoom}} adults and 0–{{limit:childrenPerRoom}} children (aged 0–{{limit:childAgeMax}}) per room, 1–{{limit:nightsSupplier}} nights, up to {{limit:offersHotels}} hotels per `{{tool:hotels offers}}` call. A longer stay answers `stay_unsupported` (`max_nights`): ask the user whether to split it into consecutive stays, each its own order.
{{/if}}
