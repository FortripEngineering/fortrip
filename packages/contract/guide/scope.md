{{#if claude-skill cli}}
# Fortrip hotel stays

{{/if}}
Fortrip: hotel search, live offers and orders with a payment link.{{#if claude-skill cli}} Not for flights, activities, or changing an existing order.{{/if}}

{{#if mcp}}
Call order: `{{tool:hotels search}}` → (optional) `{{tool:hotels get}}` → `{{tool:hotels offers}}` → `{{tool:hotels book}}`; after the user pays, `{{tool:orders get}}`; `{{tool:orders list}}` lists their orders; `{{tool:orders cancel}}` cancels one. `{{tool:guide}}` returns Fortrip's guidance for flexible dates, budgets or several destinations.
{{/if}}
{{#if claude-skill}}
The tools are on Fortrip's MCP server, named `fortrip` in this plugin (a Fortrip connector added on claude.ai can show under its own name). They're written `fortrip:<tool>` below:
{{/if}}
{{#if cli}}
The `fortrip` CLI (npm package `fortrip`) calls Fortrip as the signed-in user and prints each answer as compact text (`--json` prints its JSON):
{{/if}}
{{#if claude-skill cli}}

| {{#if claude-skill}}Tool{{/if}}{{#if cli}}Command{{/if}} | Returns |
|---|---|
| `{{tool:hotels search}}` | Hotels in a place, near a point or matching a name (`{{arg:text}}`), with indicative prices |
| `{{tool:hotels get}}` | One hotel's address, check-in and check-out times, description, policies, amenities and rooms; no prices |
| `{{tool:hotels offers}}` | Live offers (room, meals, total in USD, cancellation terms) for up to {{limit:offersHotels}} hotels |
| `{{tool:hotels book}}` | An unpaid order for one offer, with its terms and a payment link |
| `{{tool:orders get}}` | One order and its status, including whether the hotel confirmed it |
| `{{tool:orders list}}` | The user's orders, newest first, including those made on the Fortrip website |
| `{{tool:orders cancel}}` | Cancels an order under its terms, for the penalty the user agreed to, and refunds the rest |

For flexible dates, a budget, split stays, several destinations or "find me the best", {{#if claude-skill}}read [references/planning.md](references/planning.md){{/if}}{{#if cli}}also run `{{tool:guide}} planning`{{/if}} before searching.
{{/if}}
