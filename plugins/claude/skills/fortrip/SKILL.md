---
name: fortrip
description: Finds, compares, prices and books hotel stays with Fortrip's MCP tools (search_hotels, get_hotel, get_rates, create_booking), from hotel search to a booking payment link. Use when those tools are available and the user wants to find, compare, price or book a hotel stay, including flexible dates, budgets, split stays or several destinations. Not for flights, activities, changing or cancelling an existing booking, or coding work.
---

# Fortrip hotel stays

The tools are on Fortrip's MCP server, named `fortrip` in this plugin (a Fortrip connector added on claude.ai can show under its own name). They're written `fortrip:<tool>` below:

| Tool | Returns |
|---|---|
| `fortrip:search_hotels` | Hotels by name, brand or city (`query`), `cityCode`, or a point and radius (`near`), with indicative prices |
| `fortrip:get_hotel` | One hotel's address, check-in and check-out times, policies, facilities and photos; no prices |
| `fortrip:get_rates` | Live rooms, meal plans, cancellation terms and prices for up to 15 hotels; takes about 15 seconds |
| `fortrip:create_booking` | An unpaid booking for one rate, with its terms and a payment link |

If none of these tools are available, Fortrip isn't connected: tell the user to add the Fortrip connector or plugin and sign in with their Fortrip account. If a tool reports that the user isn't signed in, ask them to reconnect Fortrip and sign in again. Never ask the user to paste a token.

For flexible dates, a budget, split stays, several destinations or "find me the best", read [references/planning.md](references/planning.md) before searching.

## Workflow

1. **Search** with `fortrip:search_hotels`, which needs `checkIn` and `checkOut`. Its prices are indicative minimums, not quotes: say so, and never call a search result available or bookable. Facility names must match the catalogue exactly (`Swimming pool`, `Parking`); near-synonyms match nothing.
2. **Details** (optional) with `fortrip:get_hotel`, when the user asks about a hotel or a preference needs evidence. For a details-only question, call it directly when you know the `hotelId`; otherwise find the hotel with `fortrip:search_hotels` using the user's dates (ask for them if they gave none).
3. **Rates** with `fortrip:get_rates` for a few shortlisted hotels, using the dates and occupancy the user will book. A hotel is available only once this returns a live option for it.
4. **Book**: once the user has picked one rate and given guest details, call `fortrip:create_booking` with exactly the hotel, `roomId`, `ratePlanCode`, dates, `rooms`, `adults` and `childrenAges` used in `fortrip:get_rates`.
5. **Confirm, then give the link**, as below.

## Before giving the payment link

`fortrip:create_booking` returns `paymentUrl`, `statusUrl`, `orderUrl`, `amount`, `currency`, `terms` and `stay`. Nothing is charged until the user pays.

1. Show the `stay` (hotel, room, dates, nights, rooms, adults and children's ages per room), the `amount` and `currency`, and every item in `terms`: meal plan (`boardCode`, `boardCount`), cancellation (`refundable`, `freeCancelUntil`, the `cancellation` ladder), confirmation (`isInstantConfirm`, `confirmByMins`) and `payAtHotelFees`.
2. End that reply by asking the user to confirm, and wait for a clear yes. Urgency is not consent.
3. Then give `paymentUrl` exactly as returned. It opens a Fortrip page that recaps the booking and continues to Stripe Checkout.

If `amount` or `terms` is null, don't give the link: call `fortrip:create_booking` again with the same details, and if either is still null, tell the user to contact info@fortrip.ai.

The link is for this user only: anyone holding it can pay. Don't put it in shared documents, tickets or other tools. It expires about 3 hours 45 minutes after it was created; for a fresh one, call `fortrip:create_booking` again with the same details.

## Rules

- **Occupancy is per room.** `adults` and `childrenAges` describe one room, and every room in a booking gets the same: 2 rooms for 4 adults is `rooms: 2, adults: 2`. If rooms need different occupancy, price and book each occupancy as its own stay. Ask each child's age. Limits: 1–8 rooms, 1–8 adults and 0–8 children per room, ages 0–17, 1–15 nights.
- **Rate prices.** In `fortrip:get_rates`, `totalPrice` covers the whole stay for all rooms, and `dailyPrices` are per room per night. To compare with a per-night or per-room budget, divide `totalPrice` by the nights and rooms, or use `dailyPrices`.
- **Display currency.** Pass `currency` to `fortrip:search_hotels` and `fortrip:get_rates`: `CNY` (the default) or `USD`, chosen from the user's language or location. `priceMin` and `priceMax` on `fortrip:search_hotels` bound the indicative nightly price, in that currency. Prices are converted at Stripe's exchange rate or a fixed fallback rate; `fx` says which.
- **The charge** is `amount` in `currency` from `fortrip:create_booking`, which can differ from the currency the rates were shown in. Never present a converted figure and the charge as the same price. Stripe's page may also show the charge in the user's local currency at Stripe's rate. Fees paid at the hotel are separate, in their own currency.
- **Meal plans** (`boardCode`): RO room only, BB breakfast, HB breakfast + dinner, FB breakfast + lunch + dinner, BL lunch, BD dinner, HBBL breakfast + lunch, HBLD lunch + dinner, AI all inclusive. `boardCount` is how many guests per room the meal plan covers; if a plan includes meals and `boardCount` is lower than the adults in a room, say so ("breakfast for 1 of 2 adults").
- **Guests**: names in Latin letters as on the passport (Müller → Mueller), at least one guest per room, plus a contact name and phone. Special requests must be in English and aren't guaranteed. The `nationality` passed to `fortrip:get_rates` isn't sent with the booking, so a rate restricted by nationality may change or be refused at booking.
- **Payment cards**: never ask for, accept or pass on card details. Payment happens only on the payment page.
- **Timing**: `fortrip:get_rates` takes about 15 seconds; `fortrip:create_booking` can take up to about a minute. If `fortrip:create_booking` times out, call it again with the same details: it resumes the same order.
- **Existing bookings**: these tools can't change or cancel a booking. For changes, cancellations or refunds, the user emails info@fortrip.ai with the `orderUrl` (never `paymentUrl` or `statusUrl`).

## Errors

Most tool errors carry a `reason`:

| `reason` | Do this |
|---|---|
| `already_booked` | This stay is already booked: show `orderUrl` and don't book again |
| `price_or_terms_changed` | Re-run `fortrip:get_rates`, call `fortrip:create_booking` again with the chosen rate, show the new price and terms, and ask for confirmation again |
| `rate_unavailable` | Re-run `fortrip:get_rates` and let the user choose again |
| `supplier_unavailable` | Wait a few seconds and retry once; if it fails again, tell the user |
| `refused` | Read `error` and explain it to the user |

Without a `reason`:

- **429** has `retryAfterSeconds`: wait that long, then retry once.
- **503** with `retryable: true` and no `reason` is a brief failure on Fortrip's side (for example, the same booking started twice at once): wait `retryAfterSeconds`, then retry once with the same details.
- **500** and **502** are generic failures: read `error` and tell the user instead of guessing.
