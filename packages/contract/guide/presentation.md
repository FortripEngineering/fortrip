{{#if claude-skill}}
## Presenting hotels

If your interface can show rich elements, show each hotel as a card with only what Fortrip's tools returned for it in this conversation: photo, name, stars, region and price, and once you have offers every term that changes the choice (meals and who they cover, cancellation, fees payable at the property, confirmation), an unknown one as unknown. Label a search's `price.fromPerRoomNight` as an estimate per room-night and an offer's `price.total` as the whole stay for all rooms, in USD, and draw a map only from returned `location` coordinates. Offer the choices you need to ask anyway (dates, a locality, which offer) as options to pick. Otherwise use a short list. Keep hotel names as returned, and never invent photos, ratings, reviews, prices, terms or coordinates.
{{/if}}
