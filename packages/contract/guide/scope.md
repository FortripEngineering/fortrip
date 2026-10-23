{{#if claude-skill cli}}
# Fortrip hotel stays

{{/if}}
Fortrip: hotel search, live rates and booking payment links.{{#if claude-skill cli}} Not for flights, activities, or changing or cancelling an existing booking.{{/if}}

{{#if mcp}}
Call order: `{{tool:hotels search}}` → (optional) `{{tool:hotels get}}` → `{{tool:hotels rates}}` → `{{tool:hotels book}}`. `{{tool:guide}}` returns Fortrip's guidance for flexible dates, budgets, split stays, several destinations or "find the best" requests.
{{/if}}
{{#if claude-skill}}
The tools are on Fortrip's MCP server, named `fortrip` in this plugin (a Fortrip connector added on claude.ai can show under its own name). They're written `fortrip:<tool>` below:
{{/if}}
{{#if cli}}
The `fortrip` CLI (npm package `fortrip`) calls Fortrip as the signed-in user and prints JSON:
{{/if}}
{{#if claude-skill cli}}

| {{#if claude-skill}}Tool{{/if}}{{#if cli}}Command{{/if}} | Returns |
|---|---|
| `{{tool:hotels search}}` | Hotels by name, brand or city (`{{arg:query}}`), `{{arg:cityCode}}`, or a point and radius (`{{arg:near}}`), with indicative prices |
| `{{tool:hotels get}}` | One hotel's address, check-in and check-out times, policies, facilities and photos; no prices |
| `{{tool:hotels rates}}` | Live rooms, meal plans, cancellation terms and prices for up to {{limit:ratesHotels}} hotels |
| `{{tool:hotels book}}` | An unpaid booking for one rate, with its terms and a payment link |

For flexible dates, a budget, split stays, several destinations or "find me the best", {{#if claude-skill}}read [references/planning.md](references/planning.md){{/if}}{{#if cli}}also run `{{tool:guide}} planning`{{/if}} before searching.
{{/if}}
