# Planning a hotel stay

Read this when the request is more than one hotel for fixed dates: flexible dates, a budget, split stays, several destinations, or "find me the best". The rules in SKILL.md still apply (call order, occupancy per room, confirming the terms `fortrip:create_booking` returns before giving the payment link); this covers what to ask, how to compare and how to present.

## What to collect

Keep track of: dates (or the flexible window), nights, destination(s), rooms and the guests in each room, room constraints (beds, connecting rooms, accessibility), budget, and what the user said matters most (cheapest, most flexible, closest to X).

Occupancy is per room and the same in every room, so if the party doesn't split evenly across the rooms, ask how it splits.

Ask only for what changes which hotels qualify or how they rank. If children come along, ask each child's age; `fortrip:get_rates` and `fortrip:create_booking` need it. Don't ask for trip type or style: infer it from the conversation or leave it general.

## Evidence

- A `fortrip:search_hotels` price is an indicative minimum, not a quote. Never call a search result available or bookable.
- Use `fortrip:get_hotel` only when a stated preference needs evidence (a pool, a policy, room size).
- A hotel is available only once `fortrip:get_rates` returned a live option for it.
- Anything the tools didn't return, such as reviews, style, price trends or exchange rates other than `fx`, is unknown. Say so instead of filling it in.

## Ranking

1. Drop options that break a hard constraint (dates, guests, budget cap, required facility). Compare a budget in the unit the user gave it: per night, per room or for the whole stay.
2. Keep only options with a live rate.
3. Order by the user's stated main goal. Goals they didn't state don't count.
4. Use other preferences only to break ties.

Use the cheapest comparable live room as the baseline unless the user fixed the room type. Show at most three plans, each with its price difference from the baseline and what it trades off (meal plan, cancellation, location, instant confirmation). Keep hotel names as returned and dates in the user's notation.

For a split stay or several destinations, price each leg with its own `fortrip:get_rates` call and add up the legs. Each leg is a separate `fortrip:create_booking` call, with its own confirmation and its own payment link.

## Stop and say so

- `fortrip:get_rates` covers up to 15 hotels per call and takes about 15 seconds. If the request needs more hotels or date combinations than a few calls can cover, narrow it with the user, or present the result as a comparison of the hotels you priced, not the best overall.
- Urgency is not consent. Call `fortrip:create_booking` only for the rate the user picked, and give its payment link only after the user confirms the amount, currency, stay and terms that `fortrip:create_booking` returned.
