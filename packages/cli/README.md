# fortrip

Search hotels, check live offers and order one with a payment link, from the
terminal or an AI agent. Hotels only for now. The npm package and the command
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

## Upgrading from 2.x

3.0 moves the CLI to Fortrip API v1. A 2.x CLI and the 2.x MCP server stop
working when 3.0 is released, so upgrade the CLI and, if you added it, the
hosted MCP server's address (see [MCP server](#mcp-server)).

- **Sign in again.** The CLI keeps one sign-in per API URL. 2.x saved yours
  under `https://fortrip.ai`; 3.0's API is `https://api.fortrip.ai`, so run
  `fortrip login` once. The old sign-in is not revoked and is left in the file;
  `fortrip logout` removes only the new one.
- **`hotels rates` is now `hotels offers`.** It prices up to 15 hotels with
  live, bookable offers. `hotels book` orders an offer by its `offerId`
  (`--offer`), and the guests are given per room (`--guest room:first:last`),
  instead of by room and rate plan. `hotels search`, `hotels get`, `login`,
  `logout`, `whoami`, `guide` and `mcp` keep their names; `orders get` and
  `orders list` are new.
- **Flags changed with the API.** Run `fortrip <command> --help` for the flags
  of 3.0; these are the 2.x ones that moved.
  - Search: `--query` and `--city-code` are replaced by `--place-name` with its
    `--country` (or `--place`, `--locality`, `--point`, `--country-only`);
    `--text` matches a hotel name, brand or area. `--near` is
    `--point lat,lng` with `--radius-meters` (meters, where `--near` took km). `--star-min` and `--star-max`
    are `--stars-min` and `--stars-max`, `--facility` is `--amenity` and
    `--price-max` is `--price-max-per-room-night`. `--price-min` and the short `-q` are gone.
  - Paging: `--page` and `--page-size` are not renamed but replaced. Results
    are paged with a cursor: pass the `nextCursor` of the previous page to
    `--cursor`, and set the page size with `--limit`. There is no page number.
  - Rooms: `--rooms`, `--adults` and `--child-age` are replaced by
    `--room <adults[:age,…]>`, once per room, in `hotels search` and
    `hotels offers`. `hotels book` no longer takes the stay at all: the offer
    carries it.
  - `hotels get`: `--with-rooms` is `--rooms`.
  - `hotels offers` (was `hotels rates`): `--board` is `--require-breakfast`,
    `--free-cancellation` is `--require-free-cancellation`, and `--max-rooms`
    (rooms per hotel) is `--limit-per-hotel` (offers per hotel, 5 by default).
    `--nationality` and `--include-unbookable` are gone.
  - `hotels book`: `--hotel`, `--room-id` and `--rate-plan` are replaced by
    `--offer`, the `offerId` from `hotels offers`. `--guest "First Last:2"` is
    `--guest 2:First:Last` (room, first name, last name). `--contact-name` is
    `--first-name` and `--last-name`, `--contact-phone` is `--phone` and
    `--contact-email` is `--email`.
  - `--currency` is `--display-currency`, which only changes the currency
    prices are shown in: orders are paid in USD.
  - Ids are strings (`htl_…`, `off_…`, `ord_…`, `plc_…`) that you pass back as
    they were returned.
- **New output.** A result is compact text by default, written for people and
  for models; `--json` prints the API's JSON instead (see
  [Output and exit codes](#output-and-exit-codes)). 2.x printed JSON.
- **New environment names.** `FORTRIP_CURRENCY` is now
  `FORTRIP_DISPLAY_CURRENCY`, and the default `FORTRIP_API_URL` is
  `https://api.fortrip.ai`. `FORTRIP_MCP_URL` is new. See
  [Environment variables](#environment-variables).
- **MCP.** The hosted MCP server is `https://mcp.fortrip.ai/`; its address on
  `fortrip.ai` is retired. `get_hotel_rates` is now `get_hotel_offers`, and
  `get_order` and `list_orders` are new.

Commands of 1.x and earlier that were renamed (`hotel`, `rates`) are answered
with the command to type instead.

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

You stay signed in. Access tokens last 24 hours and the CLI renews them
itself, before they run out; refresh tokens don't expire, so the sign-in lasts
until you run `fortrip logout`, which revokes this machine's sign-in and
deletes it (other machines stay signed in). `fortrip whoami` prints the
signed-in account.

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

If the directory itself can't be written (a read-only home, as in some agent
sandboxes), `login` exits 1 before it asks you to approve anything, and any
other command that needs to save a sign-in exits 1 too. The error says to set
`XDG_CONFIG_HOME` to a directory that can be written, or to set `FORTRIP_TOKEN`.

## Commands

| Command | What it does |
|---|---|
| `hotels search` | Find hotels in a place, near a point or by name, with indicative prices |
| `hotels get <hotelId>` | Hotel details: description, policies, amenities and rooms |
| `hotels offers` | Live bookable offers for up to 15 hotels |
| `hotels book` | Order an offer: an unpaid order with a payment link |
| `orders get <orderId>` | Show an order and its status |
| `orders list` | List your orders, newest first |
| `login` | Sign in through the browser (device code) |
| `logout` | Revoke and forget the saved token |
| `whoami` | Show the signed-in account |
| `guide [topic]` | Print the guide for AI agents (Markdown) |
| `mcp` | Run an MCP server over stdio for local clients, bridged to Fortrip's hosted server |

```bash
fortrip hotels search --place-name Tokyo --country JP --check-in 2026-11-10 --check-out 2026-11-12 --room 2
fortrip hotels offers --hotel <hotelId> --check-in 2026-11-10 --check-out 2026-11-12 --room 2 --room 2
```

`hotels search`, `hotels offers` and `hotels book` also accept `--body '<json>'`
or `--body @file.json` with the raw request body; flags override its fields.

`--room` gives one room's party, as `adults` or `adults:age,age` with each
child's age, and is repeated for each room: two rooms of 2 adults, one with a
child of 6, is `--room 2 --room 2:6`. `hotels search` accepts rooms that
differ; `hotels offers` takes one party per call, so every room must be the
same.

`hotels book` creates an unpaid order and prints a payment link for it.
Nothing is charged until the person pays on the page the link opens. Orders
are paid in USD whatever `--display-currency` shows.

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

Fortrip's hosted MCP server is `https://mcp.fortrip.ai/`. It has seven tools:
`get_planning_guide`, `search_hotels`, `get_hotel`, `get_hotel_offers`,
`book_hotel`, `get_order` and `list_orders`.

Clients that support remote MCP servers with OAuth don't need the CLI: add
`https://mcp.fortrip.ai/` as a remote server and sign in to Fortrip in the
browser when the client asks. In Claude Code, that is
`claude mcp add --transport http fortrip https://mcp.fortrip.ai/`.

Clients that start local servers can run the CLI as a bridge. `fortrip mcp`
runs an MCP server on stdio that forwards to the hosted server with your saved
sign-in.

You can add the bridge to a client before you sign in: signed out, it still
starts and lists its tools. A tool call is then answered with a tool error
(`isError: true`, code `unauthenticated`) whose message says to run
`npx -y fortrip login` in a terminal, or to open the sign-in link it names and
approve it. Once you have, the next tool call works, with no restart. If a
sign-in stops working later, only the request that hit it fails, the same way
for a tool call; any other request that hits a sign-in problem gets the
JSON-RPC error `-32001` instead. The server keeps running.

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
| `FORTRIP_TOKEN` | An access token, used instead of the saved sign-in. It lasts at most 24 hours, so it suits one sandbox session or one CI run, not standing CI. It isn't tied to a server: it is sent to whatever `FORTRIP_API_URL` points at. If Fortrip doesn't accept it, or it contains a line break or another character that can't be sent in a header, commands exit 3 with `tokenSource: "FORTRIP_TOKEN"` and no `loginUrl`; the error never repeats the token. |
| `FORTRIP_API_URL` | The API's base URL (default `https://api.fortrip.ai`). It must be `https`, except for `localhost`, `127.0.0.1` and `[::1]`, which may use plain `http`. It may end in a path prefix (`http://localhost:3000/api/public`), which every request path follows; a query or fragment is dropped. |
| `FORTRIP_MCP_URL` | The MCP server `fortrip mcp` bridges to (default `https://mcp.fortrip.ai/`), under the same URL rule. Your sign-in is sent to it, so it must be the MCP server of the API you use: on the origin of `FORTRIP_API_URL`, except that the default API goes with the default MCP server, `api.fortrip.ai` and `mcp.fortrip.ai`. When you set `FORTRIP_API_URL` to a local or preview API, set `FORTRIP_MCP_URL` too; `fortrip mcp` exits 2 and says so when you don't. |
| `FORTRIP_DISPLAY_CURRENCY` | The default `--display-currency` for `hotels search` and `hotels offers` (`USD` or `CNY`). It only changes the currency prices are shown in: orders are paid in USD. |

## Output and exit codes

A command prints its result as compact text on stdout, the same text the MCP
tools return. With `--json` (anywhere before `--`) it prints the API's JSON
instead, on one line. `guide` prints Markdown and `fortrip mcp` speaks MCP over
stdio.

Errors go to stderr, as text, or with `--json` as one line of JSON:
`{ "error": { "code", "message", "retryable", … } }`, Fortrip's error envelope,
with the CLI's own facts (`loginUrl`, `tokenSource`, `warning`) beside it. A
request the CLI refuses to send before it asks Fortrip has an envelope of the
same shape.

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Any other error, including the answers of the API that aren't mistakes in the request, such as `destination_ambiguous` or `offer_changed` (`retryable` says whether it is worth one retry) |
| 2 | Invalid arguments (local, or the API's `invalid_request`) |
| 3 | Not signed in, or the sign-in wasn't accepted; `loginUrl` on stderr |
| 4 | Rate limited (`retryAfterSeconds` on stderr) |

## Support

For changes, cancellations, refunds or other help with a booking, email
[info@fortrip.ai](mailto:info@fortrip.ai) with the order's reference or link.

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
