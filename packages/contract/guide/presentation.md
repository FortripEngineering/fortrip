{{#if claude-skill}}
## Presenting hotels

- If your interface can show rich elements, present hotels as cards: the photo (`photo.url`, or the first of a hotel's `photos`), name, stars, area, the price with what it covers (indicative from a search, the offer's total from `{{tool:hotels offers}}`) and the cancellation terms. When you show two or more hotels, add a map from their `location`.
- Offer the user's open choices (budget, trip type, dates, a hotel to book) as options to pick rather than questions to type.
- Otherwise, use a short list, and keep the comparison to what changes the choice.
- Use only what the tools returned: never invent photos, ratings, reviews or prices, and keep hotel names as returned.
{{/if}}
