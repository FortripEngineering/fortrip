# fortrip-cli

Search, price and book Fortrip hotels from the terminal or an AI agent.
The npm package and the command are both `fortrip`.

For MCP clients, see the separately maintained
[Fortrip MCP](https://github.com/FortripEngineering/fortrip-mcp)
repository for local and hosted connection instructions.

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
| `book` | Order + payment link (a Fortrip page that continues to Stripe) |

Run `fortrip --help` for every flag, or `fortrip <command> --help` for one
command's. `search`, `rates` and `book` also accept `--body '<json>'` or
`--body @file.json` with the raw request body; flags override its fields.

`--adults` and `--child-age` are per room, and every room has the same
occupancy: 2 rooms for 4 adults is `--rooms 2 --adults 2`. `rates` defaults
to 1 room for 2 adults; `book` requires `--rooms` and `--adults`.

Output is JSON on stdout. Errors are JSON on stderr, with fixed exit codes:

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Other error (`retryable: true` on stderr: worth one retry) |
| 2 | Invalid arguments (local or HTTP 400) |
| 3 | Not logged in / token revoked (HTTP 401) |
| 4 | Rate limited (HTTP 429; `retryAfterSeconds` on stderr) |

## Credentials

- `login` saves the token to `~/.config/fortrip/credentials.json`
  (`$XDG_CONFIG_HOME` is honoured), mode `0600`. Saved tokens are stored per
  API URL, so a saved token is only sent to the server that issued it.
- Without a token, any other command starts a device login and exits 3 with
  `loginUrl` on stderr instead of waiting. Once that link is approved in the
  browser, rerunning the command saves the token and carries on. This is how
  AI agents sign in, since they can't sit in `login`. Commands run in
  parallel share one login link. If the server rejects the saved token, the
  command deletes it and starts a new login the same way.
- `FORTRIP_TOKEN` overrides the saved login (CI, remote sandboxes). It is not
  tied to a server: it is sent to whatever `FORTRIP_API_URL` points at. If the
  server rejects it, commands exit 3 with `tokenSource: "FORTRIP_TOKEN"` and
  no `loginUrl`.
- `FORTRIP_API_URL` overrides the base URL (default `https://fortrip.ai`).
  Plain `http` is only accepted for `localhost`.
- `FORTRIP_CURRENCY` sets the default `--currency` for `search` and `rates`
  (`CNY` or `USD`; the API defaults to `CNY`). Display only: `book`
  charges the currency it returns.

Tokens stop working after 90 days without use. `logout` revokes the saved
token; signed-in users can also list and revoke their CLI sign-ins in their
Fortrip account (account menu → **Fortrip CLI**).

## Agent skill

```bash
npx skills add FortripEngineering/fortrip-plugins --skill fortrip-cli
```

The skill lives in
[fortrip-plugins](https://github.com/FortripEngineering/fortrip-plugins); the
Claude directory plugin there uses the hosted MCP instead of the CLI. The
skill only tells the agent to run `npx -y fortrip@latest skill`, which prints
[`AGENT_GUIDE.md`](AGENT_GUIDE.md): when to use the CLI, the call order, login,
and what to show the user before handing over a payment link. The guide ships
with the package, so a CLI release updates every installed skill. Edit
`AGENT_GUIDE.md`, not the skill.

`fortrip skill planning` prints [`guides/planning.md`](guides/planning.md):
what to ask, how to rank and how to present options for flexible dates,
budgets, split stays and several destinations. Both guides are printed with
`fortrip@latest` replaced by the running version, so an agent keeps using the
same CLI for the whole conversation.

## Support

For changes, cancellations, refunds or other help with a booking, email
[info@fortrip.ai](mailto:info@fortrip.ai) with the booking's order link
(`orderUrl`).

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
in with npm trusted publishing (no npm token in GitHub). Pull requests and
pushes to `main` run typecheck, tests and the build through
[`.github/workflows/ci.yml`](.github/workflows/ci.yml).

1. Bump the version in a PR and merge it into `main`:
   `npm version minor --no-git-tag-version` (or `patch`).
2. Tag the merged commit on `main` and push the tag:

   ```bash
   git checkout main && git pull
   git tag v0.2.0 && git push origin v0.2.0
   ```

The workflow refuses a tag that doesn't match `package.json` or isn't on
`main`. A `build` job runs typecheck, tests and the build and packs the
tarball; a `publish` job in the `npm-publish` environment publishes that
tarball, with no install or build of its own. Every installed skill picks up
the new guide on its next `npx fortrip@latest skill`.

## License

The code and documentation in this repository are licensed under the
[MIT License](LICENSE). This license does not grant access to the hosted
Fortrip service, hotel inventory, or third-party data.
