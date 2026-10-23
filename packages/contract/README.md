# @fortrip/agent-contract

The contract of Fortrip API v1 (`https://api.fortrip.ai/v1`) and its MCP
server (`https://mcp.fortrip.ai/`): the limits, paths, request and response
schemas, error codes and field rules that the Fortrip CLI (`fortrip`), the
hosted MCP server and the store listings all share, so they cannot drift
apart.

It has one peer dependency, `zod` (`^4.4.0`), and runs anywhere
ES2023 does. Its major version changes when the contract breaks, not with
the API: `3.x` serves Fortrip API v1.

```ts
import { API, LIMITS, PUBLIC_ORIGINS, containsCardNumber } from "@fortrip/agent-contract";

PUBLIC_ORIGINS.api + API.hotelSearch; // "https://api.fortrip.ai/v1/hotels/search"
LIMITS.rooms; // 8
```

It exports:

- `API`, `PUBLIC_ORIGINS`, `MCP_PATH`, `LIMITS`, `ERROR_CODES`,
  `SEARCH_SORTS` and `FILTERABLE_AMENITIES`: paths, hosts, limits, error codes
  and vocabularies;
- `searchHotelsInput`, `getHotelInput`, `hotelOffersInput`,
  `createOrderInput`, `getOrderInput` and `listOrdersInput`, the zod schemas
  of the requests, and `searchResult`, `hotel`, `hotelOffersResult`, `order`,
  `orderList` and `errorEnvelope`, the open schemas of the responses, with
  `parseOpen`, a parser that keeps unknown fields and values;
- `COMMANDS`, `COMMAND_GROUPS` and `GLOBAL_FLAGS`, the CLI's commands, the
  groups they are typed after and its flags, `commandInvocation(spec)`, a
  command as it is typed (`fortrip hotels search`), and `TOOLS`, the MCP
  tools, with `MCP_OUTPUT` and `ORDER_NEXT_STEP`;
- `renderToolResult(tool, data)` and `renderError(envelope)`, the compact
  text of a result or an error, and `renderGuide(surface, topic)`, the agent
  guide as Markdown for `"mcp"`, `"claude-skill"` or `"cli"`;
- field rules such as `containsCardNumber`, the guest-name rule and the date
  helpers, and `CONTRACT_VERSION`.

Browser code that only needs the guest-name rule (`GUEST_NAME_PATTERN`,
`GUEST_NAME_TITLE`, `GUEST_NAME_MESSAGE`, `guestNameRe`, `normalizeGuestName`)
can import it from `@fortrip/agent-contract/guest-name`. That module imports
no package, so it does not pull in `zod` or the schemas the root entry builds
at load. The root entry exports the same names.

Apache License 2.0 (versions before 2.0.0: MIT). Copyright 2026 FortripAI, Inc.
"Fortrip" is a trademark of FortripAI, Inc. The license does not grant
permission to use the trade names, trademarks, service marks or product names
of FortripAI, Inc., except as required for reasonable and customary use in
describing the origin of the software and reproducing the content of the NOTICE
file (section 6). Source: <https://github.com/FortripEngineering/fortrip/tree/main/packages/contract>.
