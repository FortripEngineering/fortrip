{{#if claude-skill cli}}
## Presenting an offer

Give the user, for each offer:

- the room (`room.name`, beds, size) and the total, as above;
- the meals: `meals.included` (breakfast, lunch, dinner) or `allInclusive`, with `guestsCoveredPerRoom`. Fewer than the guests per room means not everyone gets the meals (breakfast for 1 with 2 adults in the room): say who is covered. `unspecifiedMainMeals` counts main meals the hotel didn't name. With `known: false`, the meals are unknown: say so, and don't call it room only;
- cancellation: `status` (`free`, `partial_penalty`, `non_refundable` or `unknown`), `freeCancellationEndsAt` (null with `free`: free until check-in) and the `penalties`. Times are in UTC: also give them in the hotel's `timeZone`;
- confirmation: `mode` `instant` or `on_request` (within `withinMinutes`);
- fees payable at the property (`payAtProperty.items`), in the property's currency. `disclosure: "incomplete"` means there can be fees not listed: say so.

An offer expires at `expiresAt`, about 30 minutes after it was made; after that, get offers again.

"Not listed" is not "no": `listed: false` (amenities, policies, rooms), `null` and `unknown` mean the source didn't say. Tell the user it's unknown instead of turning it into "no".
{{/if}}
{{#if mcp}}
- "Not listed" or "unknown" is not "no".
{{/if}}
