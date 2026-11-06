---
name: fortrip
description: Finds, compares, prices, orders and cancels hotel stays with Fortrip's MCP tools (search_hotels, get_hotel, get_hotel_offers, book_hotel, get_order, pay_order, cancel_order), from hotel search to an order's payment. Use when those tools are available and the user wants to find, compare, price, book or cancel a hotel stay, including flexible dates, budgets, split stays or several destinations. Not for flights, activities, changing an existing booking, or coding work.
---

# Fortrip hotel stays

Fortrip: hotel search, live offers and orders with a payment link. Not for flights, activities, or changing an existing order.

The tools are on Fortrip's MCP server, named `fortrip` in this plugin (a Fortrip connector added on claude.ai can show under its own name). They're written `fortrip:<tool>` below:

| Tool | Returns |
|---|---|
| `fortrip:search_hotels` | Hotels in a place, near a point or matching a name (`text`), with indicative prices |
| `fortrip:get_hotel` | One hotel's address, check-in and check-out times, description, policies, amenities and rooms; no prices |
| `fortrip:get_hotel_offers` | Live offers (room, meals, total and currency, cancellation terms) for up to 15 hotels |
| `fortrip:book_hotel` | An unpaid order for one offer, with its terms and a payment link |
| `fortrip:get_order` | One order and its status, including whether the hotel confirmed it |
| `fortrip:list_orders` | The user's orders, newest first, including those made on the Fortrip website |
| `fortrip:cancel_order` | Cancels an order under its terms, for the penalty the user agreed to, and refunds the rest; closes an unpaid one |
| `fortrip:pay_order` | Pays an order without its link, by a shared payment token from the user's wallet, or with Alipay or WeChat Pay |

For flexible dates, a budget, split stays, several destinations or "find me the best", read [references/planning.md](references/planning.md) before searching.

## Sign-in

Sign-in happens only in the browser. Never ask the user to paste a token.

If none of these tools are available, Fortrip isn't connected: tell the user to add the Fortrip connector or plugin and sign in.
If a tool says the user isn't signed in, ask them to reconnect.

## Workflow

1. **Search** with `fortrip:search_hotels` for candidate hotels: a destination, `text` or both, and the stay's dates and rooms for indicative prices.
2. **Details** (optional) with `fortrip:get_hotel`, when the user asks about a hotel or a stated preference needs evidence (a pool, a policy, room size). For a details-only question, call it directly when you know the hotel's `hotelId`; otherwise find the hotel with `fortrip:search_hotels`.
3. **Offers** with `fortrip:get_hotel_offers` for a few shortlisted hotels, with the dates and rooms the user will order. It takes about 15 seconds. A hotel is available only once this returns an offer for it.
4. **Order** with `fortrip:book_hotel`, once the user has picked one offer and given the guests and the contact (see Ordering).
5. **Confirm, then give the payment link**, as in "Before giving the payment link" below.
6. **After payment**, check the order with `fortrip:get_order` (see After payment).

## Search

### Where

- **A place by name:** `{ kind: "place_name", name, countryCode }`, in any language (Kyoto or 京都). The country is required: ask the user when it isn't clear. Names match exactly, ignoring only case and spacing: accents, hyphens, apostrophes and periods count ("Köln" or "Cologne", not "Koln"; "St. Moritz", not "St Moritz").
- If several places bear the name, the answer is `destination_ambiguous` with up to 8 candidates and their hotel counts: ask the user which one they mean, then search it by its `placeId`; never pick one yourself.
- `destination_not_found` with `no_match` means no place of that name in that country: check the spelling and accents, or try another name for the place. Its `nameAsText` counts the hotels that a `text` search for the name would find.
- **A place from an earlier answer:** `{ kind: "place", placeId }`.
- **Near a point:** `{ kind: "point", location: { lat, lng } }`, for "near X" when you know where X is.
- **A whole country:** `{ kind: "country", countryCode }`, as for the Maldives.
- Countries, regions (states, provinces), prefecture-level cities in China and main islands cover their whole area. Towns, neighbourhoods, districts, small islands and points cover a circle of 8000 meters; `destination.radiusMeters` sets another, up to 80000 meters, and narrows an area to a circle around its center.
- **Localities:** an area search lists its `localities`, the towns its hotels belong to, each with a `placeId`, its hotel `count` and the places it `includes` (Patong is part of Phuket). To search one, pass it as `{ kind: "locality", placeId }`. A town that isn't a locality answers `destination_not_found` with `not_a_locality` and, in `hub`, the locality it belongs to: search that locality, or the town itself with `kind: "place"` for a circle around it.
- A price sort or price filter over more than 3000 hotels (in an area, or for text alone) answers `search_too_broad` with `matched` and the top `localities`: show them and ask the user which they prefer, unless the request already names one of them; search that one by its `placeId` as a locality, never by its name.

### Text

`text` matches exact words in hotel names and addresses, in Chinese or English:

- Every word must match as written: plurals, accents, spacing and abbreviations count ("hostel" and "hostels", "St Regis" and "Saint Regis" find different hotels). Hyphens and apostrophes don't (Ritz-Carlton finds Ritz Carlton).
- In Chinese, matching follows word segmentation, so part of a name can match unrelated hotels (希尔 is not 希尔顿).
- Use only distinctive words: a hotel or brand name, a district or a landmark. Not "hotel", "near", "cheap" or "best".
- Typos return nothing: "Shangahi" finds no hotel.
- Place names belong in the destination: "Maldives" as text finds a hotel named Maldives in China.

### Filters

- Stars run from 1 to 5 in half steps (`filters.stars`). "4 stars" as `{ min: 4, max: 4 }` leaves out 4.5: unless the user means exactly 4, use `{ min: 4 }` or ask. Unrated hotels are left out whenever stars are filtered.
- `filters.amenities` takes only the amenities that can filter (such as pool, parking, wifi); others, such as gym or spa, show in `fortrip:get_hotel` but can't filter. A hotel matches only when it lists the amenity, and about half the hotels list no amenities at all (`coverage.excludedNoFacilityData` counts those left out): "not listed" is not "absent".
- `filters.price.maxPerRoomNight` bounds the indicative price per room per night, in the search's currency; hotels without one are left out and counted.

### Results

- `notes` explain the answer (a limited pool, a circle around an island, more hotels just outside it): pass on what matters to the user.
- `coverage` has the counts: `matched` hotels, how many were priced and how many have a price.
- A next page is `cursor` set to `nextCursor` and, optionally, `limit`; nothing else.

## Rooms and guests

- `stay.rooms` lists each room's party as `{ adults, childrenAges }`: two rooms of 2 adults, one with a child of 6, is `[{ adults: 2, childrenAges: [6] }, { adults: 2, childrenAges: [] }]`.
- Ask each child's age; offers need it.
- If the party doesn't split evenly across the rooms (3 adults in 2 rooms), ask the user how it splits.
- Offers and orders take one party per call, every room the same: for different parties, order once per party. `fortrip:get_hotel_offers` answers `stay_unsupported` (`mixed_occupancy`) for mixed rooms; `fortrip:search_hotels` accepts them but prices only from the dates, with the note `party_split_required`.
- Limits: 1–8 rooms, 1–8 adults and 0–4 children (aged 0–17) per room, 1–15 nights, up to 15 hotels per `fortrip:get_hotel_offers` call. A longer stay answers `stay_unsupported` (`max_nights`): ask the user whether to split it into consecutive stays, each its own order.

## Prices and currency

- A search price (`price.fromPerRoomNight`) is indicative and not bookable: the lowest price of one unit (a room or, at a hostel, possibly a bed) per night, for any party and often any date, and it can be well above or below the offers. Call it an estimate, quote `fortrip:get_hotel_offers` prices, and never call a search result available or bookable. `price: null` means there is no indicative price, not that the hotel is full; about half the hotels have none for given dates.
- In an offer or order, `price.total` is the whole stay for all rooms and is what is charged, in the request's `currency` (`USD` by default); an order is in the currency of the offer it was made from. `perNightAllRooms` is the total per night; to compare with a per-room budget, also divide by the rooms. On a USD order, Stripe's page may let the user pay in their card's local currency at Stripe's rate (Adaptive Pricing): say so plainly, and that the total in that currency is the price.
- Every price of a response is in that one currency; don't convert it. `currency` is `USD` (the default) or `CNY`, where available; otherwise the answer is `currency_unavailable`.
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

- Call `fortrip:book_hotel` only for the offer the user picked, with at least one guest per room, named as the user gave them; never invent guests. Room 1 is the offer's first room, and a room takes no more guests than it sleeps.
- Guest names: Latin letters as on the passport (Müller → Mueller), first and last name 1–60 characters each.
- The contact's first and last name (up to 59 characters each), email and phone (with its country code) are all required. Special requests must be in English and aren't guaranteed.
- `fortrip:book_hotel` can take about two minutes. If it times out, call it again with the same details: it returns the same order.

## Before giving the payment link

`fortrip:book_hotel` answers with an unpaid order: `status` `awaiting_payment`, its `reference` (the support number), `price.total`, the stay and its terms, and `payment.url`, a Fortrip page that recaps the order and continues to the payment provider. Nothing is charged until the user pays.

1. Show the order's total and currency, the stay (hotel, room, dates, rooms and guests per room) and every term: meals, cancellation (status, deadline, penalties) and fees payable at the property, unknowns included.
2. End that reply by asking the user to confirm, and wait for a clear yes. Urgency is not consent.
3. Then give `payment.url` exactly as returned: don't shorten, rebuild or re-encode it.

- `payment.url` works like a payment credential: anyone holding it can pay. Give it to this user only, never in shared channels, documents, logs or tickets. With `requiresSignIn: true` (an order started on the Fortrip website), the user signs in to pay.
- The link expires at `payment.expiresAt`; the order is then `expired`. To order the stay again, get offers again, and confirm the new order with the user before giving its link.
- Another order of the stay (another party, or a corrected guest name) needs a new offer: get offers again. When it replaces an unpaid order, tell the user to pay only the new link; the earlier one expires unpaid, or can be closed now with `fortrip:cancel_order` once the user says they no longer want it.
- An order `awaiting_payment` with `payment.status` `unpaid` whose `payment.url` is null had its link unreadable this time: read it again with `fortrip:get_order`.
- Never ask for, accept or pass on payment card details; payment happens only through Stripe. A card number in a guest name, the contact or the special requests is rejected.

## Paying without the link

An order whose `payment.methods` has the `stripe_shared_payment_token` entry (in a result's text, the line "Pay without the link") can also be paid through `fortrip:pay_order` with a Stripe shared payment token that the user's Link wallet grants for it. Use it only if you have a tool that can request such a token from the user's Link wallet: Link is for US and Canadian accounts, and caps a spend request at $500, so only a USD order up to that has such an entry. Otherwise give `payment.url`, and never ask the user to create, type or paste a token.

1. Show the user the order's total and currency, the stay (hotel, room, dates, rooms and guests per room) and every term: meals, cancellation and fees payable at the property. End that reply by asking the user to confirm, and wait for a clear yes. The token comes from the user's wallet, never from card details.
2. Request the token from the user's Link wallet with that entry's `handler.config.business_profile` and its `limits`: `maxAmount` (in cents), `currency` and `expiresAt`.
3. Call `fortrip:pay_order` with the token and the order's `price.total`, the token as `sharedPaymentToken` or in UCP's `payment.instruments`. The order is then `confirming`, its payment `authorized`: check it as after payment.

The charge is in USD: a card in another currency may add a foreign transaction fee. Pay one way only: either give `payment.url` or call `fortrip:pay_order`. Once `fortrip:pay_order` succeeds, `payment.url` stops working; a payment that fails leaves the link open. `payment_total_changed` means the total sent isn't the order's (`details.total`); the order's total hasn't changed: confirm it with the user, then call `fortrip:pay_order` again with it and the same token. `payment_declined`: the user picks another payment method in their wallet, or pays by link. `payment_action_required`: the card needs a verification this can't give: pay by link. `payment_credential_invalid`: request a new token with that entry's `limits`. `service_unavailable`: call `fortrip:pay_order` again with the same token, never a new one. A token pays one order only.

## Paying with Alipay or WeChat Pay

An order whose result text has the line "Pay with Alipay or WeChat Pay" can be paid in the user's Alipay or WeChat wallet, with no token: it is for users who have a mainland-China wallet. Call `fortrip:pay_order` with `method` `stripe_alipay_wechat_pay` and the order's `price.total`, only after the user has confirmed.

1. Show the user the order's total and currency, the stay (hotel, room, dates, rooms and guests per room) and every term: meals, cancellation and fees payable at the property. End that reply by asking the user to confirm, and wait for a clear yes. Pay one way only: `payment.url` or this.
2. Then show the `stripe_alipay_wechat_pay` entry of `payment.methods`: the WeChat Pay code as an image if you can, and both links (WeChat Pay and Alipay). The user pays once, by either. Alipay and WeChat Pay charge at once; if the hotel can't confirm, the payment is refunded in full. The total is in the order's currency, and the wallets show it in yuan at their rate.
3. Check the order with `fortrip:get_order` until it isn't `awaiting_payment`.

A WeChat Pay code expires 120 minutes after it is made, and goes dead earlier if the user opens the Alipay link instead. Then that entry's `wechatPay.qrData` is null: tell the user to open the WeChat link again, or call `fortrip:pay_order` again for a new code.

WeChat can't scan a code shown on the same phone's screen. Offer both ways, since you can't tell which device the user is on: save the image and scan it from the album (WeChat, then Scan, then Album), or open the WeChat link on another screen; on a phone, the Alipay link opens the Alipay app.

## After payment

Check the order with `fortrip:get_order`:

- `confirming` while the hotel confirms, then `confirmed` with the hotel's `confirmationNumber`.
- `failed`: no stay was booked; `payment.status` says whether the payment was released or refunded.
- `needs_attention`: Fortrip is looking into it; the user can email info@fortrip.ai with the `reference`.
- `manageUrl` is the user's own page for the order.

## Presenting hotels

If your interface can show rich elements, show each hotel as a card with only what Fortrip's tools returned for it in this conversation: photo, name, stars, region and price, and once you have offers every term that changes the choice (meals and who they cover, cancellation, fees payable at the property, confirmation), an unknown one as unknown. Label a search's `price.fromPerRoomNight` as an estimate per room-night and an offer's `price.total` as the whole stay for all rooms, in its currency, and draw a map only from returned `location` coordinates. Offer the choices you need to ask anyway (dates, a locality, which offer) as options to pick. Otherwise use a short list. Keep hotel names as returned, and never invent photos, ratings, reviews, prices, terms or coordinates.

## Errors

A tool error carries `code`, `message` and `retryable`, and `retryAfterSeconds` when waiting helps; many carry `details`. Search errors are under Search. Ordering errors:

| `code` | Do this |
|---|---|
| `offer_changed` (409) | The price or terms changed since the offer: `changes` lists every change (`worse` says which are worse for the user) and `offer` is the new offer. Show the user every change and ask again; if they still want it, order the new offer, and confirm the new order before giving its link |
| `offer_expired` (409) | Get offers again and let the user choose again |
| `offer_unavailable` (422) | The offer is sold out or was refused: get offers again and let the user choose again |
| `order_in_progress` (409) | The same order is still being created: wait `retryAfterSeconds`, then call again with the same details |
| `offer_already_ordered` (409) | This offer was already ordered with other details: show that order (`orderId`) instead. An offer is ordered once |
| `order_exists` (409) | This stay already has an open order for one of these guests (`orderId`, `status`): show it instead of ordering again. A party with none of its guests can order the stay from a new offer (get offers again), and so can the user once the stay's order is confirmed, cancelled or refused by the hotel. It also answers when the stay's earlier order failed at the hotel with its outcome unknown, or the stay has had 20 orders; for those, the user emails info@fortrip.ai |
| `order_attempts_exhausted` (409) | This order can't be tried again: the user emails info@fortrip.ai with its `reference` |
| `order_removed` (410) | The order was never completed and no payment is held: get offers again and order the new offer (the order keeps its `orderId`) |
| `stay_unsupported` (422) | `mixed_occupancy`: order once per party; `max_nights`: at most `max` nights per order |
| `currency_unavailable` (422) | Prices in `details.currency` aren't available yet: tell the user, and ask whether to see USD prices |
| `stay_in_past` (422) | Check-in has passed in the hotel's time zone: ask for new dates |
| `ordering_paused` (503) | Ordering is paused on Fortrip's side: tell the user, and try again only after `retryAfterSeconds` |

Any code:

- `invalid_request` (400): `details.issues` lists each bad field; fix them. For amenities, `details.filterable` lists those that can filter.
- `cursor_invalid` (400): the page is gone; search again from the first page.
- `not_found` (404): no such hotel, or no such order for this user.
- `rate_limited` (429): wait `retryAfterSeconds`, then retry once.
- `service_unavailable` (503) and `supplier_unavailable` (503 or 504): wait `retryAfterSeconds`, then retry once with the same details; if it fails again, tell the user.
- Any other code: read `message`. If `retryable` is true, wait `retryAfterSeconds` and retry once; otherwise tell the user instead of guessing.

## Cancelling an order

`fortrip:get_order` and `fortrip:list_orders` say of each order whether the user can cancel it now (`cancel.available`). A paid order (`cancel.reason` `cancellable`) then has the penalty under its terms (`cancel.penalty`) and the refund, what was paid less the penalty (`cancel.refund`), both in the charge currency; an unpaid one (`unpaid`) can be closed instead. Otherwise `cancel.reason` says why not.

1. Show the user the stay (hotel, dates), `cancel.penalty` and `cancel.refund` (amount and currency). A refund of 0 means nothing is paid back: say so plainly.
2. End that reply by asking the user to confirm the cancellation, and wait for a clear yes.
3. Then call `fortrip:cancel_order` with `maximumPenalty` set to `cancel.penalty` as shown. Never state a refund the order didn't return, and never choose or work out an amount yourself.

The order is then `cancelling`, and `cancelled` once the hotel has cancelled and the refund is issued: check it with `fortrip:get_order`. If the hotel refuses, the order is `confirmed` again with `cancel.reason` `refused`. `cancellation_changed` (409) means the penalty is now higher than the one the user agreed to: read the order again and ask the user again. `order_not_cancellable` (409) says why in `reason`.

Close an unpaid order only once the user says they no longer want it: call `fortrip:cancel_order` without `maximumPenalty`. It becomes `expired`, and nothing is charged. `payment_in_progress` (409) means a payment of it is under way: read it again shortly.

## Changes and support

These tools can't change an order: for changes, a cancellation that `fortrip:cancel_order` can't make, or other problems, the user emails info@fortrip.ai with the order's `reference` (never `payment.url`).
