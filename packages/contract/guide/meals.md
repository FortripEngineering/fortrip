{{#if claude-skill cli}}
## Presenting a rate

Give the user, for each option:

- the meal plan: `boardCode` (RO room only, BB breakfast, HB breakfast + dinner, FB breakfast + lunch + dinner, BL lunch, BD dinner, HBBL breakfast + lunch, HBLD lunch + dinner, AI all inclusive) with `boardCount`, how many guests per room the meal plan covers. Fewer than the adults per room means not everyone gets the meals (BB with `boardCount` 1 for 2 adults is breakfast for 1 of 2): say who is covered;
- cancellation: `refundable` and `freeCancelUntil`;
- confirmation: `isInstantConfirm`;
- any `fees`: taxes paid at the hotel, in their own currency.
{{/if}}
