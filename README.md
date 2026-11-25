<p align="center">
  <a href="https://fortrip.ai/agents">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset=".github/assets/fortrip-logo-white.svg">
      <img src="packages/docs/public/fortrip-logo.svg" alt="Fortrip" width="280">
    </picture>
  </a>
</p>

<h3 align="center">Hotel booking for AI agents</h3>

<p align="center">
  Search hotels, compare live rates, book and cancel,<br>
  from Claude, ChatGPT, Codex, Cursor or your own agent.
</p>

<p align="center">
  <a href="https://docs.fortrip.ai"><strong>Docs</strong></a> ·
  <a href="https://docs.fortrip.ai/quickstart">Quickstart</a> ·
  <a href="https://docs.fortrip.ai/api">HTTP API</a> ·
  <a href="https://docs.fortrip.ai/mcp">MCP server</a> ·
  <a href="https://docs.fortrip.ai/cli">CLI</a> ·
  <a href="https://docs.fortrip.ai/changelog">Changelog</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/fortrip"><img src="https://img.shields.io/npm/v/fortrip?label=fortrip" alt="fortrip on npm"></a>
  <a href="https://github.com/FortripEngineering/fortrip/actions/workflows/ci.yml"><img src="https://github.com/FortripEngineering/fortrip/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="Apache License 2.0"></a>
  <img src="https://img.shields.io/node/v/fortrip" alt="Node.js 22 or newer">
</p>

## What an agent can do

- **Search** hotels in a city, region or country, near a place, or by name or brand.
- **Price** a stay with live offers: the room, the meals, the total, fees paid at the hotel and the cancellation terms.
- **Book** an offer. The user reviews the terms and pays on Fortrip's payment page: the agent never sees a card.
- **Follow** the order until the hotel confirms, cancel it under its terms, and list past orders.

Hotels only for now. Every way to connect signs in with a Fortrip account, by OAuth in the browser, and returns the same data.

## Get started

| You use | Set it up |
|---|---|
| **claude.ai, Claude Desktop, ChatGPT** | Add `https://mcp.fortrip.ai/` as a connector and sign in to Fortrip. Steps for [claude.ai](https://docs.fortrip.ai/install#claude-ai), [Claude Desktop](https://docs.fortrip.ai/install#claude-desktop) and [ChatGPT](https://docs.fortrip.ai/install#chatgpt). |
| **Claude Code** | `claude plugin marketplace add FortripEngineering/fortrip`, then `claude plugin install fortrip@fortrip`. |
| **Codex, Cursor, other MCP clients** | Connect the hosted server, `https://mcp.fortrip.ai/`. Steps for [Codex](https://docs.fortrip.ai/install#codex) and [Cursor](https://docs.fortrip.ai/install#cursor). A client that only starts local servers runs `npx -y fortrip mcp`. |
| **Any agent with a shell** | `npx skills add FortripEngineering/fortrip --skill fortrip-cli` |
| **A terminal** | `npx -y fortrip login`, then `npx -y fortrip hotels search`. See the [CLI's README](packages/cli/README.md). |
| **Your own code** | The [HTTP API](https://docs.fortrip.ai/api-quickstart): sign in, search, get offers and create an order in five steps. |

Then ask your agent for a stay:

> Find a quiet hotel in Kyoto for two adults, two nights next month, with free cancellation.

## How a booking works

1. The agent searches, then gets live offers for the hotels the user likes.
2. It creates an order for one offer. Nothing is charged.
3. It shows the user the total, the stay and every term, and waits for a yes.
4. The user pays on the order's payment link.
5. The agent follows the order until the hotel confirms.

[Orders and payment](https://docs.fortrip.ai/payments) has the whole flow, with cancelling.

## In this repository

| Path | What it is |
|---|---|
| [`packages/cli`](packages/cli) | The `fortrip` command-line tool, and the local MCP bridge, `fortrip mcp`. On npm as [`fortrip`](https://www.npmjs.com/package/fortrip). |
| [`packages/contract`](packages/contract) | The contract every surface shares: schemas, limits, error codes, the specs of the MCP tools and CLI commands, and the agent guide. On npm as [`@fortrip/agent-contract`](https://www.npmjs.com/package/@fortrip/agent-contract). |
| [`packages/docs`](packages/docs) | The site at [docs.fortrip.ai](https://docs.fortrip.ai). |
| [`plugins`](plugins) | The listings for Claude, ChatGPT and Codex, WorkBuddy and the MCP Registry. |
| [`skills/fortrip-cli`](skills/fortrip-cli) | The skill for agents with a shell. |

## Development

Node.js 22 or newer and [pnpm](https://pnpm.io) 11.

```bash
pnpm install
pnpm test             # tests of every package, and of the scripts
pnpm generate         # renders the skills from the contract
pnpm generate --check # fails with a diff when a generated file is stale
pnpm build && pnpm validate   # checks the store listings
```

`pnpm typecheck` and `pnpm build` run for every package too. CI runs
typecheck, tests and the build on Node.js 22 and 24, and on 24 also
`pnpm generate --check`, `pnpm validate` and `claude plugin validate --strict`
on `.`, `plugins/claude` and `skills`.

Publishing the listings, releasing to npm and deploying the docs are in
[MAINTAINING.md](MAINTAINING.md).

## Support

For help with a booking, email [support@fortrip.ai](mailto:support@fortrip.ai)
with the order's reference. Never send the payment link. The
[FAQ](https://docs.fortrip.ai/faq) answers common questions.

## License

[Apache License 2.0](LICENSE). Copyright 2026 FortripAI, Inc. (see
[NOTICE](NOTICE)). Releases before 2.0.0 were published under the MIT License.
This license does not grant access to the hosted Fortrip service, hotel
inventory, or third-party data.

## Trademarks

"Fortrip" and the Fortrip logo are trademarks of FortripAI, Inc. The Apache
License 2.0 does not grant permission to use the trade names, trademarks,
service marks or product names of FortripAI, Inc., except as required for
reasonable and customary use in describing the origin of the software and
reproducing the content of the NOTICE file (section 6).
