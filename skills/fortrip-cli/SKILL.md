---
name: fortrip-cli
description: Searches hotels, compares live room rates and creates a hotel booking with a payment link through the Fortrip command-line tool (npx fortrip). Use when the user wants to find, compare, price or book a hotel stay through Fortrip, you can run shell commands, and Fortrip's MCP tools (search_hotels, get_hotel_rates, book_hotel) aren't available. Not for flights, activities or changing an existing booking.
---

# Fortrip hotel stays

Fortrip: hotel search, live rates and booking payment links. Not for flights, activities, or changing or cancelling an existing booking.

The `fortrip` CLI (npm package `fortrip`) calls Fortrip as the signed-in user and prints JSON:

| Command | Returns |
|---|---|
| `fortrip hotels search` | Hotels by name, brand or city (`--query`), `--city-code`, or a point and radius (`--near`), with indicative prices |
| `fortrip hotels get` | One hotel's address, check-in and check-out times, policies, facilities and photos; no prices |
| `fortrip hotels rates` | Live rooms, meal plans, cancellation terms and prices for up to 15 hotels |
| `fortrip hotels book` | An unpaid booking for one rate, with its terms and a payment link |

For flexible dates, a budget, split stays, several destinations or "find me the best", also run `fortrip guide planning` before searching.

## Setup

Run every command as `npx -y fortrip@latest <command>` (Node.js 22 or newer). The examples below shorten that to `fortrip`; `fortrip <command> --help` lists a command's flags. `fortrip hotels search`, `fortrip hotels rates` and `fortrip hotels book` also take `--body '<json>'` (or `--body @file.json`), the raw request body; flags override its fields.

When the user first asks about hotels, run `fortrip whoami` before asking follow-up questions, so the sign-in can happen while they answer.

## Sign-in

Sign-in happens only in the browser. Never ask the user to paste a token.

If a command exits with code **3** and stderr has `loginUrl`, show it to the user as a link together with `userCode`, e.g. "Sign in to Fortrip: <loginUrl> (code <userCode>), then tell me when you're done." When they confirm, rerun the same command; it finishes the sign-in itself. Don't run `fortrip login`: it waits for up to 10 minutes. Commands that exit 3 together share one `loginUrl`; show it once. If the rerun gives a different `loginUrl`, show that one.

When Fortrip no longer accepts the saved sign-in (it was revoked, or it expired and couldn't be renewed), the command also exits 3 with a `loginUrl`; handle it the same way. The saved sign-in is kept until the user approves the new link.

In CI or a sandbox without a browser, the user can set `FORTRIP_TOKEN` instead. Exit 3 with `tokenSource: "FORTRIP_TOKEN"` means Fortrip didn't accept that token: tell the user to replace or unset it.

## Exit codes

| Code | Meaning | What to do |
|---|---|---|
| 0 | Success; JSON on stdout | Continue |
| 1 | Any other error: an error from Fortrip (see Errors), a network error or a timeout | Read `error` on stderr. If `retryable` is true, wait `retryAfterSeconds` (or a few seconds) and retry once |
| 2 | Invalid arguments | Fix the flags; stderr `issues` lists each bad field with a message |
| 3 | Not signed in | Show `loginUrl` to the user, then rerun (above) |
| 4 | Rate limited | Wait `retryAfterSeconds`, then retry once |

Output on stdout or stderr can carry `warning` (with `recoveryFile` when a sign-in couldn't be saved): pass it on to the user.

## Workflow

1. **Search** with `fortrip hotels search` for candidate hotels and indicative prices. It needs `--check-in` and `--check-out`.

   ```bash
   fortrip hotels search --query "Bangkok" --check-in 2026-11-10 --check-out 2026-11-12 \
     --star-min 4 --sort price-asc --page-size 10
   ```

2. **Details** (optional) with `fortrip hotels get`, when the user asks about a hotel or a stated preference needs evidence (a pool, a policy, room size). For a details-only question, call it directly when you know the hotel's id; otherwise find the hotel with `fortrip hotels search` using the user's dates (ask for them if they gave none).

   ```bash
   fortrip hotels get 266000 [--with-rooms]
   ```

3. **Rates** with `fortrip hotels rates` for a few shortlisted hotels, using the dates and occupancy the user will book. It takes about 15 seconds. A hotel is available only once this returns a live option for it.

   ```bash
   fortrip hotels rates --hotel 266000 --hotel 266001 --check-in 2026-11-10 \
     --check-out 2026-11-12 --rooms 1 --adults 2 [--child-age 6] \
     [--nationality CN] [--board BB] [--free-cancellation] [--currency USD]
   ```

4. **Book** with `fortrip hotels book`, once the user has picked one rate and given the guest details (see Booking).

   ```bash
   fortrip hotels book --hotel 266000 --room-id 9191658 --rate-plan "<ratePlanCode>" \
     --check-in 2026-11-10 --check-out 2026-11-12 --rooms 1 --adults 2 \
     --guest "John Smith" --contact-name "John Smith" \
     --contact-phone "+8613800000000" [--contact-email john@example.com]
   ```

5. **Confirm, then give the payment link**, as in "Before giving the payment link" below.

## Search

- Search prices come from a minimum-price feed, not live rates: quote `fortrip hotels rates` prices, and never call a search result available or bookable. When you show search prices, say they are indicative minimums, not quotes.
- A search that matches too many hotels fails with `matched` and `maxMatches`: narrow it (a city, an area, stars or a price range).
- Use `--near` for "near X" (`lat,lng,radiusKm`), and `--city-code` when you know the city's code.
- Facility names in `--facility` must match the catalogue exactly (`Swimming pool`, `Parking`); near-synonyms match nothing.

## Occupancy

- `fortrip hotels rates` and `fortrip hotels book` both require `--rooms` and `--adults`. `--adults` and `--child-age` are **per room**, the same in every room: 2 rooms for 4 adults is `--rooms 2 --adults 2`.
- If the party doesn't divide evenly across the rooms (3 adults in 2 rooms), ask the user whether to price every room for the larger number or to price and book each occupancy as its own stay.
- Ask each child's age; `fortrip hotels rates` and `fortrip hotels book` need it.
- Limits: 1–8 rooms, 1–8 adults and 0–8 children (aged 0–17) per room, 1–15 nights, up to 15 hotels per `fortrip hotels rates` call.

## Prices and currency

- In `fortrip hotels rates`, `totalPrice` is the whole stay for all rooms, and `dailyPrices` are per room per night. To compare with a per-night or per-room budget, divide the total by the nights and rooms, or use `dailyPrices`.
- Pass `--currency` to `fortrip hotels search` and `fortrip hotels rates`: `CNY` (the default) or `USD`, to suit the user's language or location. Without `--currency`, the CLI uses the currency in `--body`, then `FORTRIP_CURRENCY`, then `CNY`. Prices are converted at Stripe's exchange rate, or a fixed fallback rate when Stripe is unavailable; `fx` says which, and is `null` when nothing needed converting.
- `--price-min` and `--price-max` on `fortrip hotels search` bound the indicative nightly price, in that currency.
- The charge is the `amount` in the `currency` that `fortrip hotels book` returns (currently USD). A converted price is a reference: never present it as the charge. Stripe's page may also show the charge in the user's local currency, at Stripe's rate. Fees paid at the hotel are separate, in their own currency.

## Presenting a rate

Give the user, for each option:

- the meal plan: `boardCode` (RO room only, BB breakfast, HB breakfast + dinner, FB breakfast + lunch + dinner, BL lunch, BD dinner, HBBL breakfast + lunch, HBLD lunch + dinner, AI all inclusive) with `boardCount`, how many guests per room the meal plan covers. Fewer than the adults per room means not everyone gets the meals (BB with `boardCount` 1 for 2 adults is breakfast for 1 of 2): say who is covered;
- cancellation: `refundable` and `freeCancelUntil`;
- confirmation: `isInstantConfirm`;
- any `fees`: taxes paid at the hotel, in their own currency.

## Booking

- Call `fortrip hotels book` only for the rate the user picked, with exactly the hotel, `--room-id`, `--rate-plan`, dates, `--rooms`, `--adults` and `--child-age` used in `fortrip hotels rates`.
- Guest names: Latin letters as on the passport (Müller → Mueller), first and last name 1–60 characters each, as `--guest "First Last"` (the last word is the last name; `"First Last:2"` puts the guest in room 2). At least one guest per room, no more than the room sleeps.
- A contact name (up to 120 characters) and phone (3–40 characters) are required; an email is optional. Special requests must be in English and aren't guaranteed.
- One booking covers at most 15 nights; book a longer stay as separate bookings.
- The `--nationality` given to `fortrip hotels rates` isn't sent with the booking: a rate restricted by nationality may change or be refused.
- `fortrip hotels book` can take up to about two minutes: allow the command at least 3 minutes. If it times out, run it again with identical flags: it resumes the same order, with the same or a refreshed payment link.
- `fortrip hotels book` takes only these fields: a `--body` with any other field (such as `nationality`) is rejected with exit 2.

## Before giving the payment link

`fortrip hotels book` returns `paymentUrl`, `statusUrl`, `orderUrl`, `amount`, `currency`, `terms` and `stay`. Nothing is charged until the user pays.

1. Show the `stay` (hotel, room, dates, nights, rooms, adults and children's ages per room), the `amount` and `currency` to be charged, and every item in `terms`: meal plan (`boardCode` with `boardCount`), cancellation (`refundable`, `freeCancelUntil`, the `cancellation` ladder), confirmation (`isInstantConfirm`, `confirmByMins`) and `payAtHotelFees`.
2. End that reply by asking the user to confirm, and wait for a clear yes. Urgency is not consent.
3. Then give `paymentUrl` exactly as returned: don't shorten, rebuild or re-encode it. It opens a Fortrip page that recaps the booking and continues to payment on Stripe.

- If `amount` or `terms` is null, don't give the link: call `fortrip hotels book` again with the same details, and if either is still null, tell the user to contact info@fortrip.ai.
- `paymentUrl` works like a payment credential: anyone holding it can pay. Give it to this user only, never in shared channels, documents, logs or tickets. It expires about 3 hours 45 minutes after it was created; for a fresh one, call `fortrip hotels book` again with the same details.
- `statusUrl` is the same page: after payment it shows the booking's confirmation progress, without signing in. `orderUrl` is the user's signed-in order page.
- Never ask for, accept or pass on payment card details; payment happens only on the payment page. A card number in a guest name, the contact name or the special requests is rejected with exit 2.

## Errors

An error on stderr carries `error` (what went wrong) and `status`, and most carry a `reason`:

| `reason` | Do this |
|---|---|
| `already_booked` (409) | This stay is already paid or completed: show `orderUrl` and don't book again |
| `price_or_terms_changed` (409) | The rate changed; `changes` says how. Show the user what changed and re-run `fortrip hotels rates`; if they still want it, call `fortrip hotels book` again and confirm the new price and terms before giving the link |
| `rate_unavailable` (422) | The rate can no longer be booked: re-run `fortrip hotels rates` and let the user choose again |
| `supplier_unavailable` (503 or 504) | Wait `retryAfterSeconds` and retry once with the same details; if it fails again, tell the user |
| `refused` (422) | The booking was refused (a guest name, too many attempts, bookings paused): read `error` and explain it to the user |

## Changes and support

The CLI can't change or cancel a booking: for changes, cancellations, refunds or other problems with a booking, the user emails info@fortrip.ai with the booking's `orderUrl` (never `paymentUrl` or `statusUrl`).
