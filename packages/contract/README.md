# @fortrip/agent-contract

The contract of Fortrip's agent API, `/api/agent/v1`: the limits, endpoint
paths, error reasons and field rules that the Fortrip CLI (`fortrip`), the
hosted MCP server and the store listings all share, so they cannot drift
apart.

It has one peer dependency, `zod` (4.4 or later), and runs anywhere
ES2023 does. The package version follows the API: `1.x` serves
`/api/agent/v1`.

```ts
import { API, LIMITS, containsCardNumber } from "@fortrip/agent-contract";

API.search; // "/api/agent/v1/hotels/search"
LIMITS.rooms; // 8
```

MIT licensed. Source: <https://github.com/FortripEngineering/fortrip/tree/main/packages/contract>.
