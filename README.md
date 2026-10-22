# Fortrip

Fortrip's public agent surface in one repository: the `fortrip` command-line
tool for hotel search and booking, the contract that every agent surface
shares, and the store listings that point agents at Fortrip.

The Claude and OpenAI plugins both use the hosted MCP server,
`https://fortrip.ai/api/mcp`, which fortrip.ai serves. The `fortrip-cli` skill
is for agents that can run shell commands but don't have Fortrip's MCP tools.

## Layout

| Path | What it is | How it's published |
|---|---|---|
| [`packages/contract`](packages/contract) | The contract of the agent API (`/api/agent/v1`): limits, paths, input schemas, field rules, the specs of the MCP tools and CLI commands, and the agent guide, written once and rendered for the MCP server, the Claude skill and the CLI | npm: `@fortrip/agent-contract`, from a `v*` tag on `main`, together with `fortrip` |
| [`packages/cli`](packages/cli) | The `fortrip` CLI and its agent guide (`fortrip guide`) | npm: `fortrip`, from a `v*` tag on `main`, together with `@fortrip/agent-contract` |
| [`plugins/claude`](plugins/claude) | Claude plugin (hosted MCP server + static skill, generated) | Submitted in the [developer portal](https://claude.ai/directory/manage); `.claude-plugin/marketplace.json` at the root lets Claude Code add this repo as a marketplace |
| [`plugins/openai`](plugins/openai) | ChatGPT / Codex plugin | Zip uploaded in the OpenAI portal |
| [`plugins/registry`](plugins/registry) | [MCP Registry](https://registry.modelcontextprotocol.io) entry | The **Publish Fortrip to MCP Registry** workflow |
| [`skills/fortrip-cli`](skills/fortrip-cli) | Skill for agents with a shell (generated) | `npx skills add FortripEngineering/fortrip --skill fortrip-cli` reads it from `main` |
| `scripts` | Repo-wide scripts: `generate.ts` renders the skills, `validate.mjs` checks the listings | |

## Development

Node.js 22 or newer and [pnpm](https://pnpm.io) 11.

```bash
pnpm install
pnpm test             # tests of every package, and of the scripts
pnpm generate         # renders the skills from the contract
pnpm generate --check # fails with a diff when a generated file is stale
pnpm build && pnpm validate   # checks the store listings
```

`pnpm typecheck` and `pnpm build` run for every package too. CI also runs
`claude plugin validate --strict` on `.`, `plugins/claude` and `skills`.

## Generated files

The skills (`SKILL.md` and `references/planning.md` in
`plugins/claude/skills/fortrip` and `skills/fortrip-cli`) and the contract's
`src/guide-data.generated.ts` are generated. Never edit them: change the
guide's fragments in `packages/contract/guide/*.md` (or a skill's front
matter in `scripts/generate.ts`), run `pnpm generate` and commit the result.
The fragments say which surface states what, and the Claude skill, the MCP
instructions and the CLI's guide all render from them, so they cannot drift
apart.

## Publishing

### Claude plugin

`plugins/claude` is a plugin with two parts:

- `.mcp.json` points at the hosted MCP server. On claude.ai and in Cowork it
  shows up on the plugin's Connectors tab, where users sign in with their
  Fortrip account (OAuth); Claude Code connects to it directly.
- `skills/fortrip/` is the generated skill that tells Claude how to use the
  tools: call order, occupancy per room, prices and currency, confirming
  before the payment link, and errors. `references/planning.md` covers
  flexible dates, budgets, split stays and several destinations.

The skill is self-contained: the directory doesn't allow a plugin to fetch
instructions at runtime (Software Directory Policy §2F), and its validator
blocks unpinned `npx` launchers, so the CLI skill stays outside
`plugins/claude`. `pnpm validate` fails if a file under it mentions `npx`,
`fortrip@latest` or `get_planning_guide`.

Submit the `plugins/claude` folder in the
[developer portal](https://claude.ai/directory/manage). Check it with:

```bash
claude plugin validate --strict plugins/claude
claude plugin validate --strict .
```

The second command checks `.claude-plugin/marketplace.json` at the repository
root. It lists `plugins/claude` as a plugin, which lets `npx skills add` find
the plugin's skill next to `skills/fortrip-cli`, and lets Claude Code add this
repository as a marketplace.

Claude Code keeps users on the `version` in `plugin.json`, so bump it whenever
anything in `plugins/claude` changes, regenerated skill text included: patch
for wording, minor for new behaviour or components (1.1.0 moved the plugin to
the hosted MCP server), major for changes that break how people use it. The
directory takes the listing icon from the first submission only.

### CLI skill

`skills/fortrip-cli` is the CLI's guide as a static skill: the agent reads the
commands, call order, sign-in and what to show the user before a payment link
from the skill itself. It needs Node.js 22 or newer and isn't part of the
Claude directory plugin.

```bash
npx skills add FortripEngineering/fortrip --skill fortrip-cli
```

### OpenAI plugin

`plugins/openai/plugin.json` holds the listing copy and review test cases, and
`mcp.json` the hosted server URL. `mcp.json` follows the Agent Plugins schema
(`type: streamable-http`), while `plugins/claude/.mcp.json` follows Claude's
(`type: http`); both point at the same server. Build the upload:

```bash
cd plugins/openai && rm -f ../../fortrip-openai.zip && zip -rX ../../fortrip-openai.zip plugin.json mcp.json assets
```

Upload the zip in the OpenAI portal. The portal verifies the domain through
`https://fortrip.ai/.well-known/openai-apps-challenge`, served by fortrip.ai.

### MCP Registry

`plugins/registry/server.json` lists the hosted server as
`io.github.FortripEngineering/fortrip`. To publish a change, bump `version`,
merge to `main`, and run the **Publish Fortrip to MCP Registry** workflow
(`.github/workflows/publish-mcp-registry.yml`); it runs only from `main` and
waits for approval. The Registry binds the server URL to one name, so a rename
means deleting the old entry before publishing the new one.

## License

[MIT](LICENSE). This license does not grant access to the hosted Fortrip
service, hotel inventory, or third-party data.
