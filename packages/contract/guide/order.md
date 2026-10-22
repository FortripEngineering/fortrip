{{#if claude-skill cli}}
## Workflow

1. **Search** with `{{tool:search}}` for candidate hotels and indicative prices. It needs `{{arg:checkIn}}` and `{{arg:checkOut}}`.
{{#if cli}}

   ```bash
   {{tool:search}} --query "Bangkok" --check-in 2026-11-10 --check-out 2026-11-12 \
     --star-min 4 --sort price-asc --page-size 10
   ```

{{/if}}
2. **Details** (optional) with `{{tool:hotel}}`, when the user asks about a hotel or a stated preference needs evidence (a pool, a policy, room size). For a details-only question, call it directly when you know the hotel's id; otherwise find the hotel with `{{tool:search}}` using the user's dates (ask for them if they gave none).
{{#if cli}}

   ```bash
   {{tool:hotel}} 266000 [--with-rooms]
   ```

{{/if}}
3. **Rates** with `{{tool:rates}}` for a few shortlisted hotels, using the dates and occupancy the user will book. It takes about 15 seconds. A hotel is available only once this returns a live option for it.
{{#if cli}}

   ```bash
   {{tool:rates}} --hotel 266000 --hotel 266001 --check-in 2026-11-10 \
     --check-out 2026-11-12 --rooms 1 --adults 2 [--child-age 6] \
     [--nationality CN] [--board BB] [--free-cancellation] [--currency USD]
   ```

{{/if}}
4. **Book** with `{{tool:book}}`, once the user has picked one rate and given the guest details (see Booking).
{{#if cli}}

   ```bash
   {{tool:book}} --hotel 266000 --room-id 9191658 --rate-plan "<ratePlanCode>" \
     --check-in 2026-11-10 --check-out 2026-11-12 --rooms 1 --adults 2 \
     --guest "John Smith" --contact-name "John Smith" \
     --contact-phone "+8613800000000" [--contact-email john@example.com]
   ```

{{/if}}
5. **Confirm, then give the payment link**, as in "Before giving the payment link" below.

## Search

{{/if}}
- Search prices come from a minimum-price feed, not live rates: quote `{{tool:rates}}` prices, and never call a search result available or bookable.{{#if claude-skill cli}} When you show search prices, say they are indicative minimums, not quotes.{{/if}}
- A search that matches too many hotels fails with `matched` and `maxMatches`: narrow it{{#if claude-skill cli}} (a city, an area, stars or a price range){{/if}}.
{{#if claude-skill cli}}
- Use `{{arg:near}}` for "near X"{{#if cli}} (`lat,lng,radiusKm`){{/if}}, and `{{arg:cityCode}}` when you know the city's code.
- Facility names in `{{arg:facilities}}` must match the catalogue exactly (`Swimming pool`, `Parking`); near-synonyms match nothing.
{{/if}}
