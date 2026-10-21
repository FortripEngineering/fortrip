# Fortrip hotels

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

For flexible dates, a budget, split stays, several destinations or "find me
the best", also run `npx -y fortrip@latest skill planning` before searching.

## Setup

Run every command as `npx -y fortrip@latest <command>`, the same version that
printed this guide. The examples below shorten that to `fortrip`.

When the user first asks about hotels, run `fortrip whoami` before asking
follow-up questions, so a login can happen while they answer.

If a command exits with code **3** and stderr has `loginUrl`, show it to the
user as a link together with `userCode`, e.g. "Sign in to Fortrip: <loginUrl>
(code BCDF-GHJK) and tell me when you're done." When they confirm, rerun the
same command; it finishes the login itself. Don't run `fortrip login` — it
waits for up to 10 minutes. If the rerun gives a new `loginUrl`, the old one
expired or was denied; show the new one.

If exit 3 has no `loginUrl`, the saved token was revoked: run `fortrip logout`,
then rerun the command to get a link.

In CI, the user can set `FORTRIP_TOKEN` instead. Never ask the user to paste a
token into the chat.

## Exit codes

| Code | Meaning | What to do |
|---|---|---|
| 0 | Success; JSON on stdout | Continue |
| 1 | Other error (supplier error, rate no longer bookable, network) | Read `error` on stderr; if `retryable` is true (supplier unreachable or timed out), wait a few seconds and retry once; re-run `rates` if a rate went stale |
| 2 | Invalid arguments | Fix the flags; stderr `issues` lists the bad fields |
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
   `totalFrom`) are **indicative floors**, not quotes — say so.

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

   This call takes about 15 seconds. Prices are in the response's `currency`,
   converted at Stripe's exchange rate (refreshed hourly), or a fixed fallback
   rate when Stripe is unavailable; `fx` says which, and is `null` when
   nothing needed converting. Present each option with meal plan (`boardCode`: RO room only,
   BB breakfast, HB half board, FB full board, AI all inclusive),
   `freeCancelUntil` / `refundable`, `isInstantConfirm`, and any `fees`
   (taxes paid at the hotel, in their own currency).

4. **Book** — only after the user picks one rate and gives guest details:

   ```bash
   fortrip book --hotel 266000 --room-id 9191658 --rate-plan "<ratePlanCode>" \
     --check-in 2026-11-10 --check-out 2026-11-12 --rooms 1 --adults 2 \
     --guest "John Smith" --contact-name "John Smith" \
     --contact-phone "+8613800000000" [--contact-email john@example.com]
   ```

   `--hotel`, `--room-id`, `--rate-plan`, dates, `--rooms`, `--adults` and
   `--child-age` must be exactly the values used in `rates`. Guest names must
   be in Latin letters as on the passport ("First Last"; last word is the last
   name; `"First Last:2"` puts the guest in room 2). Each room needs at least
   one guest. `--special-requests` must be in English and isn't guaranteed.

## Before giving the payment link

`book` returns `paymentUrl`, `amount`, `currency`, `terms`, `statusUrl` and
`orderUrl`. Before you hand over `paymentUrl`:

1. **Show the `terms`** and get the user's confirmation: meal plan
   (`boardCode`, `boardCount`), cancellation (`refundable`, `freeCancelUntil`,
   the `cancellation` ladder), confirmation (`isInstantConfirm`,
   `confirmByMins`) and `payAtHotelFees`.
2. **Explain the amount.** `rates` showed a converted figure, but the charge
   is `amount` in `currency` (usually USD), and the Stripe page may display
   the user's local currency at Stripe's rate. The `rates` figure used a
   Stripe rate too, so it is usually close, but the amount on the payment page
   is what will be charged; the `rates` figure was a reference.
3. The link is for **this user only**: whoever has it can pay. Don't post it
   in shared channels, logs or tickets. It expires after about 3 hours 45
   minutes; call `book` again with the same details for a fresh one.

After paying, the user lands on `statusUrl`, which shows confirmation progress
without signing in. `orderUrl` is the signed-in order page.

## Errors from `book`

- `409` with `agentOrderId`: this exact stay is already paid or completed —
  show `orderUrl`, don't book again.
- `409` with `changes`: price or terms changed — re-run `rates` and confirm
  again with the user.
- `422`: the booking was refused (guest names, too many attempts, bookings
  paused, or a preview deployment). Read `error`.
