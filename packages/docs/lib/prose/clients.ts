import { MCP_SERVER_URL, REPOSITORY_URL } from "@fortrip/agent-contract";

import marketplace from "../../../../.claude-plugin/marketplace.json" with { type: "json" };
import registry from "../../../../plugins/registry/server.json" with { type: "json" };
import { fact } from "../../components/fact.tsx";

export const CLIENT_IDS = ["codex", "claude-code", "cursor", "claude-desktop", "claude-ai", "chatgpt"] as const;
export type ClientId = (typeof CLIENT_IDS)[number];

export interface ClientSetup {
  name: string;
  /** What to run, paste or type: `null` when there is nothing to copy. */
  code: { lang: "sh" | "json" | "text"; text: string } | null;
  steps: string[];
  note?: string;
}

/** `FortripEngineering/fortrip`, the repository the Claude Code marketplace is in. */
const repo = new URL(REPOSITORY_URL).pathname.slice(1);
const plugin = `${marketplace.plugins[0]?.name}@${marketplace.name}`;

/**
 * How to connect each client. Menu paths were checked against the vendors'
 * docs where they could be (claude.ai and Claude Desktop: support.claude.com
 * "custom connectors using remote MCP", 2026-11-06, which has custom
 * connectors on both, under Customize → Connectors, configured through the
 * Claude account; the Desktop bridge: modelcontextprotocol.io "connect local
 * servers"; Codex: `codex mcp add --url` / `codex mcp login` in openai/codex;
 * Claude Code: code.claude.com `/mcp`; ChatGPT: developers.openai.com
 * "developer mode", where a tool without `readOnlyHint` is a write action
 * the user confirms). ChatGPT's and Cursor's current menus couldn't be
 * confirmed, so their steps name no menu path.
 */
export const CLIENT_SETUP: Record<ClientId, ClientSetup> = {
  codex: {
    name: "Codex",
    code: { lang: "sh", text: `codex mcp add fortrip --url ${MCP_SERVER_URL}\ncodex mcp login fortrip` },
    steps: [
      "Run the first command to add the server.",
      "Run the second and approve access in your browser.",
      "Start a new conversation and ask for a stay.",
    ],
  },
  "claude-code": {
    name: "Claude Code",
    code: { lang: "sh", text: `claude plugin marketplace add ${repo}\nclaude plugin install ${plugin}` },
    steps: [
      "Run both commands. The plugin adds this server and Fortrip's skill.",
      "Start a new session, run `/mcp` and sign in to Fortrip in your browser.",
      "Ask for a stay.",
    ],
    note: `To add only the server, run \`claude mcp add --transport http fortrip ${MCP_SERVER_URL}\`.`,
  },
  cursor: {
    name: "Cursor",
    code: { lang: "json", text: JSON.stringify({ mcpServers: { fortrip: { url: MCP_SERVER_URL } } }, null, 2) },
    steps: [
      "Add this to `.cursor/mcp.json` in your project, or to `~/.cursor/mcp.json` for every project.",
      "Open Cursor's MCP settings and sign in to Fortrip in your browser when Cursor asks.",
      "Enable Fortrip's tools, then ask for a stay in Agent mode.",
    ],
  },
  "claude-desktop": {
    name: "Claude Desktop",
    code: { lang: "text", text: MCP_SERVER_URL },
    steps: [
      "The same as claude.ai: go to Customize → Connectors, click + Add, then Add custom connector.",
      "Name it Fortrip, enter this URL and click Continue. Keep the detected sign-in settings (OAuth) and click Add.",
      "Connect Fortrip, sign in to Fortrip in your browser and ask for a stay.",
    ],
    note: `Connectors are set up through your Claude account. Without custom connectors, run the [local bridge](#local-mcp) instead: sign in with \`npx -y fortrip login\` (Node.js ${fact("CLI_NODE_MAJOR")} or newer), add the bridge to \`claude_desktop_config.json\` (Settings, then Developer → Edit Config), and restart Claude Desktop.`,
  },
  "claude-ai": {
    name: "claude.ai",
    code: { lang: "text", text: MCP_SERVER_URL },
    steps: [
      "Go to Customize → Connectors, click + Add, then Add custom connector.",
      "Name it Fortrip, enter this URL and click Continue. Keep the detected sign-in settings (OAuth) and click Add.",
      "Connect Fortrip, sign in to Fortrip in your browser and ask for a stay.",
    ],
    note: "On Team and Enterprise plans, an Owner adds the connector under Organization settings → Connectors (Add, then Custom → Web); members then connect it from Customize → Connectors.",
  },
  chatgpt: {
    name: "ChatGPT",
    code: { lang: "text", text: MCP_SERVER_URL },
    steps: [
      "In ChatGPT's settings, turn on developer mode. On a workspace, an admin may need to allow it.",
      "Create an app with this URL and OAuth authentication, and sign in to Fortrip in your browser when ChatGPT asks.",
      "Turn the app on in a conversation and ask for a stay.",
    ],
    note: "ChatGPT asks you to approve each action that creates, pays or cancels an order.",
  },
};

/** The MCP Registry entry, by the name in `plugins/registry/server.json`. */
export const MCP_REGISTRY = {
  name: registry.name,
  url: `https://registry.modelcontextprotocol.io/v0.1/servers?search=${encodeURIComponent(registry.name)}&version=latest`,
  glamaUrl: `https://glama.ai/mcp/connectors/${registry.name}`,
};
