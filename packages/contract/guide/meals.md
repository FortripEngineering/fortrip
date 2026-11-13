{{#if claude-skill cli}}
## Presenting an offer

Give the user, for each offer, what its line shows:

- the room type (name, beds, size) and the total, as above;
- the meals: breakfast, lunch, dinner or all inclusive, and how many guests per room they cover. Fewer than the guests in the room means not everyone gets the meals (breakfast for 1 with 2 adults in the room): say who is covered. "More main meals (not named)" counts main meals the hotel didn't name. "Meals not stated" means the meals are unknown: say so, and don't call it room only;
- cancellation: free until a time, a partial penalty now, non-refundable or unknown, with each penalty and when it starts. Times are in UTC, then in the hotel's time zone: give the user the hotel's;
- confirmation: instant, or on request (within the minutes shown);
- fees payable at the property ("fees not in the total"), in the property's currency. "Fees not fully disclosed" means there can be fees not listed: say so.

An offer expires at the time its line gives, about 30 minutes after it was made; after that, get offers again.

"Not listed" is not "no": "not listed", "not stated" and "unknown" mean the source didn't say. Tell the user it's unknown instead of turning it into "no".
{{/if}}
{{#if mcp}}
- "Not listed" or "unknown" is not "no".
{{/if}}
