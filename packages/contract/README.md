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

Browser code that only needs the guest-name rule (`GUEST_NAME_PATTERN`,
`GUEST_NAME_TITLE`, `GUEST_NAME_MESSAGE`, `guestNameRe`, `normalizeGuestName`)
can import it from `@fortrip/agent-contract/guest-name`. That module imports
nothing, so it does not pull in `zod` or the schemas the root entry builds at
load. The root entry exports the same names.

MIT licensed. Source: <https://github.com/FortripEngineering/fortrip/tree/main/packages/contract>.
