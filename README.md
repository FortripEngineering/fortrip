# Fortrip

Fortrip's public agent surface in one repository: the `fortrip` command-line
tool for hotel search and booking, and the store listings that point agents at
Fortrip.

## Layout

| Path | What it is | How it's published |
|---|---|---|
| `packages/contract` | The agent API contract (coming) | npm: `@fortrip/agent-contract` |
| [`packages/cli`](packages/cli) | The `fortrip` CLI and its agent guide (`fortrip skill`) | npm: `fortrip`, from a `v*` tag on `main` |
| [`plugins/claude`](plugins/claude) | Claude plugin (hosted MCP server + static skill) | Submitted in the [developer portal](https://claude.ai/directory/manage); `.claude-plugin/marketplace.json` at the root lets Claude Code add this repo as a marketplace |
| [`plugins/openai`](plugins/openai) | ChatGPT / Codex plugin | Zip uploaded in the OpenAI portal |
| [`plugins/registry`](plugins/registry) | [MCP Registry](https://registry.modelcontextprotocol.io) entry | The **Publish Fortrip to MCP Registry** workflow |
| [`skills/fortrip-cli`](skills/fortrip-cli) | Skill for agents with a shell | `npx skills add FortripEngineering/fortrip --skill fortrip-cli` reads it from `main` |
| `scripts` | Repo-wide scripts, such as `validate.mjs` | |

## Development

Node.js 22 or newer and [pnpm](https://pnpm.io) 11.

```bash
pnpm install
pnpm test       # tests of every package
pnpm validate   # checks the store listings
```

`pnpm typecheck` and `pnpm build` run for every package too. CI also runs
`claude plugin validate --strict` on `.`, `plugins/claude` and `skills`.

## License

[MIT](LICENSE). This license does not grant access to the hosted Fortrip
service, hotel inventory, or third-party data.
