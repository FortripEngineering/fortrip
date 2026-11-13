---
name: fortrip
description: Finds, compares, prices, orders and cancels hotel stays with Fortrip's MCP tools (search_hotels, get_hotel, get_hotel_offers, create_order, get_order, list_orders, pay_order, cancel_order), from hotel search to an order's payment. Use when those tools are available and the user wants to find, compare, price, book or cancel a hotel stay, including flexible dates, budgets, split stays or several destinations. Not for flights, activities, changing an existing booking, or coding work.
---

# Fortrip hotel stays

Fortrip: hotel search, live offers and orders with a payment link. Not for flights, activities, or changing an existing order.

The tools are on Fortrip's MCP server, named `fortrip` in this plugin (a Fortrip connector added on claude.ai can show under its own name). They're written `fortrip:<tool>` below. Each answers in text, and the rules below name what that text shows:

| Tool | Returns |
|---|---|
| `fortrip:search_hotels` | Hotels in a place, near a point or matching a name (`text`), with indicative prices |
| `fortrip:get_hotel` | One hotel's address, check-in and check-out times, description, policies, amenities and room types; no prices |
| `fortrip:get_hotel_offers` | Live offers (room type, meals, total and currency, cancellation terms) for up to 15 hotels |
| `fortrip:create_order` | An unpaid order for one offer, with its terms and a payment link |
| `fortrip:get_order` | One order and its status, including whether the hotel confirmed it |
| `fortrip:list_orders` | The user's orders, newest first, including those made on the Fortrip website |
| `fortrip:cancel_order` | Cancels a paid order under its terms, for the penalty the user agreed to, and refunds the rest; closes an unpaid one |
| `fortrip:pay_order` | Pays an order without its link, by a shared payment token from the user's wallet |

For flexible dates, a budget, split stays, several destinations or "find me the best", read [references/planning.md](references/planning.md) before searching.

## Sign-in

Sign-in happens only in the browser. Never ask the user to paste a token.

If none of these tools are available, Fortrip isn't connected: tell the user to add the Fortrip connector or plugin and sign in.
If a tool says the user isn't signed in, ask them to reconnect.

## Workflow

1. **Search** with `fortrip:search_hotels` for candidate hotels: a destination, `text` or both, and the stay's dates and rooms for indicative prices.
2. **Details** (optional) with `fortrip:get_hotel`, when the user asks about a hotel or a stated preference needs evidence (a pool, a policy, room size). For a details-only question, call it directly when you know the hotel's `hotelId`; otherwise find the hotel with `fortrip:search_hotels`.
3. **Offers** with `fortrip:get_hotel_offers` for a few shortlisted hotels, with the dates and rooms the user will order. It takes about 15 seconds. A hotel is available only once this returns an offer for it.
4. **Order** with `fortrip:create_order`, once the user has picked one offer and given the guests and the contact (see Ordering).
5. **Confirm, then give the payment link**, as in "Before giving the payment link" below.
6. **After payment**, check the order with `fortrip:get_order` (see After payment).

## Search

### Where

- **A place by name:** `{ kind: "place_name", name, countryCode }`, in any language (Kyoto or 京都). The country is required: ask the user when it isn't clear. Names match exactly, ignoring only case and spacing: accents, hyphens, apostrophes and periods count ("Köln" or "Cologne", not "Koln"; "St. Moritz", not "St Moritz").
- If several places bear the name, the answer is `destination_ambiguous` with up to 8 candidates and their hotel counts: ask the user which one they mean, then search that place by its id; never pick one yourself.
- `destination_not_found` for a name means no place of that name in that country: check the spelling and accents, or try another name for the place. The error also says how many hotels a `text` search for the name would find.
- **A place from an earlier answer:** `{ kind: "place", placeId }`.
- **Near a point:** `{ kind: "point", location: { lat, lng } }`, for "near X" when you know where X is.
- **A whole country:** `{ kind: "country", countryCode }`, as for the Maldives.
- Countries, regions (states, provinces), prefecture-level cities in China and main islands cover their whole area. Towns, neighbourhoods, districts, small islands and points cover a circle of 8000 meters; `destination.radiusMeters` sets another, up to 80000 meters, and narrows an area to a circle around its center.
- **Localities:** an area search lists its localities, the towns its hotels belong to, each with its id, its matching hotels and the places inside it (Patong is part of Phuket). To search one, pass it as `{ kind: "locality", placeId }`. A town that isn't a locality answers `destination_not_found`, which names the locality its hotels belong to: search that locality, or the town itself with `kind: "place"` for a circle around it.
- A price sort or price filter over more than 3000 hotels (in an area, or for text alone) answers `search_too_broad` with how many hotels match and the top localities: show them and ask the user which they prefer, unless the request already names one of them; search that one by its id as a locality, never by its name.

### Text

`text` matches exact words in hotel names and addresses, in Chinese or English:

- Every word must match as written (a typo such as "Shangahi" finds nothing): plurals, accents, spacing and abbreviations count ("hostel" and "hostels", "St Regis" and "Saint Regis" find different hotels). Hyphens and apostrophes don't (Ritz-Carlton finds Ritz Carlton).
- In Chinese, matching follows word segmentation, so part of a name can match unrelated hotels (希尔 is not 希尔顿).
- Use only distinctive words: a hotel or brand name, a district or a landmark. Not "hotel", "near", "cheap" or "best".
- Place names belong in the destination: "Maldives" as text finds a hotel named Maldives in China.

### Filters

- Stars run from 1 to 5 in half steps (`filters.stars`). "4 stars" as `{ min: 4, max: 4 }` leaves out 4.5: unless the user means exactly 4, use `{ min: 4 }` or ask. Unrated hotels are left out whenever stars are filtered.
- `filters.amenities` takes only the amenities that can filter (such as pool, parking, wifi); others, such as gym or spa, show in `fortrip:get_hotel` but can't filter. A hotel matches only when it lists the amenity, and about half the hotels list no amenities at all (the Counts line says how many were left out for it): "not listed" is not "absent".
- `filters.price.maxPerRoomNight` bounds the indicative price per room per night, in the search's currency; hotels without one are left out and counted.

### Results

- The Notes explain the answer (a limited pool, a circle around an island, more hotels just outside it): pass on what matters to the user.
- The Counts line has how many hotels matched, how many were priced and how many have a price.
- A next page is `cursor`, set to the cursor the answer's last lines give, and, optionally, `limit`; nothing else.

## Rooms and guests

- `stay.rooms` lists each room's party as `{ adults, childrenAges }`: two rooms of 2 adults, one with a child of 6, is `[{ adults: 2, childrenAges: [6] }, { adults: 2, childrenAges: [] }]`.
- Ask each child's age; offers need it.
- If the party doesn't split evenly across the rooms (3 adults in 2 rooms), ask the user how it splits.
- Offers and orders take one party per call, every room the same: for different parties, order once per party. `fortrip:get_hotel_offers` answers `stay_unsupported` for mixed rooms; `fortrip:search_hotels` accepts them but prices only from the dates, with the note `party_split_required`.
- Limits: 1–8 rooms, 1–8 adults and 0–4 children (aged 0–17) per room, 1–15 nights, up to 15 hotels per `fortrip:get_hotel_offers` call. A longer stay also answers `stay_unsupported`: ask the user whether to split it into consecutive stays, each its own order.

## Prices and currency

- A search price (shown as "estimate from … /room-night") is indicative and not bookable: the lowest price of one unit (a room or, at a hostel, possibly a bed) per night, for any party and often any date, and it can be well above or below the offers. Call it an estimate, quote `fortrip:get_hotel_offers` prices, and never call a search result available or bookable. A hotel with "no indicative price" isn't full; about half the hotels have none for given dates.
- In an offer or order, the total is the whole stay for all rooms and is what is charged, in the request's `currency` (`USD` by default); an order is in the currency of the offer it was made from. An offer's "average per room-night" is its total divided by the rooms and the nights, for comparison only. On a USD order, Stripe's page may let the user pay in their card's local currency at Stripe's rate (Adaptive Pricing): say so plainly, and that the total in that currency is the price.
- Every price of an answer is in that one currency; don't convert it. `currency` is `USD` (the default) or `CNY`.
- Each currency is paid through its own channel, with its own payment methods; the order's payment page shows them. CNY is paid through payment channels in mainland China and suits a user who pays that way.
- A search not in CNY may end with a "Currency:" line when the request or the user's latest sign-in comes from mainland China: offer CNY prices if the user may pay that way, and then use CNY for both the search and the offers.
- Fees payable at the property ("fees not in the total") are separate, in the property's own currency, not converted.
- After payment, "card charged" on the order's Total line is what the card paid in its own currency. An order made on the Fortrip website can be in another currency: its Total says which.

## Presenting an offer

Give the user, for each offer, what its line shows:

- the room type (name, beds, size) and the total, as above;
- the meals: breakfast, lunch, dinner or all inclusive, and how many guests per room they cover. Fewer than the guests in the room means not everyone gets the meals (breakfast for 1 with 2 adults in the room): say who is covered. "More main meals (not named)" counts main meals the hotel didn't name. "Meals not stated" means the meals are unknown: say so, and don't call it room only;
- cancellation: free until a time, a partial penalty now, non-refundable or unknown, with each penalty and when it starts. Times are in UTC, then in the hotel's time zone: give the user the hotel's;
- confirmation: instant, or on request (within the minutes shown);
- fees payable at the property ("fees not in the total"), in the property's currency. "Fees not fully disclosed" means there can be fees not listed: say so.

An offer expires at the time its line gives, about 30 minutes after it was made; after that, get offers again.

"Not listed" is not "no": "not listed", "not stated" and "unknown" mean the source didn't say. Tell the user it's unknown instead of turning it into "no".

## Ordering

- Call `fortrip:create_order` only for the offer the user picked, with at least one guest per room, named as the user gave them; never invent guests. Room 1 is the offer's first room, and a room takes no more guests than it sleeps.
- The offer's `offerId` goes inside the one item of `items`, and nowhere else in the arguments.
- Guest names: Latin letters as on the passport (Müller → Mueller), first and last name 1–60 characters each.
- The contact's name (up to 119 characters), email and phone (with its country code) are all required. Special requests must be in English and aren't guaranteed.
- `fortrip:create_order` can take about two minutes. If it times out, call it again with the same details: it returns the same order.

## Before giving the payment link

`fortrip:create_order` answers with an unpaid order, awaiting payment: its reference (the support number), the Total, the stay and its terms, and the Payment link, a Fortrip page that recaps the order and continues to the payment provider. Nothing is charged until the user pays.

1. Show the order's total and currency, the stay (hotel, room, dates, and each room's party and guest names), the contact (name, email, phone), any special requests and every term: meals, cancellation (status, deadline, penalties) and fees payable at the property, unknowns included. Show the names and contact as the order holds them, so the user can catch a wrong one before paying; to correct one, order a new offer (see below).
2. End that reply by asking the user to confirm, and wait for a clear yes. Urgency is not consent.
3. Then pay one way only: give the payment link exactly as shown (don't shorten, rebuild or re-encode it), or pay without the link as below.

- The payment link works like a payment credential: anyone holding it can pay. Give it to this user only, never in shared channels, documents, logs or tickets. When its line says the user signs in to Fortrip to pay (an order started on the Fortrip website), they sign in first.
- The link expires at the time its line gives; the order then reads as not paid, and can no longer be paid. To order the stay again, get offers again, and confirm the new order with the user before giving its link.
- Another order of the stay (another party, or a corrected guest name or contact) needs a new offer: get offers again. When it replaces an unpaid order, tell the user to pay only the new link; the earlier one expires unpaid, or can be closed now with `fortrip:cancel_order` and `close: true` once the user says they no longer want it.
- An order awaiting payment whose Payment link line says there is none has a payment being processed: read it again shortly with `fortrip:get_order`, and don't give an earlier link.
- Never ask for, accept or pass on payment card details; payment happens only on the payment link or, by token, through `fortrip:pay_order`. A card number in a guest name, the contact or the special requests is rejected.

## Paying without the link

An order whose text has a "Pay without the link" line can also be paid through `fortrip:pay_order` with a Stripe shared payment token that the user's Link wallet grants for it. Use it only if you have a tool that can request such a token from the user's Link wallet: Link is for US and Canadian accounts, and caps a spend request at $500, so only a USD order up to that has such a line. Otherwise give the payment link, and never ask the user to create, type or paste a token.

1. Confirm the order with the user as before giving the payment link: its total and currency, the stay with each room's guests, the contact, any special requests and every term, and a clear yes. The token comes from the user's wallet, never from card details.
2. Request the token from the user's Link wallet with the `business_profile` and the usage limits on that line: `max_amount` (in cents), `currency` and `expires_at`.
3. Call `fortrip:pay_order` with the token and the order's total (`sharedPaymentToken`, `total`). The order is then confirming with the hotel, its payment authorized: check it as after payment.

The charge is in USD: a card in another currency may add a foreign transaction fee. Once `fortrip:pay_order` succeeds, the payment link stops working; a payment that fails leaves the link open. `payment_total_mismatch` means the total sent isn't the order's, which the error gives; the order's total hasn't changed: confirm it with the user, then call `fortrip:pay_order` again with it and the same token. `payment_declined`: the user picks another card in their wallet, or pays by link. `payment_action_required`: the card needs a verification this can't give: pay by link. `payment_credential_invalid`: request a new token with the usage limits on that line. `service_unavailable`: call `fortrip:pay_order` again with the same token, never a new one. A token pays one order only.

## After payment

Check the order with `fortrip:get_order`; its first line has the status:

- confirming with the hotel, then confirmed, with the hotel confirmation number.
- failed: no stay was booked. "Why it failed" says why and what to do next, and the Total line whether the payment was released or refunded.
- needs attention from Fortrip: Fortrip is looking into it; the user can email info@fortrip.ai with the order's reference.
- The Manage link is the user's own page for the order.

## Presenting hotels

If your interface can show rich elements, show each hotel as a card with only what Fortrip's tools returned for it in this conversation: photo, name, stars, region and price, and once you have offers every term that changes the choice (meals and who they cover, cancellation, fees payable at the property, confirmation), an unknown one as unknown. Label a search's "estimate from" price as an estimate per room-night and an offer's total as the whole stay for all rooms, in its currency, and draw a map only from coordinates the text shows. Offer the choices you need to ask anyway (dates, a locality, which offer) as options to pick. Otherwise use a short list. Keep hotel names as returned, and never invent photos, ratings, reviews, prices, terms or coordinates.

## Errors

A tool error starts with "Error" and its code, then says what happened, whether a retry can help and after how many seconds, and what to do next. Search errors are under Search. Ordering errors:

| Code | Do this |
|---|---|
| `offer_changed` | The price or terms changed since the offer: the error lists every change (marking those worse for the user) and the new offer. Show the user every change and ask again; if they still want it, order the new offer |
| `offer_expired` | Get offers again and let the user choose again |
| `offer_unavailable` | The offer is sold out or was refused, and other offers for the same room may be gone too: get offers again and let the user choose again |
| `order_in_progress` | The order is still being created, or still being confirmed when cancelling it: wait as long as the error says, then call again with the same details |
| `offer_already_ordered` | This offer was already ordered with other details: show the order the error names instead. An offer is ordered once, even when its order failed or expired: to order with other details, get offers again |
| `stay_unsupported` | Rooms for different parties: order once per party. Too many nights: the error says the most one order takes |
| `currency_unavailable` | Prices in that currency aren't available yet: tell the user, and ask whether to see USD prices |
| `stay_in_past` | Check-in has passed in the hotel's time zone: ask for new dates |
| `ordering_paused` | Ordering is paused on Fortrip's side: tell the user, and try again only after the wait the error gives |

Any code:

- `invalid_request`: the error lists each bad field and what is wrong with it; fix them.
- `cursor_invalid`: the page is gone; start again from the first page.
- `not_found`: no such hotel, or no such order for this user.
- `rate_limited`: wait as long as the error says, then retry once.
- `service_unavailable` and `supplier_unavailable`: wait as long as the error says, then retry once with the same details; if it fails again, tell the user.
- Any other code: read what the error says. If it is retryable, wait as long as it says and retry once; otherwise tell the user instead of guessing.

## Cancelling an order

`fortrip:get_order` and `fortrip:list_orders` say on each order's Cancel line what can be done to it now. A paid order that can be cancelled has the penalty under its terms and the refund, what was paid less the penalty, both in the order's currency; an unpaid one can be closed instead. Otherwise the line says what blocks both.

1. Show the user the stay (hotel, dates) and the penalty and the refund on the Cancel line (amount and currency). A refund of 0 means nothing is paid back: say so plainly.
2. End that reply by asking the user to confirm the cancellation, and wait for a clear yes.
3. Then call `fortrip:cancel_order` with `maximumPenalty` set to that penalty as shown. Never state a refund the order's text doesn't show, and never choose or work out an amount yourself.

The order is then cancelling, and cancelled once the hotel has cancelled and the refund is issued: check it with `fortrip:get_order`, which then says what the cancellation kept and returned. If the hotel refuses, the order is confirmed again and its Cancel line says so. `cancellation_changed` means the penalty is now higher than the one the user agreed to: read the order again and ask the user again. `order_not_cancellable` says which of cancelling and closing applies to the order now, or what blocks both; nothing is ever cancelled or closed by the other one.

Close an unpaid order only once the user says they no longer want it: call `fortrip:cancel_order` with `close: true`. It then reads as not paid, and nothing is charged. `payment_in_progress` means a payment of it is under way: read it again shortly.

## Changes and support

These tools can't change an order: for changes, a cancellation that `fortrip:cancel_order` can't make, or other problems, the user emails info@fortrip.ai with the order's reference (never its payment link).
