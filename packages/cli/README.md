# fortrip

Search hotels, compare live rates, book and pay securely, and cancel
bookings, from the terminal or an AI agent. Hotels only for now. The npm package and the command
are both `fortrip`; they talk to Fortrip API v1, `https://api.fortrip.ai/v1`.

```bash
npx -y fortrip login
npx -y fortrip hotels search --place-name Bangkok --country TH --check-in 2026-11-10 --check-out 2026-11-12 --room 2
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

## Sign in

```bash
fortrip login
```

`login` prints a code and a link on stderr, opens the link in your browser
(not with `--no-browser`), and waits until you sign in to Fortrip and approve.
It then prints your account.

An AI agent can't sit in `login`, so any other command that needs a sign-in
doesn't wait: it exits with code 3 and prints `loginUrl`, `userCode` and
`expiresInSeconds` on stderr (as `name: value` lines, or beside the error with
`--json`). The agent shows the link to the user; once the user has approved it
in the browser, the agent reruns the same command, which finishes signing in
and carries on. Commands that run in parallel share one link. When Fortrip
stops accepting the saved sign-in (it was revoked, or it expired and couldn't
be renewed), the command does the same and keeps the old sign-in until the new
link is approved.

You stay signed in. Access tokens are short-lived and the CLI renews them
itself, before they run out; refresh tokens don't expire, so the sign-in lasts
until you run `fortrip logout`, which revokes this machine's sign-in and
deletes it (other machines stay signed in). When Fortrip can't be reached, or
no longer takes this version of the CLI, `logout` deletes the sign-in all the
same and warns that it was not revoked. `fortrip whoami` prints the signed-in
account.

The sign-in is saved in `~/.config/fortrip/credentials.json` (`$XDG_CONFIG_HOME`
is honoured), mode `0600`, per API URL, so a token is only sent to the server
that issued it.

If a new or renewed sign-in can't be saved (the file stays busy or turns out to
be damaged), the `hotels` and `orders` commands and `whoami` still work for that
run, with the new token. The sign-in is kept in a `credentials.recovered-*.json`
file next to the credentials file, and the command's output carries a
`warning` and, when the sign-in could be kept, that file in `recoveryFile`
(as lines after the result, or as fields of the JSON with `--json`). Later
commands use it, and the next successful save merges it back. `login` doesn't
carry on in that case: it exits 1, with `recoveryFile` in the error, and the
sign-in is kept in that file all the same.

If the directory itself can't be written (a read-only home, as in some remote
agent environments), `login` exits 1 before it asks you to approve anything, and any
other command that needs to save a sign-in exits 1 too. The error says to set
`XDG_CONFIG_HOME` to a directory that can be written, or to set `FORTRIP_TOKEN`.

## Commands

| Command | What it does |
|---|---|
| `hotels search` | Find hotels in a place, near a point or by name, with indicative prices |
| `hotels get <hotelId>` | Hotel details: description, policies, amenities and room types |
| `hotels offers` | Live bookable offers for up to 15 hotels |
| `orders create` | Create an unpaid order for an offer, with a payment link |
| `orders get <orderId>` | Show an order and its status |
| `orders list` | List your orders, newest first |
| `orders cancel <orderId>` | Cancel a paid order under its terms (--max-penalty), or close an unpaid one (--close) |
| `orders pay <orderId>` | Pay an order with a Link token (US and Canada), instead of its payment link |
| `login` | Sign in through the browser |
| `logout` | Revoke and forget the saved token |
| `whoami` | Show the signed-in account |
| `mcp` | Run an MCP server over stdio for local clients, bridged to Fortrip's hosted server |

```bash
fortrip hotels search --place-name Tokyo --country JP --check-in 2026-11-10 --check-out 2026-11-12 --room 2
fortrip hotels offers --hotel <hotelId> --check-in 2026-11-10 --check-out 2026-11-12 --room 2 --room 2
```

`hotels search`, `hotels offers` and `orders create` also accept `--body '<json>'`
or `--body @file.json` with the raw request body; flags override its fields.

`--room` gives one room's party, as `adults` or `adults:age,age` with each
child's age, and is repeated for each room: two rooms of 2 adults, one with a
child of 6, is `--room 2 --room 2:6`. `hotels search` accepts rooms that
differ; `hotels offers` takes one party per call, so every room must be the
same.

`orders create` creates an unpaid order and prints a payment link for it.
Nothing is charged until the person pays on the page the link opens, or
approves a shared payment token for `orders pay` in their wallet. Orders
are paid in the currency of the offers they come from (`--currency`).

`orders get` and `orders list` say of each order whether it can be cancelled
now and, if so, the penalty under its terms and the refund.
`orders cancel <orderId> --max-penalty <amount>` cancels it, with the penalty
the person agreed to exactly as shown; if the penalty has gone up since,
nothing changes and the command exits 1 with `cancellation_changed`. An
unpaid order is closed instead, once the person says they no longer want it:
`orders cancel <orderId> --close` closes it, nothing is charged, and it
becomes `expired`. Without `--max-penalty` or `--close` it changes nothing:
it prints the order's penalty and refund, or that it can be closed, and
exits 2.

## For AI agents

The agent guide is written once in
[`@fortrip/agent-contract`](https://github.com/FortripEngineering/fortrip/tree/main/packages/contract/guide)
and ships as a skill, with the planning guide as `references/planning.md`:

```bash
npx skills add FortripEngineering/fortrip --skill fortrip-cli
```

## MCP server

Fortrip's hosted MCP server is `https://mcp.fortrip.ai/`. It has eight tools:
`search_hotels`, `get_hotel`, `get_hotel_offers`,
`create_order`, `get_order`, `list_orders`, `cancel_order` and `pay_order`.

Clients that support remote MCP servers with OAuth don't need the CLI: add
`https://mcp.fortrip.ai/` as a remote server and sign in to Fortrip in the
browser when the client asks. In Claude Code, that is
`claude mcp add --transport http fortrip https://mcp.fortrip.ai/`.

Clients that start local servers can run the CLI as a bridge. `fortrip mcp`
runs an MCP server on stdio that forwards to the hosted server with your saved
sign-in.

A tool's result is one block of text, the same from the bridge as from the
hosted server; an error is a tool error (`isError: true`) whose one block of
text says what happened and what to do next, with Fortrip's error envelope in
`_meta["ai.fortrip/error"]`. For the JSON of a result, use a command with
`--json`.

You can add the bridge to a client before you sign in: signed out, it still
starts and lists its tools. A tool call is then answered with a tool error
(`isError: true`, code `unauthenticated`) whose text says to run
`npx -y fortrip login` in a terminal, or to open the sign-in link it names and
approve it. Once you have, the next tool call works, with no restart. If a
sign-in stops working later, only the request that hit it fails, the same way
for a tool call; any other request that hits a sign-in problem gets the
JSON-RPC error `-32001` instead. The server keeps running.

When this version of the CLI is too old for Fortrip, a tool call is answered
with the tool error `client_outdated`, whose text says so and gives the
command that updates the CLI. Update it, then restart the server in your
client.

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

## Environment variables

| Variable | Meaning |
|---|---|
| `FORTRIP_TOKEN` | An access token, used instead of the saved sign-in. It is short-lived, so it suits a remote agent environment or a CI run; for longer, sign in. It isn't tied to a server: it is sent to whatever `FORTRIP_API_URL` points at. If Fortrip doesn't accept it, or it contains a line break or another character that can't be sent in a header, commands exit 3 with `tokenSource: "FORTRIP_TOKEN"` and no `loginUrl`; the error never repeats the token. |
| `FORTRIP_API_URL` | The API's base URL (default `https://api.fortrip.ai`). It must be `https`, except for `localhost`, `127.0.0.1` and `[::1]`, which may use plain `http`. It may end in a path prefix (`http://localhost:3000/api/public`), which every request path follows; a query or fragment is dropped. |
| `FORTRIP_MCP_URL` | The MCP server `fortrip mcp` bridges to (default `https://mcp.fortrip.ai/`), under the same URL rule. Your sign-in is sent to it, so it must be the MCP server of the API you use: on the origin of `FORTRIP_API_URL`, except that the default API goes with the default MCP server, `api.fortrip.ai` and `mcp.fortrip.ai`. When you set `FORTRIP_API_URL` to a local or preview API, set `FORTRIP_MCP_URL` too; `fortrip mcp` exits 2 and says so when you don't. |
| `FORTRIP_CURRENCY` | The default `--currency` for `hotels search` and `hotels offers` (`USD` or `CNY`). Prices are in this currency, and an order made from the offers is paid in it. |

## Output and exit codes

A command prints its result as compact text on stdout, the same text the MCP
tools return. With `--json` (anywhere before `--`) it prints the API's JSON
instead, on one line. `fortrip mcp` speaks MCP over stdio.

Errors go to stderr, as text, or with `--json` as one line of JSON:
`{ "error": { "code", "message", "retryable", "requestId", … } }`, Fortrip's
error envelope, with the CLI's own facts (`loginUrl`, `tokenSource`, `warning`)
beside it. An error the CLI makes itself, such as a request it refuses to send
before it asks Fortrip, has an envelope of the same shape, with a `requestId`
that starts with `local_`.

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Any other error, including the answers of the API that aren't mistakes in the request, such as `destination_ambiguous` or `offer_changed` (`retryable` says whether it is worth one retry) |
| 2 | Invalid arguments (local, or the API's `invalid_request`) |
| 3 | Not signed in, or the sign-in wasn't accepted; `loginUrl` on stderr |
| 4 | Rate limited (`retryAfterSeconds` on stderr) |
| 5 | This version of the CLI is too old for Fortrip (`client_outdated`): stderr is Fortrip's message, with the command that updates the CLI. Update it, then run the command again |

## Support

A cancellation the CLI can make goes through `fortrip orders cancel`. For
changes, other cancellations, refunds or other help with a booking, email
[info@fortrip.ai](mailto:info@fortrip.ai) with the order's reference. Never
send the payment link.

## Releasing

Both packages in this repository, `fortrip` and `@fortrip/agent-contract`,
are released together from a `vX.Y.Z` tag. See
[Releasing](https://github.com/FortripEngineering/fortrip#releasing) in the
repository's README.

## License

The code and documentation in this repository are licensed under the
[Apache License 2.0](https://github.com/FortripEngineering/fortrip/blob/main/LICENSE).
Copyright 2026 FortripAI, Inc. Versions before 2.0.0 were published under the
MIT License. This license does not grant access to the hosted Fortrip service,
hotel inventory, or third-party data.

"Fortrip" and the Fortrip logo are trademarks of FortripAI, Inc. The license
does not grant permission to use the trade names, trademarks, service marks or
product names of FortripAI, Inc., except as required for reasonable and
customary use in describing the origin of the software and reproducing the
content of the NOTICE file (section 6).
