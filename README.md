# fortrip-cli

Search, price and book Fortrip hotels from the terminal or an AI agent.
The npm package and the command are both `fortrip`.

Prefer MCP? Connect your client to the hosted [Fortrip Hotels MCP](#remote-mcp)
with OAuth sign-in. This repository contains the CLI, agent skill, and remote
MCP connection examples; the hosted MCP service is operated by Fortrip.

```bash
npx fortrip login          # sign in through the browser
npx fortrip search --query Bangkok --check-in 2026-11-10 --check-out 2026-11-12
```

Requires Node.js 22 or newer. No runtime dependencies.

## Remote MCP

| Setting | Value |
|---|---|
| Endpoint | `https://fortrip.ai/api/mcp` |
| Transport | Streamable HTTP |
| Authentication | OAuth sign-in with a Fortrip account |
| Glama Connector | [Fortrip Hotels](https://glama.ai/mcp/connectors/ai.fortrip/fortrip-hotels) |

The remote service does not require installing this CLI or Node.js. Use a
client that supports Streamable HTTP and MCP OAuth, then complete its browser
sign-in and authorization flow. CLI device-login tokens (`fth_...`) and
`FORTRIP_TOKEN` are for the CLI HTTP API and do not authenticate this MCP
endpoint. There is currently no `fortrip mcp` stdio subcommand.

### Claude Code

```bash
claude mcp add --transport http fortrip-hotels https://fortrip.ai/api/mcp
```

Run `/mcp` inside Claude Code, select `fortrip-hotels`, and follow the
authentication prompts. For project configuration, merge
[`examples/claude-code.mcp.json`](examples/claude-code.mcp.json) into `.mcp.json`.

### Cursor

Merge this into `.cursor/mcp.json` in your project, or `~/.cursor/mcp.json`
for your personal configuration:

```json
{
  "mcpServers": {
    "fortrip-hotels": {
      "url": "https://fortrip.ai/api/mcp"
    }
  }
}
```

Restart Cursor if needed, then open its MCP settings and complete the OAuth
sign-in when prompted. A copy is in
[`examples/cursor.mcp.json`](examples/cursor.mcp.json).

### Codex

```bash
codex mcp add fortrip-hotels --url https://fortrip.ai/api/mcp
codex mcp login fortrip-hotels
```

Alternatively, merge [`examples/codex.config.toml`](examples/codex.config.toml)
into `~/.codex/config.toml` or your project's `.codex/config.toml`, then run
the login command. Use `codex mcp list` or `/mcp` in Codex to check the server.

### Available tools

| Tool | Purpose |
|---|---|
| `get_planning_guide` | Guidance for flexible dates, budgets, split stays and multiple destinations |
| `search_hotels` | Find hotels by text, city or coordinates, with indicative prices |
| `get_hotel` | Read static hotel details, facilities, policies and photos |
| `get_rates` | Get live rooms, rates, meal plans and cancellation terms |
| `create_booking` | Create or resume an unpaid order and return its payment link |

Example request: "Find hotels in Bangkok for November 10–12, 2026, for two
adults. Compare live rates including breakfast and free cancellation."

For flexible plans, call `get_planning_guide` first. Search prices are
indicative; use `get_rates` for live quotes. After the user selects a rate,
collect the required guest details and call `create_booking`. Show the
returned amount, currency and booking terms, and get the user's confirmation
before sharing the payment link. The user completes payment in their browser;
the MCP tool does not charge a card. These tools do not modify or cancel
existing bookings.

### Troubleshooting and support

- A `401` response before OAuth sign-in is expected. Authenticate through
  your client rather than copying a CLI token into MCP headers.
- If OAuth registration or the callback fails, check your client's MCP logs
  and report the client name, version and error at
  [GitHub Issues](https://github.com/FortripEngineering/fortrip-cli/issues).
  Do not include tokens, guest details or payment links.
- If your client cannot perform MCP OAuth, use the CLI or agent skill below.

Client setup references: [Claude Code](https://code.claude.com/docs/en/mcp),
[Cursor](https://prod.cursor.com/help/customization/mcp),
[Codex](https://developers.openai.com/codex/mcp).

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

The repository is also a Claude Code plugin
([`.claude-plugin/plugin.json`](.claude-plugin/plugin.json)). Claude Code keeps
users on the `version` it names, so bump that version whenever `SKILL.md`
changes.

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

## License

The code and documentation in this repository are licensed under the
[MIT License](LICENSE). This license does not grant access to the hosted
Fortrip service, hotel inventory, or third-party data.
