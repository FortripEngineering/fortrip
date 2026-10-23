{{#if claude-skill cli}}
## Workflow

1. **Search** with `{{tool:hotels search}}` for candidate hotels: a destination, `{{arg:text}}` or both, and the stay's dates and rooms for indicative prices.
{{#if cli}}

   ```bash
   {{tool:hotels search}} --place-name Bangkok --country TH --check-in 2026-11-10 \
     --check-out 2026-11-12 --room 2 --stars-min 4 --sort price_asc --limit 10
   ```

{{/if}}
2. **Details** (optional) with `{{tool:hotels get}}`, when the user asks about a hotel or a stated preference needs evidence (a pool, a policy, room size). For a details-only question, call it directly when you know the hotel's `hotelId`; otherwise find the hotel with `{{tool:hotels search}}`.
{{#if cli}}

   ```bash
   {{tool:hotels get}} <hotelId> [--rooms]
   ```

{{/if}}
3. **Offers** with `{{tool:hotels offers}}` for a few shortlisted hotels, with the dates and rooms the user will order. It takes about 15 seconds. A hotel is available only once this returns an offer for it.
{{#if cli}}

   ```bash
   {{tool:hotels offers}} --hotel <hotelId> --hotel <hotelId> --check-in 2026-11-10 \
     --check-out 2026-11-12 --room 2 --room 2 [--require-free-cancellation]
   ```

{{/if}}
4. **Order** with `{{tool:hotels book}}`, once the user has picked one offer and given the guests and the contact (see Ordering).
{{#if cli}}

   ```bash
   {{tool:hotels book}} --offer <offerId> --guest 1:John:Smith --guest 2:Mary:Smith \
     --first-name John --last-name Smith --email john@example.com \
     --phone "+8613800000000"
   ```

{{/if}}
5. **Confirm, then give the payment link**, as in "Before giving the payment link" below.
6. **After payment**, check the order with `{{tool:orders get}}` (see After payment).

## Search

### Where

- **A place by name:** {{#if mcp claude-skill}}`{ kind: "place_name", name, countryCode }`{{/if}}{{#if cli}}`--place-name <name> --country <CC>`{{/if}}, in any language (Kyoto or 京都). The country is required: ask the user when it isn't clear. Names match exactly, ignoring only case and spacing: accents, hyphens, apostrophes and periods count ("Köln" or "Cologne", not "Koln"; "St. Moritz", not "St Moritz").
- If several places bear the name, the answer is `destination_ambiguous` with up to {{limit:candidatesShown}} candidates and their hotel counts: ask the user which one they mean, then search it by its `placeId`; never pick one yourself.
- `destination_not_found` with `no_match` means no place of that name in that country: check the spelling and accents, or try another name for the place. Its `nameAsText` counts the hotels that a `{{arg:text}}` search for the name would find.
- **A place from an earlier answer:** {{#if mcp claude-skill}}`{ kind: "place", placeId }`{{/if}}{{#if cli}}`--place <placeId>`{{/if}}.
- **Near a point:** {{#if mcp claude-skill}}`{ kind: "point", location: { lat, lng } }`{{/if}}{{#if cli}}`--point <lat,lng>`{{/if}}, for "near X" when you know where X is.
- **A whole country:** {{#if mcp claude-skill}}`{ kind: "country", countryCode }`{{/if}}{{#if cli}}`--country-only <CC>`{{/if}}, as for the Maldives.
- Countries, regions (states, provinces), prefecture-level cities in China and main islands cover their whole area. Towns, neighbourhoods, districts, small islands and points cover a circle of {{limit:radiusMetersDefault}} meters; `{{arg:destination.radiusMeters}}` sets another, up to {{limit:radiusMetersMax}} meters, and narrows an area to a circle around its center.
- **Localities:** an area search lists its `localities`, the towns its hotels belong to, each with a `placeId`, its hotel `count` and the places it `includes` (Patong is part of Phuket). To search one, pass it as {{#if mcp claude-skill}}`{ kind: "locality", placeId }`{{/if}}{{#if cli}}`--locality <placeId>`{{/if}}. A town that isn't a locality answers `destination_not_found` with `not_a_locality` and the `hub` it belongs to: search the hub, or the town itself with {{#if mcp claude-skill}}`kind: "place"`{{/if}}{{#if cli}}`--place`{{/if}} for a circle around it.
- A price sort or price filter over more than {{limit:poolLimit}} hotels (in an area, or for text alone) answers `search_too_broad` with `matched` and the top `localities`: show them and ask the user which they prefer, unless the request already names one of them; search that one by its `placeId` as a locality, never by its name.

### Text

`{{arg:text}}` matches exact words in hotel names and addresses, in Chinese or English:

- Every word must match as written: plurals, accents, spacing and abbreviations count ("hostel" and "hostels", "St Regis" and "Saint Regis" find different hotels). Hyphens and apostrophes don't (Ritz-Carlton finds Ritz Carlton).
- In Chinese, matching follows word segmentation, so part of a name can match unrelated hotels (希尔 is not 希尔顿).
- Use only distinctive words: a hotel or brand name, a district or a landmark. Not "hotel", "near", "cheap" or "best".
- Typos return nothing: "Shangahi" finds no hotel.
- Place names belong in the destination: "Maldives" as text finds a hotel named Maldives in China.

### Filters

- Stars run from 1 to 5 in half steps{{#if mcp claude-skill}} (`filters.stars`){{/if}}. "4 stars" as {{#if mcp claude-skill}}`{ min: 4, max: 4 }`{{/if}}{{#if cli}}`--stars-min 4 --stars-max 4`{{/if}} leaves out 4.5: unless the user means exactly 4, use {{#if mcp claude-skill}}`{ min: 4 }`{{/if}}{{#if cli}}`--stars-min 4`{{/if}} or ask. Unrated hotels are left out whenever stars are filtered.
- `{{arg:filters.amenities}}` takes only the amenities that can filter (such as pool, parking, wifi); others, such as gym or spa, show in `{{tool:hotels get}}` but can't filter. A hotel matches only when it lists the amenity, and about half the hotels list no amenities at all (`coverage.excludedNoFacilityData` counts those left out): "not listed" is not "absent".
- `{{arg:filters.price.maxPerRoomNight}}` bounds the indicative price per room per night, in USD; hotels without one are left out and counted.

### Results

- `notes` explain the answer (a limited pool, a circle around an island, more hotels just outside it): pass on what matters to the user.
- `coverage` has the counts: `matched` hotels, how many were priced and how many have a price.
- A next page is {{#if mcp claude-skill}}`cursor` set to `nextCursor` and, optionally, `limit`{{/if}}{{#if cli}}`--cursor <nextCursor>` and, optionally, `--limit`{{/if}}; nothing else.
{{/if}}
{{#if mcp}}
- A place name needs its `countryCode` (ask the user if unclear) and matches exactly (accents and periods count). On `destination_ambiguous`, ask the user which they mean, then search its `placeId`; never pick one yourself.
- On `search_too_broad`, show its `localities` and ask the user which, unless they already named one; search it as `{ kind: "locality", placeId }`, never by name.
- `text` matches whole words of hotel names and addresses: use a distinctive name, brand or landmark. A typo finds nothing.
{{/if}}
