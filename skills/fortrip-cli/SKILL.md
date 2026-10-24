---
name: fortrip-cli
description: Searches hotels, compares live offers and creates a hotel order with a payment link through the Fortrip command-line tool (npx fortrip). Use when the user wants to find, compare, price or book a hotel stay through Fortrip, you can run shell commands, and Fortrip's MCP tools (search_hotels, get_hotel_offers, book_hotel) aren't available. Not for flights, activities or changing an existing booking.
---

# Fortrip hotel stays

Fortrip: hotel search, live offers and orders with a payment link. Not for flights, activities, or changing or cancelling an existing order.

The `fortrip` CLI (npm package `fortrip`) calls Fortrip as the signed-in user and prints each answer as compact text (`--json` prints its JSON):

| Command | Returns |
|---|---|
| `fortrip hotels search` | Hotels in a place, near a point or matching a name (`--text`), with indicative prices |
| `fortrip hotels get` | One hotel's address, check-in and check-out times, description, policies, amenities and rooms; no prices |
| `fortrip hotels offers` | Live offers (room, meals, total in USD, cancellation terms) for up to 15 hotels |
| `fortrip hotels book` | An unpaid order for one offer, with its terms and a payment link |
| `fortrip orders get` | One order and its status, including whether the hotel confirmed it |
| `fortrip orders list` | The user's orders, newest first, including those made on the Fortrip website |

For flexible dates, a budget, split stays, several destinations or "find me the best", also run `fortrip guide planning` before searching.

## Setup

Run every command as `npx -y fortrip@latest <command>` (Node.js 22 or newer). The examples below shorten that to `fortrip`; `fortrip <command> --help` lists a command's flags. `fortrip hotels search`, `fortrip hotels offers` and `fortrip hotels book` also take `--body '<json>'` (or `--body @file.json`), the raw request body; flags override its fields. Add `--json` to any command that calls Fortrip to get its answer as one line of JSON instead of text.

When the user first asks about hotels, run `fortrip whoami` before asking follow-up questions, so the sign-in can happen while they answer.

## Sign-in

Sign-in happens only in the browser. Never ask the user to paste a token.

If a command exits with code **3** and stderr has `loginUrl`, show it to the user as a link together with `userCode`, e.g. "Sign in to Fortrip: <loginUrl> (code <userCode>), then tell me when you're done." When they confirm, rerun the same command; it finishes the sign-in itself. Don't run `fortrip login`: it waits for up to 10 minutes. Commands that exit 3 together share one `loginUrl`; show it once. If the rerun gives a different `loginUrl`, show that one.

When Fortrip no longer accepts the saved sign-in (it was revoked, or it expired and couldn't be renewed), the command also exits 3 with a `loginUrl`; handle it the same way. The saved sign-in is kept until the user approves the new link.

In CI or a sandbox without a browser, the user can set `FORTRIP_TOKEN` instead. Exit 3 with `tokenSource: "FORTRIP_TOKEN"` means Fortrip didn't accept that token: tell the user to replace or unset it.

## Exit codes

| Code | Meaning | What to do |
|---|---|---|
| 0 | Success; the answer on stdout | Continue |
| 1 | Any other error: an error from Fortrip (see Errors), a network error or a timeout | Read the error on stderr. If `retryable` is true, wait `retryAfterSeconds` (or a few seconds) and retry once |
| 2 | Invalid arguments, or `invalid_request` from Fortrip | Fix the flags; the error lists each bad field with a message |
| 3 | Not signed in | Show `loginUrl` to the user, then rerun (above) |
| 4 | Rate limited | Wait `retryAfterSeconds`, then retry once |

Output on stdout or stderr can carry `warning` (with `recoveryFile` when a sign-in couldn't be saved): pass it on to the user.

## Workflow

1. **Search** with `fortrip hotels search` for candidate hotels: a destination, `--text` or both, and the stay's dates and rooms for indicative prices.

   ```bash
   fortrip hotels search --place-name Bangkok --country TH --check-in 2026-11-10 \
     --check-out 2026-11-12 --room 2 --stars-min 4 --sort price_asc --limit 10
   ```

2. **Details** (optional) with `fortrip hotels get`, when the user asks about a hotel or a stated preference needs evidence (a pool, a policy, room size). For a details-only question, call it directly when you know the hotel's `hotelId`; otherwise find the hotel with `fortrip hotels search`.

   ```bash
   fortrip hotels get <hotelId> [--rooms]
   ```

3. **Offers** with `fortrip hotels offers` for a few shortlisted hotels, with the dates and rooms the user will order. It takes about 15 seconds. A hotel is available only once this returns an offer for it.

   ```bash
   fortrip hotels offers --hotel <hotelId> --hotel <hotelId> --check-in 2026-11-10 \
     --check-out 2026-11-12 --room 2 --room 2 [--require-free-cancellation]
   ```

4. **Order** with `fortrip hotels book`, once the user has picked one offer and given the guests and the contact (see Ordering).

   ```bash
   fortrip hotels book --offer <offerId> --guest 1:John:Smith --guest 2:Mary:Smith \
     --first-name John --last-name Smith --email john@example.com \
     --phone "+8613800000000"
   ```

5. **Confirm, then give the payment link**, as in "Before giving the payment link" below.
6. **After payment**, check the order with `fortrip orders get` (see After payment).

## Search

### Where

- **A place by name:** `--place-name <name> --country <CC>`, in any language (Kyoto or 京都). The country is required: ask the user when it isn't clear. Names match exactly, ignoring only case and spacing: accents, hyphens, apostrophes and periods count ("Köln" or "Cologne", not "Koln"; "St. Moritz", not "St Moritz").
- If several places bear the name, the answer is `destination_ambiguous` with up to 8 candidates and their hotel counts: ask the user which one they mean, then search it by its `placeId`; never pick one yourself.
- `destination_not_found` with `no_match` means no place of that name in that country: check the spelling and accents, or try another name for the place. Its `nameAsText` counts the hotels that a `--text` search for the name would find.
- **A place from an earlier answer:** `--place <placeId>`.
- **Near a point:** `--point <lat,lng>`, for "near X" when you know where X is.
- **A whole country:** `--country-only <CC>`, as for the Maldives.
- Countries, regions (states, provinces), prefecture-level cities in China and main islands cover their whole area. Towns, neighbourhoods, districts, small islands and points cover a circle of 8000 meters; `--radius-meters` sets another, up to 80000 meters, and narrows an area to a circle around its center.
- **Localities:** an area search lists its `localities`, the towns its hotels belong to, each with a `placeId`, its hotel `count` and the places it `includes` (Patong is part of Phuket). To search one, pass it as `--locality <placeId>`. A town that isn't a locality answers `destination_not_found` with `not_a_locality` and the `hub` it belongs to: search the hub, or the town itself with `--place` for a circle around it.
- A price sort or price filter over more than 3000 hotels (in an area, or for text alone) answers `search_too_broad` with `matched` and the top `localities`: show them and ask the user which they prefer, unless the request already names one of them; search that one by its `placeId` as a locality, never by its name.

### Text

`--text` matches exact words in hotel names and addresses, in Chinese or English:

- Every word must match as written: plurals, accents, spacing and abbreviations count ("hostel" and "hostels", "St Regis" and "Saint Regis" find different hotels). Hyphens and apostrophes don't (Ritz-Carlton finds Ritz Carlton).
- In Chinese, matching follows word segmentation, so part of a name can match unrelated hotels (希尔 is not 希尔顿).
- Use only distinctive words: a hotel or brand name, a district or a landmark. Not "hotel", "near", "cheap" or "best".
- Typos return nothing: "Shangahi" finds no hotel.
- Place names belong in the destination: "Maldives" as text finds a hotel named Maldives in China.

### Filters

- Stars run from 1 to 5 in half steps. "4 stars" as `--stars-min 4 --stars-max 4` leaves out 4.5: unless the user means exactly 4, use `--stars-min 4` or ask. Unrated hotels are left out whenever stars are filtered.
- `--amenity` takes only the amenities that can filter (such as pool, parking, wifi); others, such as gym or spa, show in `fortrip hotels get` but can't filter. A hotel matches only when it lists the amenity, and about half the hotels list no amenities at all (`coverage.excludedNoFacilityData` counts those left out): "not listed" is not "absent".
- `--price-max-per-room-night` bounds the indicative price per room per night, in USD; hotels without one are left out and counted.

### Results

- `notes` explain the answer (a limited pool, a circle around an island, more hotels just outside it): pass on what matters to the user.
- `coverage` has the counts: `matched` hotels, how many were priced and how many have a price.
- A next page is `--cursor <nextCursor>` and, optionally, `--limit`; nothing else.

## Rooms and guests

- `--room <adults[:age,…]>`, once per room, gives each room's party: two rooms of 2 adults, one with a child of 6, is `--room 2:6 --room 2`.
- Ask each child's age; offers need it.
- If the party doesn't split evenly across the rooms (3 adults in 2 rooms), ask the user how it splits.
- Offers and orders take one party per call, every room the same: for different parties, order once per party. `fortrip hotels offers` answers `stay_unsupported` (`mixed_occupancy`) for mixed rooms; `fortrip hotels search` accepts them but prices only from the dates, with the note `party_split_required`.
- Limits: 1–8 rooms, 1–8 adults and 0–4 children (aged 0–17) per room, 1–15 nights, up to 15 hotels per `fortrip hotels offers` call. A longer stay answers `stay_unsupported` (`max_nights`): ask the user whether to split it into consecutive stays, each its own order.

## Prices and currency

- A search price (`price.fromPerRoomNight`) is indicative and not bookable: the lowest price of one unit (a room or, at a hostel, possibly a bed) per night, for any party and often any date, and it can be well above or below the offers. Call it an estimate, quote `fortrip hotels offers` prices, and never call a search result available or bookable. `price: null` means there is no indicative price, not that the hotel is full; about half the hotels have none for given dates.
- In an offer or order, `price.total` is the whole stay for all rooms and is what is charged, in USD for offers and the orders made from them. `perNightAllRooms` is the total per night; to compare with a per-room budget, also divide by the rooms. Stripe's page may let the user pay in their card's local currency at Stripe's rate (Adaptive Pricing): say so plainly, and that the USD total is the price. `approx`, in `--display-currency`, with its `rateDate`, is an estimate, never the charge.
- `--display-currency` (or `FORTRIP_DISPLAY_CURRENCY`) is `USD` or `CNY`: `CNY` adds `approx` in yuan to suit a user who thinks in it. It never changes the charge.
- Fees payable at the property (`payAtProperty`) are separate, in the property's own currency, not converted.
- After payment, `payment.localCharge` is what the card paid in its own currency. Orders made on the Fortrip website can be charged in another currency: `payment.chargeCurrency` says which.

## Presenting an offer

Give the user, for each offer:

- the room (`room.name`, beds, size) and the total, as above;
- the meals: `meals.included` (breakfast, lunch, dinner) or `allInclusive`, with `guestsCoveredPerRoom`. Fewer than the guests per room means not everyone gets the meals (breakfast for 1 with 2 adults in the room): say who is covered. `unspecifiedMainMeals` counts main meals the hotel didn't name. With `known: false`, the meals are unknown: say so, and don't call it room only;
- cancellation: `status` (`free`, `partial_penalty`, `non_refundable` or `unknown`), `freeCancellationEndsAt` (null with `free`: free until check-in) and the `penalties`. Times are in UTC: also give them in the hotel's `timeZone`;
- confirmation: `mode` `instant` or `on_request` (within `withinMinutes`);
- fees payable at the property (`payAtProperty.items`), in the property's currency. `disclosure: "incomplete"` means there can be fees not listed: say so.

An offer expires at `expiresAt`, about 30 minutes after it was made; after that, get offers again.

"Not listed" is not "no": `listed: false` (amenities, policies, rooms), `null` and `unknown` mean the source didn't say. Tell the user it's unknown instead of turning it into "no".

## Ordering

- Call `fortrip hotels book` only for the offer the user picked, with at least one guest per room, named as the user gave them; never invent guests. Room 1 is the offer's first room, and a room takes no more guests than it sleeps.
- Guest names: Latin letters as on the passport (Müller → Mueller), first and last name 1–60 characters each, as `--guest 1:John:Smith` (room 1, first name, last name).
- The contact's first and last name (up to 59 characters each), email and phone (with its country code) are all required. Special requests must be in English and aren't guaranteed.
- `fortrip hotels book` can take up to about two minutes: allow the command at least 3 minutes. If it times out, run it again with identical flags: it returns the same order.
- `fortrip hotels book` takes only these fields: a `--body` with any other field (such as `nationality`) is rejected with exit 2.

## Before giving the payment link

`fortrip hotels book` answers with an unpaid order: `status` `awaiting_payment`, its `reference` (the support number), `price.total`, the stay and its terms, and `payment.url`, a Fortrip page that recaps the order and continues to payment on Stripe. Nothing is charged until the user pays.

1. Show the order's total and currency, the stay (hotel, room, dates, rooms and guests per room) and every term: meals, cancellation (status, deadline, penalties) and fees payable at the property, unknowns included.
2. End that reply by asking the user to confirm, and wait for a clear yes. Urgency is not consent.
3. Then give `payment.url` exactly as returned: don't shorten, rebuild or re-encode it.

- `payment.url` works like a payment credential: anyone holding it can pay. Give it to this user only, never in shared channels, documents, logs or tickets. With `requiresSignIn: true` (an order started on the Fortrip website), the user signs in to pay.
- The link expires at `payment.expiresAt`; the order is then `expired`. To order the stay again, get offers again, and confirm the new order with the user before giving its link.
- An order `awaiting_payment` whose `payment.url` is null had its link unreadable this time: read it again with `fortrip orders get`.
- Never ask for, accept or pass on payment card details; payment happens only on the payment page. A card number in a guest name, the contact or the special requests is rejected with exit 2.

## After payment

Check the order with `fortrip orders get`:

- `confirming` while the hotel confirms, then `confirmed` with the hotel's `confirmationNumber`.
- `failed`: no stay was booked; `payment.status` says whether the payment was released or refunded.
- `needs_attention`: Fortrip is looking into it; the user can email info@fortrip.ai with the `reference`.
- `manageUrl` is the user's own page for the order.

## Errors

An error on stderr carries `code`, `message` and `retryable`, and `retryAfterSeconds` when waiting helps; many carry `details`. Search errors are under Search. Ordering errors:

| `code` | Do this |
|---|---|
| `offer_changed` (409) | The price or terms changed since the offer: `changes` lists every change (`worse` says which are worse for the user) and `offer` is the new offer. Show the user every change and ask again; if they still want it, order the new offer, and confirm the new order before giving its link |
| `offer_expired` (409) | Get offers again and let the user choose again |
| `offer_unavailable` (422) | The offer is sold out or was refused: get offers again and let the user choose again |
| `order_in_progress` (409) | The same order is still being created: wait `retryAfterSeconds`, then run the command again with identical flags |
| `offer_already_ordered` (409) | This offer was already ordered with other details: show that order (`orderId`) instead. An offer is ordered once |
| `order_exists` (409) | This stay already has an order (`orderId`, `status`): show it instead of ordering again. This also blocks ordering the same offer, dates and rooms again for another party, ordering a stay again after it was cancelled, ordering while the user's own website checkout for the stay is open (up to 3 hours 45 minutes) and ordering again a stay whose earlier order failed at the hotel. For those, the user emails info@fortrip.ai |
| `order_attempts_exhausted` (409) | This order can't be tried again: the user emails info@fortrip.ai with its `reference` |
| `order_removed` (410) | The order was never completed and no payment is held: get offers again and order the new offer (the order keeps its `orderId`) |
| `stay_unsupported` (422) | `mixed_occupancy`: order once per party; `max_nights`: at most `max` nights per order |
| `stay_in_past` (422) | Check-in has passed in the hotel's time zone: ask for new dates |
| `ordering_paused` (503) | Ordering is paused on Fortrip's side: tell the user, and try again only after `retryAfterSeconds` (10 minutes or more) |

Any code:

- `invalid_request` (400): `details.issues` lists each bad field; fix them. For amenities, `details.filterable` lists those that can filter.
- `cursor_invalid` (400): the page is gone; search again from the first page.
- `not_found` (404): no such hotel, or no such order for this user.
- `rate_limited` (429): wait `retryAfterSeconds`, then retry once.
- `service_unavailable` (503) and `supplier_unavailable` (503 or 504): wait `retryAfterSeconds`, then retry once with the same details; if it fails again, tell the user.
- Any other code: read `message`. If `retryable` is true, wait `retryAfterSeconds` and retry once; otherwise tell the user instead of guessing.

## Changes and support

The CLI can't change or cancel an order: for changes, cancellations, refunds or other problems, the user emails info@fortrip.ai with the order's `reference` (never `payment.url`).
