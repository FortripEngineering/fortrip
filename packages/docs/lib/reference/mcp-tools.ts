import {
  COMMANDS,
  commandInvocation,
  TOOLS,
  type ToolName,
} from "@fortrip/agent-contract";
import { commandSlug } from "./cli-commands.ts";
import { responseDocFor, schemaHref } from "./response-docs.ts";

export interface McpTool {
  slug: string;
  name: ToolName;
  title: string;
  group: string;
  /** The contract's description of the tool, as the model reads it. */
  summary: string;
  /** Its first sentence, short enough for a meta description. */
  snippet: string;
  readOnly: boolean;
  /** What a call does: "Read-only", or what it writes. */
  access: string;
  /** The matching CLI command as typed: `fortrip hotels offers`. */
  cli: string;
  /** The slug of that command's page. */
  cliSlug: string;
  /** The response schema, or a description when there is none. */
  returns: { title: string; href: string } | string;
}

/** What the contract doesn't say about a tool: where the docs list it, and
 *  what a tool without an output schema returns. The keys are in docs order,
 *  and a tool added to the contract fails the typecheck until it is listed. */
const DOCS: Record<
  ToolName,
  { group: string; access: string; returns?: string; cliArgs?: string }
> = {
  search_hotels: { group: "Hotels", access: "Read-only" },
  get_hotel: { group: "Hotels", access: "Read-only" },
  get_hotel_offers: { group: "Hotels", access: "Read-only" },
  book_hotel: { group: "Orders", access: "Creates an unpaid order" },
  get_order: { group: "Orders", access: "Read-only" },
  list_orders: { group: "Orders", access: "Read-only" },
  cancel_order: { group: "Orders", access: "Cancels an order" },
  pay_order: { group: "Orders", access: "Pays an order" },
  get_planning_guide: {
    group: "Guides",
    access: "Read-only",
    returns:
      "A Markdown guide. It says what to ask the user, which results count as evidence, and how to rank and present options.",
    cliArgs: "planning",
  },
};

const firstSentence = (text: string) =>
  /^.*?[.!?](?=\s|$)/s.exec(text)?.[0] ?? text;

export const MCP_TOOLS: McpTool[] = (Object.keys(DOCS) as ToolName[]).map(
  (name) => {
    const tool = TOOLS.find((spec) => spec.name === name);
    const command = COMMANDS.find((spec) => spec.tool === name);
    if (!tool || !command) {
      throw new Error(`${name} is not in the contract's TOOLS and COMMANDS`);
    }
    const { group, access, returns, cliArgs } = DOCS[name];
    const response = responseDocFor(name);
    if (!response && !returns) throw new Error(`${name}: what does it return?`);
    return {
      slug: name.replaceAll("_", "-"),
      name,
      title: tool.title,
      group,
      summary: tool.description,
      snippet: firstSentence(tool.description),
      readOnly: tool.annotations.readOnlyHint,
      access,
      cli: cliArgs
        ? `${commandInvocation(command)} ${cliArgs}`
        : commandInvocation(command),
      cliSlug: commandSlug(command),
      returns: response
        ? { title: response.title, href: schemaHref(response) }
        : (returns as string),
    };
  },
);
