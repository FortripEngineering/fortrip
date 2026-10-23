# fortrip

Search hotels, check live room rates and book with a payment link, from the
terminal or an AI agent. Hotels only for now. The npm package and the command
are both `fortrip`.

```bash
npx -y fortrip login
npx -y fortrip hotels search --query Bangkok --check-in 2026-11-10 --check-out 2026-11-12
```

## Install and run

Node.js 22 or newer. Run it with `npx`, which needs no install:

```bash
npx -y fortrip <command>
```

or install it once and run `fortrip <command>`:

```bash
npm install --global fortrip
```

`fortrip --help` lists the commands, `fortrip hotels --help` the hotel
commands, `fortrip <command> --help` one command's flags, and
`fortrip --version` prints the version.

Upgrading from 0.3: 1.0 signs in with OAuth, so a 0.3 sign-in is not reused;
run `fortrip login` once. A `FORTRIP_TOKEN` from 0.3 is no longer accepted.
`fortrip mcp` replaces the separate `fortrip-mcp` package.

## Upgrading from 1.x

2.0 puts the hotel commands under `fortrip hotels`, with the same flags and
arguments:

| 1.x | 2.0 |
|---|---|
| `search` | `hotels search` |
| `hotel <hotelId>` | `hotels get <hotelId>` |
| `rates` | `hotels rates` |
| `book` | `hotels book` |

Two MCP tools are renamed: `get_rates` is now `get_hotel_rates` and
`create_booking` is now `book_hotel`. Sign-in and `fortrip mcp` are unchanged.

## Sign in

```bash
fortrip login
```

`login` prints a code and a link on stderr, opens the link in your browser
(not with `--no-browser`), and waits until you sign in to Fortrip and approve.
It then prints your account.

An AI agent can't sit in `login`, so any other command that needs a sign-in
doesn't wait: it exits with code 3 and prints `loginUrl`, `userCode` and
`expiresInSeconds` as JSON on stderr. The agent shows the link to the user;
once the user has approved it in the browser, the agent reruns the same
command, which finishes signing in and carries on. Commands that run in
parallel share one link. When Fortrip stops accepting the saved sign-in (it
was revoked, or it expired and couldn't be renewed), the command does the same
and keeps the old sign-in until the new link is approved.

You stay signed in. Access tokens last 24 hours and the CLI renews them
itself, before they run out; refresh tokens don't expire, so the sign-in lasts
until you run `fortrip logout`, which revokes this machine's sign-in and
deletes it (other machines stay signed in). `fortrip whoami` prints the
signed-in account.

The sign-in is saved in `~/.config/fortrip/credentials.json` (`$XDG_CONFIG_HOME`
is honoured), mode `0600`, per API URL, so a token is only sent to the server
that issued it.

If a new or renewed sign-in can't be saved (the file stays busy or turns out to
be damaged), the `hotels` commands and `whoami` still work for that run, with
the new token. The sign-in is kept in a `credentials.recovered-*.json`
file next to the credentials file, and the command's JSON output carries a
`warning` and, when the sign-in could be kept, that file in `recoveryFile`.
Later commands use it, and the next successful save merges it back. `login`
doesn't carry on in that case: it exits 1, with `recoveryFile` in the error, and
the sign-in is kept in that file all the same.

If the directory itself can't be written (a read-only home, as in some agent
sandboxes), `login` exits 1 before it asks you to approve anything, and any
other command that needs to save a sign-in exits 1 too. The error says to set
`XDG_CONFIG_HOME` to a directory that can be written, or to set `FORTRIP_TOKEN`.

## Commands

| Command | What it does |
|---|---|
| `hotels search` | Find hotels with indicative prices |
| `hotels get <hotelId>` | Static hotel detail: description, policies, facilities and photos |
| `hotels rates` | Live rooms and rates for up to 15 hotels |
| `hotels book` | Create an order and get a payment link |
| `login` | Sign in through the browser (device code) |
| `logout` | Revoke and forget the saved token |
| `whoami` | Show the signed-in account |
| `guide [topic]` | Print the guide for AI agents (Markdown) |
| `mcp` | Run an MCP server over stdio for local clients, bridged to Fortrip's hosted server |

```bash
fortrip hotels rates --hotel <hotelId> --check-in 2026-11-10 --check-out 2026-11-12 --rooms 1 --adults 2
```

`hotels search`, `hotels rates` and `hotels book` also accept `--body '<json>'`
or `--body @file.json` with the raw request body; flags override its fields.

`--adults` and `--child-age` are per room, and every room has the same
occupancy: 2 rooms for 4 adults is `--rooms 2 --adults 2`. `hotels rates` and
`hotels book` both require `--rooms` and `--adults`.

`hotels book` creates an unpaid order and prints a payment link for it.
Nothing is charged until the person pays on the page the link opens.

## For AI agents

```bash
npx -y fortrip guide            # when to use the CLI, call order, sign-in, what to show before a payment link
npx -y fortrip guide planning   # flexible dates, budgets, split stays, several destinations
```

Both print Markdown, with `fortrip@latest` replaced by the running version, so
an agent keeps using the same CLI for the whole conversation. The guide is
written once in
[`@fortrip/agent-contract`](https://github.com/FortripEngineering/fortrip/tree/main/packages/contract/guide)
and compiled into the CLI.

For agents that can run shell commands, the same guide is also a skill:

```bash
npx skills add FortripEngineering/fortrip --skill fortrip-cli
```

## MCP server

`fortrip mcp` runs an MCP server on stdio for clients that start local
servers. It forwards to Fortrip's hosted MCP server, `https://fortrip.ai/api/mcp`,
with your saved sign-in. Sign in once with `npx -y fortrip login` before you
add the server to a client.

If the client starts the server before you have, the server fails to connect:
its first request, `initialize`, is answered with a JSON-RPC error (`-32001`)
whose message says to run `npx -y fortrip login` in a terminal, or to open the
sign-in link it names and approve it. Clients typically close the connection
after a failed `initialize`, so sign in (or approve that link), then restart the
server or reconnect it (`/mcp` in Claude Code). If a sign-in stops working
later, only the request that hit it fails with the same kind of error, and the
server keeps running.

Claude Desktop (Settings, Developer, Edit Config; on macOS
`~/Library/Application Support/Claude/claude_desktop_config.json`, on Windows
`%APPDATA%\Claude\claude_desktop_config.json`) and Cursor (`~/.cursor/mcp.json`,
or `.cursor/mcp.json` in a project):

```json
{
  "mcpServers": {
    "fortrip": {
      "command": "npx",
      "args": ["-y", "fortrip", "mcp"]
    }
  }
}
```

Claude Code:

```bash
claude mcp add fortrip -- npx -y fortrip mcp
```

Codex, with `codex mcp add fortrip -- npx -y fortrip mcp` or in
`~/.codex/config.toml`:

```toml
[mcp_servers.fortrip]
command = "npx"
args = ["-y", "fortrip", "mcp"]
```

Clients that support remote MCP servers with OAuth don't need the CLI: add
`https://fortrip.ai/api/mcp` as a remote server and sign in to Fortrip in the
browser when the client asks. In Claude Code, that is
`claude mcp add --transport http fortrip https://fortrip.ai/api/mcp`.

## Environment variables

| Variable | Meaning |
|---|---|
| `FORTRIP_TOKEN` | An access token, used instead of the saved sign-in. It lasts at most 24 hours, so it suits one sandbox session or one CI run, not standing CI. It isn't tied to a server: it is sent to whatever `FORTRIP_API_URL` points at. If Fortrip doesn't accept it, or it contains a line break or another character that can't be sent in a header, commands exit 3 with `tokenSource: "FORTRIP_TOKEN"` and no `loginUrl`; the error never repeats the token. |
| `FORTRIP_API_URL` | The base URL (default `https://fortrip.ai`). Plain `http` is only accepted for `localhost`. |
| `FORTRIP_CURRENCY` | The default `--currency` for `hotels search` and `hotels rates` (`CNY` or `USD`; the API uses `CNY` when nothing sets one). It only changes how prices are shown: `hotels book` charges the currency it returns. |

## Output and exit codes

Data commands (the `hotels` commands, `login`, `logout` and `whoami`) print
JSON on stdout. `guide` prints Markdown, and `fortrip mcp`
speaks MCP over stdio. Errors are JSON on stderr, with an `error` message, the
`exitCode` and any details.

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Other error (`retryable: true` on stderr: worth one retry) |
| 2 | Invalid arguments (local or HTTP 400) |
| 3 | Not signed in, or the sign-in wasn't accepted (HTTP 401); `loginUrl` on stderr |
| 4 | Rate limited (HTTP 429; `retryAfterSeconds` on stderr) |

## Support

For changes, cancellations, refunds or other help with a booking, email
[info@fortrip.ai](mailto:info@fortrip.ai) with the booking's order link
(`orderUrl`).

## Releasing

Both packages in this repository, `fortrip` and `@fortrip/agent-contract`,
are released together from a `vX.Y.Z` tag. See
[Releasing](https://github.com/FortripEngineering/fortrip#releasing) in the
repository's README.

## License

The code and documentation in this repository are licensed under the
[MIT License](https://github.com/FortripEngineering/fortrip/blob/main/LICENSE).
This license does not grant access to the hosted Fortrip service, hotel
inventory, or third-party data.
