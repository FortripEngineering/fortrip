# Planning a hotel stay

Read this when the request is more than one hotel for fixed dates: flexible dates, a budget, split stays, several destinations, or "find me the best". The rules in the server instructions still apply (call order, destinations, confirming the order `create_order` returns before giving the payment link); this covers what to ask, how to compare and how to present.

## What to collect

Keep track of: dates (or the flexible window), nights, destination(s) with their country, rooms and the guests in each room, room constraints (beds, connecting rooms, accessibility), budget, and what the user said matters most (cheapest, most flexible, closest to X).

Offers and orders take one party per call, every room the same, so if the party doesn't split evenly across the rooms, ask how it splits. Rooms for different parties are priced and ordered separately, each order with its own payment link.

Ask only for what changes which hotels qualify or how they rank. "4 stars" as `{ min: 4, max: 4 }` leaves out 4.5: unless the user means exactly 4, use `{ min: 4 }` or ask. If children come along, ask each child's age; `get_hotel_offers` needs it. When a place name is ambiguous, ask which place the user means. Don't ask for trip type or style: infer it from the conversation or leave it general.

## Evidence

- A `search_hotels` price is an indicative estimate per room per night, not a quote. Never call a search result available or bookable, and once you have offers, compare offers only. A hotel without a search price can still have offers.
- Use `get_hotel` only when a stated preference needs evidence (a pool, a policy, room size). An amenity or policy it doesn't list is unknown, not absent.
- A hotel is available only once `get_hotel_offers` returned an offer for it.
- Anything the tools didn't return, such as reviews, style, price trends or exchange rates, is unknown. Say so instead of filling it in.

## Ranking

1. Drop options that break a hard constraint (dates, guests, budget cap, required facility). Compare a budget in the unit the user gave it: per night, per room or for the whole stay. An offer's total covers the whole stay and every room, in the offer's currency.
2. Keep only options with a live offer.
3. Order by the user's stated main goal. Goals they didn't state don't count.
4. Use other preferences only to break ties.

Use the cheapest comparable offer as the baseline unless the user fixed the room type. Two or three plans usually suffice, each with its price difference from the baseline and what it trades off (meals, cancellation, location, confirmation). Give a hotel's name without the double quotes the text shows it in, exactly as written inside them, and dates in the user's notation.

For a split stay or several destinations, price each leg with its own `get_hotel_offers` call and add up the legs. Each leg is a separate `create_order` call, with its own confirmation and its own payment link.

## Stop and say so

- `get_hotel_offers` covers up to 15 hotels per call and takes about 15 seconds, and its offers expire after about 30 minutes. If the request needs more hotels or date combinations than a few calls can cover, narrow it with the user, or present the result as a comparison of the hotels you priced, not the best overall.
- When a search is too broad to price, show its localities and ask the user which they prefer, unless the request already names one of them; never pick one yourself.
- Urgency is not consent. Call `create_order` only for the offer the user picked, and give its payment link only after the user confirms the total, currency, stay and terms of the order `create_order` returned.
