---
name: fortrip
description: Finds, compares, prices and books hotel stays with Fortrip's MCP tools (search_hotels, get_hotel, get_rates, create_booking), from hotel search to a booking payment link. Use when those tools are available and the user wants to find, compare, price or book a hotel stay, including flexible dates, budgets, split stays or several destinations. Not for flights, activities, changing or cancelling an existing booking, or coding work.
---

# Fortrip hotel stays

Fortrip: hotel search, live rates and booking payment links. Not for flights, activities, or changing or cancelling an existing booking.

The tools are on Fortrip's MCP server, named `fortrip` in this plugin (a Fortrip connector added on claude.ai can show under its own name). They're written `fortrip:<tool>` below:

| Tool | Returns |
|---|---|
| `fortrip:search_hotels` | Hotels by name, brand or city (`query`), `cityCode`, or a point and radius (`near`), with indicative prices |
| `fortrip:get_hotel` | One hotel's address, check-in and check-out times, policies, facilities and photos; no prices |
| `fortrip:get_rates` | Live rooms, meal plans, cancellation terms and prices for up to 15 hotels |
| `fortrip:create_booking` | An unpaid booking for one rate, with its terms and a payment link |

For flexible dates, a budget, split stays, several destinations or "find me the best", read [references/planning.md](references/planning.md) before searching.

## Sign-in

Sign-in happens only in the browser. Never ask the user to paste a token.

If none of these tools are available, Fortrip isn't connected: tell the user to add the Fortrip connector or plugin and sign in.
If a tool says the user isn't signed in, ask them to reconnect Fortrip and sign in again.

## Workflow

1. **Search** with `fortrip:search_hotels` for candidate hotels and indicative prices. It needs `checkIn` and `checkOut`.
2. **Details** (optional) with `fortrip:get_hotel`, when the user asks about a hotel or a stated preference needs evidence (a pool, a policy, room size). For a details-only question, call it directly when you know the hotel's id; otherwise find the hotel with `fortrip:search_hotels` using the user's dates (ask for them if they gave none).
3. **Rates** with `fortrip:get_rates` for a few shortlisted hotels, using the dates and occupancy the user will book. It takes about 15 seconds. A hotel is available only once this returns a live option for it.
4. **Book** with `fortrip:create_booking`, once the user has picked one rate and given the guest details (see Booking).
5. **Confirm, then give the payment link**, as in "Before giving the payment link" below.

## Search

- Search prices come from a minimum-price feed, not live rates: quote `fortrip:get_rates` prices, and never call a search result available or bookable. When you show search prices, say they are indicative minimums, not quotes.
- A search that matches too many hotels fails with `matched` and `maxMatches`: narrow it (a city, an area, stars or a price range).
- Use `near` for "near X", and `cityCode` when you know the city's code.
- Facility names in `facilities` must match the catalogue exactly (`Swimming pool`, `Parking`); near-synonyms match nothing.

## Occupancy

- `fortrip:get_rates` and `fortrip:create_booking` both require `rooms` and `adults`. `adults` and `childrenAges` are **per room**, the same in every room: 2 rooms for 4 adults is `rooms: 2, adults: 2`.
- If the party doesn't divide evenly across the rooms (3 adults in 2 rooms), ask the user whether to price every room for the larger number or to price and book each occupancy as its own stay.
- Ask each child's age; `fortrip:get_rates` and `fortrip:create_booking` need it.
- Limits: 1–8 rooms, 1–8 adults and 0–8 children (aged 0–17) per room, 1–15 nights, up to 15 hotels per `fortrip:get_rates` call.

## Prices and currency

- In `fortrip:get_rates`, `totalPrice` is the whole stay for all rooms, and `dailyPrices` are per room per night. To compare with a per-night or per-room budget, divide the total by the nights and rooms, or use `dailyPrices`.
- Pass `currency` to `fortrip:search_hotels` and `fortrip:get_rates`: `CNY` (the default) or `USD`, to suit the user's language or location. Prices are converted at Stripe's exchange rate, or a fixed fallback rate when Stripe is unavailable; `fx` says which, and is `null` when nothing needed converting.
- `priceMin` and `priceMax` on `fortrip:search_hotels` bound the indicative nightly price, in that currency.
- The charge is the `amount` in the `currency` that `fortrip:create_booking` returns (currently USD). A converted price is a reference: never present it as the charge. Stripe's page may also show the charge in the user's local currency, at Stripe's rate. Fees paid at the hotel are separate, in their own currency.

## Presenting a rate

Give the user, for each option:

- the meal plan: `boardCode` (RO room only, BB breakfast, HB breakfast + dinner, FB breakfast + lunch + dinner, BL lunch, BD dinner, HBBL breakfast + lunch, HBLD lunch + dinner, AI all inclusive) with `boardCount`, how many guests per room the meal plan covers. Fewer than the adults per room means not everyone gets the meals (BB with `boardCount` 1 for 2 adults is breakfast for 1 of 2): say who is covered;
- cancellation: `refundable` and `freeCancelUntil`;
- confirmation: `isInstantConfirm`;
- any `fees`: taxes paid at the hotel, in their own currency.

## Booking

- Call `fortrip:create_booking` only for the rate the user picked, with exactly the hotel, `roomId`, `ratePlanCode`, dates, `rooms`, `adults` and `childrenAges` used in `fortrip:get_rates`.
- Guest names: Latin letters as on the passport (Müller → Mueller), first and last name 1–60 characters each. At least one guest per room, no more than the room sleeps.
- A contact name (up to 120 characters) and phone (3–40 characters) are required; an email is optional. Special requests must be in English and aren't guaranteed.
- One booking covers at most 15 nights; book a longer stay as separate bookings.
- The `nationality` given to `fortrip:get_rates` isn't sent with the booking: a rate restricted by nationality may change or be refused.
- `fortrip:create_booking` can take up to about two minutes. If it times out, call it again with the same details: it resumes the same order, with the same or a refreshed payment link.

## Before giving the payment link

`fortrip:create_booking` returns `paymentUrl`, `statusUrl`, `orderUrl`, `amount`, `currency`, `terms` and `stay`. Nothing is charged until the user pays.

1. Show the `stay` (hotel, room, dates, nights, rooms, adults and children's ages per room), the `amount` and `currency` to be charged, and every item in `terms`: meal plan (`boardCode` with `boardCount`), cancellation (`refundable`, `freeCancelUntil`, the `cancellation` ladder), confirmation (`isInstantConfirm`, `confirmByMins`) and `payAtHotelFees`.
2. End that reply by asking the user to confirm, and wait for a clear yes. Urgency is not consent.
3. Then give `paymentUrl` exactly as returned: don't shorten, rebuild or re-encode it. It opens a Fortrip page that recaps the booking and continues to payment on Stripe.

- If `amount` or `terms` is null, don't give the link: call `fortrip:create_booking` again with the same details, and if either is still null, tell the user to contact info@fortrip.ai.
- `paymentUrl` works like a payment credential: anyone holding it can pay. Give it to this user only, never in shared channels, documents, logs or tickets. It expires about 3 hours 45 minutes after it was created; for a fresh one, call `fortrip:create_booking` again with the same details.
- `statusUrl` is the same page: after payment it shows the booking's confirmation progress, without signing in. `orderUrl` is the user's signed-in order page.
- Never ask for, accept or pass on payment card details; payment happens only on the payment page. A card number in a guest name, the contact name or the special requests is rejected.

## Errors

A tool error carries `error` (what went wrong) and `status`, and most carry a `reason`:

| `reason` | Do this |
|---|---|
| `already_booked` (409) | This stay is already paid or completed: show `orderUrl` and don't book again |
| `price_or_terms_changed` (409) | The rate changed; `changes` says how. Show the user what changed and re-run `fortrip:get_rates`; if they still want it, call `fortrip:create_booking` again and confirm the new price and terms before giving the link |
| `rate_unavailable` (422) | The rate can no longer be booked: re-run `fortrip:get_rates` and let the user choose again |
| `supplier_unavailable` (503 or 504) | Wait `retryAfterSeconds` and retry once with the same details; if it fails again, tell the user |
| `refused` (422) | The booking was refused (a guest name, too many attempts, bookings paused): read `error` and explain it to the user |

Without a `reason`:

- **429**: wait `retryAfterSeconds`, then retry once.
- **503** with `retryable: true` is a brief failure on Fortrip's side (for example, the same booking started twice at once): wait `retryAfterSeconds`, then retry once with the same details.
- **500** and **502** are generic failures: read `error` and tell the user instead of guessing.

## Changes and support

These tools can't change or cancel a booking: for changes, cancellations, refunds or other problems with a booking, the user emails info@fortrip.ai with the booking's `orderUrl` (never `paymentUrl` or `statusUrl`).
