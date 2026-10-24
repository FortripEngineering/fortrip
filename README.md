# Fortrip

Fortrip's public agent surface in one repository: the `fortrip` command-line
tool for hotel search, live offers and orders, the contract that every agent
surface shares, and the store listings that point agents at Fortrip. Hotels
only for now.

Everything here talks to Fortrip API v1, `https://api.fortrip.ai/v1`, or to the
hosted MCP server, `https://mcp.fortrip.ai/`, as a Fortrip user who has signed
in with OAuth in the browser.

## Using Fortrip

- **From a shell, or an agent with one:** `npx -y fortrip <command>`. Start
  with `npx -y fortrip login`; the [CLI's README](packages/cli/README.md) has
  the commands, sign-in and exit codes.
- **In an MCP client:** connect the hosted server `https://mcp.fortrip.ai/`
  if the client supports remote servers with OAuth, or run the local bridge,
  `npx -y fortrip mcp`. The [CLI's README](packages/cli/README.md#mcp-server)
  has the config for Claude Desktop, Cursor, Codex and Claude Code. The Claude
  and OpenAI plugins use the hosted server.
- **As a skill, for agents that can run shell commands but don't have
  Fortrip's MCP tools:**

  ```bash
  npx skills add FortripEngineering/fortrip --skill fortrip-cli
  ```

## Layout

| Path | What it is | How it's published |
|---|---|---|
| [`packages/contract`](packages/contract) | The contract of Fortrip API v1: limits, paths, request and response schemas, error codes, field rules, the specs of the MCP tools and CLI commands, and the agent guide, written once and rendered for the MCP server, the Claude skill and the CLI | npm: `@fortrip/agent-contract`, from a `v*` tag on `main`, together with `fortrip` |
| [`packages/cli`](packages/cli) | The `fortrip` CLI: hotel search, live offers, orders and payment links from a shell, the local MCP bridge (`fortrip mcp`) and the agent guide (`fortrip guide`) | npm: `fortrip`, from a `v*` tag on `main`, together with `@fortrip/agent-contract` |
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

`pnpm typecheck` and `pnpm build` run for every package too. CI runs
typecheck, tests and the build on Node.js 22 and 24, and on 24 also
`pnpm generate --check`, `pnpm validate` and `claude plugin validate --strict`
on `.`, `plugins/claude` and `skills`.

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
`https://mcp.fortrip.ai/.well-known/openai-apps-challenge`, served by mcp.fortrip.ai.

### MCP Registry

`plugins/registry/server.json` lists Fortrip as
`io.github.FortripEngineering/fortrip`, with two ways to connect: the hosted
server (`remotes`) and the npm package `fortrip`, run as `fortrip mcp`
(`packages`; the `mcpName` in `packages/cli/package.json` must equal the
entry's name). The entry is published by its own workflow, **Publish Fortrip to
MCP Registry** (`.github/workflows/publish-mcp-registry.yml`), which runs only
from `main` and waits for a human to approve the `mcp-registry` environment.
To publish a change, bump `version` (a version can't go down), set
`packages[].version` to the CLI version on npm, merge to `main` and run the
workflow. After a CLI release, run it once npm has the new version.

To deprecate an old version, or make it active again, run **Set an MCP
Registry version's status** (`.github/workflows/mcp-registry-status.yml`)
with the version, the status and, when deprecating, a message (the publisher
takes none for `active`). It has the same `main`-only,
approval-gated setup. A personal `mcp-publisher login github` can't do this:
it only gets `io.github.<user>/*`, so the org namespace comes through this
repository's OIDC identity.

The Registry binds the server URL to one name, so a rename means deleting the
old entry before publishing the new one.

## Releasing

`fortrip` and `@fortrip/agent-contract` are released together, at the same
version.

1. In a PR, set `version` to the new `X.Y.Z` in both `packages/cli/package.json`
   and `packages/contract/package.json` (`npm version X.Y.Z --no-git-tag-version`
   in each package's directory), set `packages[].version` in
   `plugins/registry/server.json` to it too, and run `pnpm generate` and commit
   what it changes. Merge the PR into `main` once CI passes.
2. Tag the merge commit on `main` and push the tag:

   ```bash
   git checkout main && git pull
   git tag vX.Y.Z && git push origin vX.Y.Z
   ```

3. A human approves the `npm-publish` environment. The workflow
   [`publish.yml`](.github/workflows/publish.yml) then publishes both packages
   to npm through trusted publishing (npm's OIDC sign-in from GitHub Actions,
   so no npm token is stored in GitHub), which gives them provenance.
4. Once npm has the new version, run the MCP Registry workflow (above).

The workflow refuses a tag that isn't `vX.Y.Z` or `vX.Y.Z-rc.N`, that differs
from the `version` in either `package.json`, or that isn't on `main`. Its
`build` job runs typecheck, tests and the build and packs both tarballs; its
`publish` job, in the `npm-publish` environment, publishes those tarballs
(`@fortrip/agent-contract` first) without installing or building anything. A
release candidate, tagged `vX.Y.Z-rc.N`, is published under the `next`
dist-tag, so `npm install` doesn't pick it up. Rerunning the publish job after
a partial publish skips what is already on npm.

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
