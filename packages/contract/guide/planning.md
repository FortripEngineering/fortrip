# Planning a hotel stay

Read this when the request is more than one hotel for fixed dates: flexible dates, a budget, split stays, several destinations, or "find me the best". The rules in {{#if mcp}}the server instructions{{/if}}{{#if claude-skill}}SKILL.md{{/if}}{{#if cli}}`{{tool:guide}}`{{/if}} still apply (call order, destinations, one party per offer and order, confirming the order `{{tool:hotels book}}` returns before giving the payment link); this covers what to ask, how to compare and how to present.{{#if cli}} As there, `fortrip` is short for `npx -y fortrip@latest`.{{/if}}

## What to collect

Keep track of: dates (or the flexible window), nights, destination(s) with their country, rooms and the guests in each room, room constraints (beds, connecting rooms, accessibility), budget, and what the user said matters most (cheapest, most flexible, closest to X).

Offers and orders take one party per call, every room the same, so if the party doesn't split evenly across the rooms, ask how it splits. Rooms for different parties are priced and ordered separately, each order with its own payment link.

Ask only for what changes which hotels qualify or how they rank. "4 stars" as {{#if mcp claude-skill}}`{ min: 4, max: 4 }`{{/if}}{{#if cli}}`--stars-min 4 --stars-max 4`{{/if}} leaves out 4.5: unless the user means exactly 4, use {{#if mcp claude-skill}}`{ min: 4 }`{{/if}}{{#if cli}}`--stars-min 4`{{/if}} or ask. If children come along, ask each child's age; `{{tool:hotels offers}}` needs it. Don't ask for trip type or style: infer it from the conversation or leave it general. When a place name is ambiguous, ask which place the user means.

## Evidence

- A `{{tool:hotels search}}` price is an indicative estimate per room per night, not a quote. Never call a search result available or bookable, and once you have offers, compare offers only. A hotel without a search price can still have offers.
- Use `{{tool:hotels get}}` only when a stated preference needs evidence (a pool, a policy, room size). An amenity or policy it doesn't list is unknown, not absent.
- A hotel is available only once `{{tool:hotels offers}}` returned an offer for it.
- Anything {{#if mcp claude-skill}}the tools{{/if}}{{#if cli}}the CLI{{/if}} didn't return, such as reviews, style, price trends or exchange rates other than `approx`, is unknown. Say so instead of filling it in.

## Ranking

1. Drop options that break a hard constraint (dates, guests, budget cap, required facility). Compare a budget in the unit the user gave it: per night, per room or for the whole stay. An offer's `price.total` covers the whole stay and every room, in USD.
2. Keep only options with a live offer.
3. Order by the user's stated main goal. Goals they didn't state don't count.
4. Use other preferences only to break ties.

Use the cheapest comparable offer as the baseline unless the user fixed the room type. Show at most three plans, each with its price difference from the baseline and what it trades off (meals, cancellation, location, confirmation). Keep hotel names as returned and dates in the user's notation.

For a split stay or several destinations, price each leg with its own `{{tool:hotels offers}}` call and add up the legs. Each leg is a separate `{{tool:hotels book}}` call, with its own confirmation and its own payment link.

## Stop and say so

- `{{tool:hotels offers}}` covers up to {{limit:offersHotels}} hotels per call and takes about 15 seconds, and its offers expire after about 30 minutes. If the request needs more hotels or date combinations than a few calls can cover, narrow it with the user, or present the result as a comparison of the hotels you priced, not the best overall.
- When a search is too broad to price, show its localities and ask the user which they prefer, unless the request already names one of them; never pick one yourself.
- Urgency is not consent. Call `{{tool:hotels book}}` only for the offer the user picked, and give its payment link only after the user confirms the total, currency, stay and terms of the order `{{tool:hotels book}}` returned.
