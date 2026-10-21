# Fortrip

Fortrip sells hotel rooms at supplier net prices. The
`fortrip` CLI (npm package `fortrip`) calls the Fortrip API as the
signed-in user and prints JSON.

## When to use

- The user wants hotels in a city, near a point, or by name, for given dates.
- The user wants live rooms, meal plans, cancellation terms or prices for
  specific hotels.
- The user has picked a rate and wants to book it (you return a payment link;
  the user pays in their browser).

Not for flights, activities, or changing/cancelling an existing booking.
For changes, cancellations, refunds or any other problem with a booking, the
user emails info@fortrip.ai with the booking's `orderUrl` (never
`paymentUrl` or `statusUrl`).

For flexible dates, a budget, split stays, several destinations or "find me
the best", also run `npx -y fortrip@latest skill planning` before searching.

## Setup

Run every command as `npx -y fortrip@latest <command>`, the same version that
printed this guide. The examples below shorten that to `fortrip`;
`fortrip <command> --help` lists a command's flags.

When the user first asks about hotels, run `fortrip whoami` before asking
follow-up questions, so a login can happen while they answer.

If a command exits with code **3** and stderr has `loginUrl`, show it to the
user as a link together with `userCode`, e.g. "Sign in to Fortrip: <loginUrl>
(code BCDF-GHJK) and tell me when you're done." When they confirm, rerun the
same command; it finishes the login itself. Don't run `fortrip login` — it
waits for up to 10 minutes. Commands that exit 3 together share one
`loginUrl`; show it once. If the rerun gives a different `loginUrl`, show
that one.

A saved sign-in the server no longer accepts (revoked, or unused for 90
days) is replaced the same way: the command exits 3 with a new `loginUrl`.
Exit 3 with `tokenSource: "FORTRIP_TOKEN"` means the token the user set in
`FORTRIP_TOKEN` was rejected; tell them to replace or unset it, and don't
rerun until they have.

Sign-in happens only in the browser. In CI, the user can set `FORTRIP_TOKEN`
instead. Never ask the user to paste a token into the chat.

## Exit codes

| Code | Meaning | What to do |
|---|---|---|
| 0 | Success; JSON on stdout | Continue |
| 1 | Other error (supplier error, rate no longer bookable, network error or timeout) | Read `error` on stderr; if `retryable` is true (supplier unreachable or timed out, Fortrip briefly unavailable, or no response from Fortrip), wait `retryAfterSeconds` (or a few seconds) and retry once; re-run `rates` if a rate went stale. `book` errors carry a `reason` (below) |
| 2 | Invalid arguments | Fix the flags; stderr `issues` lists the bad fields (a stay that is too long gives `requestedNights` and `maxNights` instead) |
| 3 | Not logged in | Show `loginUrl` to the user, then rerun (above) |
| 4 | Rate limited | Wait `retryAfterSeconds`, then retry once |

## Recommended order

1. **Search** — find candidates and indicative prices:

   ```bash
   fortrip search --query "Bangkok" --check-in 2026-11-10 --check-out 2026-11-12 \
     --star-min 4 --sort price-asc --page-size 10
   ```

   Use `--near lat,lng,radiusKm` for "near X", `--city-code` when known.
   Pass `--currency` (`CNY`, the default, or `USD`) to suit the user, inferred
   from their language or location, on both `search` and `rates`;
   `--price-min` / `--price-max` are in that currency.
   `--facility` names must match the catalogue exactly (e.g. `Swimming pool`,
   `Parking`), otherwise nothing matches. Prices here (`price.nightlyFrom`,
   `totalFrom`) are **indicative floors**, not quotes — say so. A search
   that matches too many hotels fails with `matched` and `maxMatches`: narrow
   it (a city, an area, stars or a price range).

2. **Hotel detail** (optional) — description, policies, facilities, photos:

   ```bash
   fortrip hotel 266000 [--with-rooms]
   ```

3. **Rates** — live rooms and prices for up to 15 hotels:

   ```bash
   fortrip rates --hotel 266000 --hotel 266001 --check-in 2026-11-10 \
     --check-out 2026-11-12 --rooms 1 --adults 2 [--child-age 6] \
     [--nationality CN] [--board BB] [--free-cancellation] [--currency USD]
   ```

   `--adults` and `--child-age` are **per room**, and every room has the same
   occupancy: 2 rooms for 4 adults is `--rooms 2 --adults 2`. If the party
   doesn't divide evenly (3 adults in 2 rooms), ask the user whether to price
   every room for the larger number or book the rooms separately. Limits:
   1–8 rooms, 1–8 adults and 0–8 children (aged 0–17) per room, 1–15
   nights, up to 15 hotels per call.

   This call takes about 15 seconds. Prices are in the response's `currency`,
   converted at Stripe's exchange rate (refreshed hourly), or a fixed fallback
   rate when Stripe is unavailable; `fx` says which, and is `null` when
   nothing needed converting. Present each option with:

   - meal plan: `boardCode` (RO room only, BB breakfast, HB breakfast +
     dinner, FB breakfast + lunch + dinner, BL lunch, BD dinner, HBBL
     breakfast + lunch, HBLD lunch + dinner, AI all inclusive) together with
     `boardCount`, how many guests per room the meal plan covers; fewer than
     the adults per room means not everyone gets the meals (BB with
     `boardCount` 1 for 2 adults is breakfast for 1 of 2), so say who is
     covered;
   - `freeCancelUntil` / `refundable`, `isInstantConfirm`, and any `fees`
     (taxes paid at the hotel, in their own currency).

   `--nationality` isn't sent with the booking: a rate restricted to that
   nationality may change or be refused when booked.

4. **Book** — only after the user picks one rate and gives guest details:

   ```bash
   fortrip book --hotel 266000 --room-id 9191658 --rate-plan "<ratePlanCode>" \
     --check-in 2026-11-10 --check-out 2026-11-12 --rooms 1 --adults 2 \
     --guest "John Smith" --contact-name "John Smith" \
     --contact-phone "+8613800000000" [--contact-email john@example.com]
   ```

   `--hotel`, `--room-id`, `--rate-plan`, dates, `--rooms`, `--adults` and
   `--child-age` must be exactly the values used in `rates`; `book` requires
   `--rooms` and `--adults`. Guest names must be in Latin letters as on the
   passport ("First Last"; last word is the last name; `"First Last:2"` puts
   the guest in room 2; 1–60 characters each). Each room needs at least one
   guest. The contact name takes up to 120 characters, the phone 3–40.
   `--special-requests` must be in English and isn't guaranteed. `book`
   accepts only these fields: a `--body` with any other field (such as
   `nationality`) is rejected with exit 2.

   `book` is safe to rerun with identical flags: it returns the same order,
   with the same or a refreshed payment link.

## Before giving the payment link

`book` returns `paymentUrl`, `amount`, `currency`, `terms`, `stay`,
`statusUrl` and `orderUrl`. Before you hand over `paymentUrl`:

1. **Show what will be booked and ask the user to confirm.** From `stay`:
   hotel (`hotelName`), room (`roomName`), dates, nights, rooms and guests per
   room (`adultsPerRoom`, `childrenAgesPerRoom`); if `stay` is missing, use
   the values you passed. From `terms`: meal plan (`boardCode` with
   `boardCount`), cancellation (`refundable`, `freeCancelUntil`, the
   `cancellation` ladder), confirmation (`isInstantConfirm`, `confirmByMins`)
   and `payAtHotelFees`. Then the `amount` and `currency`, and end your reply
   by asking them to confirm. If `amount` or `terms` is `null`, say it
   couldn't be read rather than guess; the payment page shows the amount.
2. **Explain the amount.** `rates` showed a converted figure, but the charge
   is `amount` in `currency` (usually USD), and the Stripe page may display
   the user's local currency at Stripe's rate. The `rates` figure used a
   Stripe rate too, so it is usually close, but the amount on the payment page
   is what will be charged; the `rates` figure was a reference.
3. **Only after they confirm, give `paymentUrl` exactly as returned**: don't
   shorten, rebuild or re-encode it. It opens a Fortrip page that recaps the
   booking and continues to payment.
4. The link is for **this user only**: whoever has it can pay. Don't post it
   in shared channels, logs or tickets. It expires after about 3 hours 45
   minutes; call `book` again with the same details for a fresh one.

Never ask for, accept or pass on payment card details; payment happens only
on the payment page. A card number in any field is rejected with exit 2.

After paying, the user lands on `statusUrl`, which shows confirmation progress
without signing in. `orderUrl` is the signed-in order page.

## Errors from `book`

Act on `reason` in stderr:

- `already_booked` (409, with `agentOrderId`): this exact stay is already paid
  or completed — show `orderUrl`, don't book again.
- `price_or_terms_changed` (409, with `changes`): show what changed, re-run
  `rates` and confirm again with the user.
- `rate_unavailable` (422): the rate can no longer be booked — re-run `rates`
  and offer what is left.
- `supplier_unavailable` (503 or 504, `retryable: true`): wait
  `retryAfterSeconds` and retry once with identical flags. A 503 with
  `retryable: true` and no `reason` (a passing outage) is handled the same
  way.
- `refused` (any other 422): the booking was refused (guest names, too many
  attempts, bookings paused, or a preview deployment). Read `error`.

Older servers send no `reason`: there a 409 with `agentOrderId` is
`already_booked`, a 409 with `changes` is `price_or_terms_changed`, any other
409 is `rate_unavailable`, and a 422 is `refused`.
