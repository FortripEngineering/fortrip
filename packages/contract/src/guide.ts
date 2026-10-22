import { COMMANDS, type CommandSpec } from "./commands.ts";
import { FRAGMENTS } from "./guide-data.generated.ts";
import { LIMITS, SUPPORT_EMAIL } from "./limits.ts";

/*
 * The guide for AI agents, written once as Markdown fragments in `guide/`
 * (inlined into `guide-data.generated.ts` by `scripts/embed-guide.ts`) and
 * rendered for each surface that states the rules:
 *
 * - `mcp`: the hosted MCP server. Its `main` is the server instructions, a
 *   condensed form; its `planning` is what `get_planning_guide` returns.
 * - `claude-skill`: the Claude plugin's skill and its planning reference.
 * - `cli`: what `fortrip guide [planning]` prints, and the CLI skill.
 *
 * In a fragment:
 *
 * - `{{tool:<command>}}` names a command's tool: `search_hotels` (mcp),
 *   `fortrip:search_hotels` (claude-skill), `fortrip search` (cli). It
 *   throws on a surface without that tool: the Claude plugin has no
 *   `get_planning_guide` (Directory Policy §2F), MCP has no `whoami`.
 * - `{{arg:<field>}}` names an input field: `rooms`, or the CLI's `--rooms`.
 * - `{{limit:<key>}}` is a number from `LIMITS`; `{{support}}` is the
 *   support address.
 * - `{{#if <surface> …}}…{{/if}}` keeps its text only on the surfaces it
 *   names, and nests. A tag alone on its line takes the line with it.
 *
 * Any other `{{…}}` throws, so a typo fails the tests instead of shipping.
 */

export type GuideSurface = "mcp" | "claude-skill" | "cli";
export type GuideTopic = "main" | "planning";

const SURFACES: readonly GuideSurface[] = ["mcp", "claude-skill", "cli"];

/** The fragments of each topic, in order. */
const TOPICS: Record<GuideTopic, readonly string[]> = {
  main: [
    "scope",
    "setup",
    "order",
    "occupancy",
    "prices",
    "meals",
    "booking",
    "payment-link",
    "errors",
    "support",
  ],
  planning: ["planning"],
};

/** The guide on `topic` as `surface` states it, in Markdown. */
export function renderGuide(surface: GuideSurface, topic: GuideTopic): string {
  if (!Object.hasOwn(TOPICS, topic)) {
    throw new Error(`Unknown guide topic "${topic}"`);
  }
  const parts = TOPICS[topic].map((name) => {
    const fragment = FRAGMENTS[name];
    if (fragment === undefined) {
      throw new Error(`Missing guide fragment "${name}"`);
    }
    return renderText(fragment, surface).trim();
  });
  const text = parts.filter(Boolean).join("\n\n");
  return `${text.replace(/\n{3,}/g, "\n\n")}\n`;
}

const TOKEN = /{{([^{}]*)}}/g;
const CONDITION = /{{#if ([^{}]*)}}|{{\/if}}/g;
/** A condition tag with nothing else on its line. */
const LONE_CONDITION = /^[ \t]*({{#if [^{}\n]*}}|{{\/if}})[ \t]*\n/gm;

/** One fragment's text as `surface` states it. */
export function renderText(text: string, surface: GuideSurface): string {
  if (!SURFACES.includes(surface)) {
    throw new Error(`Unknown guide surface "${surface}"`);
  }
  // Every token must mean something, whether `surface` shows it or not.
  for (const [token, body] of text.matchAll(TOKEN)) {
    if (!/^(#if |\/if$)/.test(body ?? "")) resolve(token, surface, false);
  }
  const shown = select(text, surface).replace(TOKEN, (token) =>
    resolve(token, surface, true),
  );
  if (/{{|}}/.test(shown)) {
    throw new Error(`Unclosed guide token in: ${shown.slice(0, 200)}`);
  }
  return shown;
}

/** The text without the conditions that don't name `surface`. */
function select(text: string, surface: GuideSurface): string {
  const tagged = text.replace(LONE_CONDITION, "$1");
  const open: boolean[] = [];
  let out = "";
  let from = 0;
  for (const tag of tagged.matchAll(CONDITION)) {
    if (open.every(Boolean)) out += tagged.slice(from, tag.index);
    from = tag.index + tag[0].length;
    if (tag[1] === undefined) {
      if (open.pop() === undefined) {
        throw new Error("Guide has {{/if}} without {{#if}}");
      }
      continue;
    }
    const names = tag[1].trim().split(/\s+/);
    for (const name of names) {
      if (!SURFACES.includes(name as GuideSurface)) {
        throw new Error(`Unknown guide surface "${name}" in ${tag[0]}`);
      }
    }
    open.push(names.includes(surface));
  }
  if (open.length > 0) throw new Error("Guide has {{#if}} without {{/if}}");
  return out + tagged.slice(from);
}

/** What `token` reads as on `surface`. A token only being checked
 *  (`shown` false) may stand in a condition `surface` doesn't show. */
function resolve(token: string, surface: GuideSurface, shown: boolean): string {
  const body = token.slice(2, -2);
  if (body === "support") return SUPPORT_EMAIL;
  const [kind, name, ...rest] = body.split(":");
  if (name !== undefined && rest.length === 0) {
    if (kind === "limit" && Object.hasOwn(LIMITS, name)) {
      return String(LIMITS[name as keyof typeof LIMITS]);
    }
    if (kind === "tool") {
      const spec = COMMANDS.find((command) => command.name === name);
      if (spec) return shown ? toolName(spec, surface, token) : token;
    }
    if (kind === "arg") {
      const flags = new Set(
        COMMANDS.flatMap((command) => command.flags)
          .filter((flag) => flag.field === name)
          .map((flag) => flag.flag),
      );
      const [flag, ...others] = flags;
      if (flag !== undefined && others.length === 0) {
        return surface === "cli" ? `--${flag}` : name;
      }
    }
  }
  throw new Error(`Unknown guide token ${token}`);
}

function toolName(
  spec: CommandSpec,
  surface: GuideSurface,
  token: string,
): string {
  if (surface === "cli") return `fortrip ${spec.name}`;
  // The Claude plugin ships the planning guide as a file instead.
  if (
    spec.tool === null ||
    (surface === "claude-skill" && spec.tool === "get_planning_guide")
  ) {
    throw new Error(`Guide token ${token} has no tool on ${surface}`);
  }
  return surface === "mcp" ? spec.tool : `fortrip:${spec.tool}`;
}
