# fortrip-cli

Search, price and book Fortrip hotels from the terminal or an AI agent. The
The npm package and the command are both `fortrip`.

```bash
npx fortrip login          # sign in through the browser
npx fortrip search --query Bangkok --check-in 2026-11-10 --check-out 2026-11-12
```

Requires Node.js 22 or newer. No runtime dependencies.

## Commands

| Command | What it does |
|---|---|
| `login [--no-browser]` | Device-code login: prints a code, opens `/cli/authorize`, waits for you to approve |
| `logout` | Revokes the saved token on the server and deletes it locally |
| `whoami` | The signed-in account |
| `search` | Hotels with indicative prices |
| `hotel <hotelId> [--with-rooms]` | Static hotel detail |
| `rates` | Live rooms and rates |
| `book` | Order + Stripe payment link |

Run `fortrip --help` for every flag. `search`, `rates` and `book` also accept
`--body '<json>'` or `--body @file.json` with the raw request body; flags
override its fields.

Output is JSON on stdout. Errors are JSON on stderr, with fixed exit codes:

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Other error |
| 2 | Invalid arguments (local or HTTP 400) |
| 3 | Not logged in / token revoked (HTTP 401) |
| 4 | Rate limited (HTTP 429; `retryAfterSeconds` on stderr) |

## Credentials

- `login` saves the token to `~/.config/fortrip/credentials.json`
  (`$XDG_CONFIG_HOME` is honoured), mode `0600`. Tokens are stored per API URL,
  so a token is only ever sent to the server that issued it.
- Without a token, any other command starts a device login and exits 3 with
  `loginUrl` on stderr instead of waiting. Once that link is approved in the
  browser, rerunning the command saves the token and carries on. This is how
  AI agents sign in, since they can't sit in `login`.
- `FORTRIP_TOKEN` overrides the saved login (CI, remote sandboxes).
- `FORTRIP_API_URL` overrides the base URL (default `https://fortrip.ai`).
  Plain `http` is only accepted for `localhost`.
- `FORTRIP_CURRENCY` sets the default `--currency` for `search` and `rates`
  (`CNY` or `USD`; the API defaults to `CNY`). Display only: `book`
  charges the currency it returns.

Tokens don't expire; `logout` revokes them.

## Agent skill

```bash
npx skills add FortripEngineering/fortrip-cli
```

[`skills/fortrip-hotels/SKILL.md`](skills/fortrip-hotels/SKILL.md) only tells
the agent to run `npx -y fortrip@latest skill`, which prints
[`AGENT_GUIDE.md`](AGENT_GUIDE.md): when to use the CLI, the call order, login,
and what to show the user before handing over a payment link. The guide ships
with the package, so a CLI release updates every installed skill. Edit
`AGENT_GUIDE.md`, not `SKILL.md`.

`fortrip skill planning` prints [`guides/planning.md`](guides/planning.md):
what to ask, how to rank and how to present options for flexible dates,
budgets, split stays and several destinations. Both guides are printed with
`fortrip@latest` replaced by the running version, so an agent keeps using the
same CLI for the whole conversation.

## Development

```bash
pnpm install
pnpm dev search --query Bangkok ...      # run from source
pnpm test
pnpm typecheck
pnpm build                               # dist/cli.js
```

Point at a local Fortrip app with `FORTRIP_API_URL=http://localhost:3000`.

## Releasing

Pushing a `v*` tag publishes to npm through
[`.github/workflows/publish.yml`](.github/workflows/publish.yml), which signs
in with npm trusted publishing (no npm token in GitHub).

1. Bump the version in a PR and merge it into `main`:
   `npm version minor --no-git-tag-version` (or `patch`).
2. Tag the merged commit on `main` and push the tag:

   ```bash
   git checkout main && git pull
   git tag v0.2.0 && git push origin v0.2.0
   ```

The workflow refuses a tag that doesn't match `package.json` or isn't on
`main`, then runs typecheck, tests and the build before publishing. Every
installed skill picks up the new guide on its next `npx fortrip@latest skill`.
