# Maintaining this repository

How the packages, the listings and the docs in this repository are generated,
published and released.

## Layout

| Path | What it is | How it's published |
|---|---|---|
| [`packages/contract`](packages/contract) | The contract of Fortrip API v1: limits, paths, request and response schemas, error codes, field rules, the specs of the MCP tools and CLI commands, and the agent guide, written once and rendered for the MCP server, the Claude skill and the CLI | npm: `@fortrip/agent-contract`, from a `v*` tag on `main`, together with `fortrip` |
| [`packages/cli`](packages/cli) | The `fortrip` CLI: hotel search, live offers, orders and payment links from a shell, the local MCP bridge (`fortrip mcp`) | npm: `fortrip`, from a `v*` tag on `main`, together with `@fortrip/agent-contract` |
| [`plugins/claude`](plugins/claude) | Claude plugin (hosted MCP server + static skill, generated) | Submitted in the [developer portal](https://claude.ai/directory/manage); `.claude-plugin/marketplace.json` at the root lets Claude Code add this repo as a marketplace |
| [`plugins/openai`](plugins/openai) | ChatGPT / Codex plugin | Zip uploaded in the OpenAI portal |
| [`plugins/workbuddy`](plugins/workbuddy) | [WorkBuddy](https://open.workbuddy.cn) connector (hosted MCP server + skill, generated) | Zip uploaded in the WorkBuddy open platform |
| [`plugins/registry`](plugins/registry) | [MCP Registry](https://registry.modelcontextprotocol.io) entry | The **Publish Fortrip to MCP Registry** workflow |
| [`skills/fortrip-cli`](skills/fortrip-cli) | Skill for agents with a shell (generated) | `npx skills add FortripEngineering/fortrip --skill fortrip-cli` reads it from `main` |
| `scripts` | Repo-wide scripts: `generate.ts` renders the skills, `validate.mjs` checks the listings | |

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
for wording, minor for new behaviour or components, major for changes that
break how people use it. The directory takes the listing icon from the first
submission only.

### CLI skill

`skills/fortrip-cli` is the CLI's guide as a static skill: the agent reads the
commands, call order, sign-in and what to show the user before a payment link
from the skill itself. It needs Node.js 22 or newer and isn't part of the
Claude directory plugin.

```bash
npx skills add FortripEngineering/fortrip --skill fortrip-cli
```

### OpenAI plugin

`plugins/openai/plugin.json` holds the listing copy and review test cases,
`mcp.json` the hosted server URL and how a client signs in to it (OAuth, the
client registered by its metadata document), and `skills/fortrip` the
generated skill. `mcp.json` follows the Agent Plugins schema
(`type: streamable-http`) but for the server's `extensions`, where OpenAI's
packaging guide puts the sign-in declaration, while `plugins/claude/.mcp.json` follows Claude's
(`type: http`); both point at the same server. Build the upload:

```bash
cd plugins/openai && rm -f ../../fortrip-openai.zip && zip -rX ../../fortrip-openai.zip plugin.json mcp.json assets skills
```

Upload the zip in the OpenAI portal. The portal verifies the domain through
`https://mcp.fortrip.ai/.well-known/openai-apps-challenge`, served by mcp.fortrip.ai.

### WorkBuddy connector

`plugins/workbuddy` is a connector for the [WorkBuddy open platform](https://open.workbuddy.cn/docs/connector),
in its "MCP + Skill" form: `connector-meta.json` holds the listing copy in
Chinese and English and how a user signs in (WorkBuddy's cloud registers
itself with our authorization server and holds the tokens), `mcp.json` the
hosted server, `icon.png` the icon and `skills/fortrip` the generated skill.
The package holds no client ID or secret. Build the upload:

```bash
git archive --format=zip --prefix=fortrip/ -o fortrip-workbuddy.zip HEAD:plugins/workbuddy
```

Raise `version` in `connector-meta.json` with every upload.

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

## Docs

[`packages/docs`](packages/docs) is the Fumadocs site behind `docs.fortrip.ai`.

```bash
pnpm --filter ./packages/docs dev   # local dev server
pnpm --filter ./packages/docs test  # its tests
```

Production docs follow the live server, not `main`. A docs deploy is a
`docs-*` tag, and the order is:

1. Tag `vX.Y.Z` (npm, see Releasing above).
2. Ship the server release that pins that contract to production.
3. Push the tag `docs-X.Y.Z`.
4. A human approves the `docs-production` environment. The workflow
   [`deploy-docs.yml`](.github/workflows/deploy-docs.yml) then builds and
   deploys to Vercel.

The workflow refuses to deploy unless all of these hold at the tagged commit:

- the contract's version is a plain `X.Y.Z`, not an rc;
- `packages/contract/src` is unchanged since the tag `vX.Y.Z` of that version;
- the changelog has the version's entry, dated, and no entry says "Not
  released yet.".

The tag name itself is free-form. So once `main` has moved on from the live
release (contract changes, or a new undated changelog entry), a docs deploy
can't go out from `main`: cut a short branch from the live `v*` tag, make the
docs-only fix there, tag `docs-X.Y.Z-<n>` on that branch and push the tag,
and also merge the fix to `main`. A docs-only fix needs no npm release and no
changelog entry.

Before tagging a stable release, replace the version's "Not released yet." with
"Released YYYY-MM-DD." in `packages/docs/content/docs/changelog.mdx`, or the
changelog gate fails.

One-time setup, by the owner:

- A Vercel project with Root Directory `packages/docs`, framework Next.js,
  "Include files outside the root directory" left on (the build reads
  `packages/contract` and `packages/cli/package.json`) and preview
  deployments on. [`packages/docs/vercel.json`](packages/docs/vercel.json)
  turns off Git deployments of `main`: production would otherwise follow
  `main` and skip the approval. Other branches still get previews. On the
  first real run, confirm a push to `main` creates no production deployment.
  Importing the project deploys `main` once anyway; the first `docs-*` deploy
  replaces it.
- The `docs.fortrip.ai` domain on that project, and Vercel Analytics enabled.
- The GitHub environment `docs-production`, with the same required reviewers
  as `npm-publish` ("Prevent self-review" off, as there, so whoever pushes the
  tag can approve), deployment branches and tags limited to the tag pattern
  `docs-*`, and the secrets `VERCEL_TOKEN`, `VERCEL_ORG_ID` and
  `VERCEL_PROJECT_ID`.
- On the first deploy, confirm `vercel build` succeeds without
  `VERCEL_TOKEN`: the workflow gives the token only to `vercel pull` and
  `vercel deploy`, since the build runs the dependencies' code.
