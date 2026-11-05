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
  /** The page's description (meta, header, cards, llms.txt): the first
   *  sentence of `summary`, or the docs' own when that runs past 200
   *  characters. The OpenAPI page of the tool's endpoint shares it. */
  snippet: string;
  /** What the page body shows of `summary`: all of it but the opening
   *  sentence the description already says. */
  rest: string;
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
  { group: string; access: string; returns?: string; cliArgs?: string; snippet?: string }
> = {
  search_hotels: { group: "Hotels", access: "Read-only" },
  get_hotel: { group: "Hotels", access: "Read-only" },
  get_hotel_offers: { group: "Hotels", access: "Read-only" },
  book_hotel: { group: "Orders", access: "Creates an unpaid order" },
  get_order: { group: "Orders", access: "Read-only" },
  list_orders: { group: "Orders", access: "Read-only" },
  cancel_order: {
    group: "Orders",
    access: "Cancels an order",
    snippet: "Cancel one of the user's orders under its cancellation terms, when its cancel.available is true.",
  },
  pay_order: { group: "Orders", access: "Pays an order" },
  get_planning_guide: {
    group: "Guides",
    access: "Read-only",
    returns:
      "A Markdown guide. It says what to ask the user, which results count as evidence, and how to rank and present options.",
    cliArgs: "planning",
    snippet:
      "Returns Fortrip's planning guide for a request that is more than one hotel for fixed dates: what to ask, what counts as evidence, how to rank and present options.",
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
    const { group, access, returns, cliArgs, snippet = firstSentence(tool.description) } = DOCS[name];
    const response = responseDocFor(name);
    if (!response && !returns) throw new Error(`${name}: what does it return?`);
    return {
      slug: name.replaceAll("_", "-"),
      name,
      title: tool.title,
      group,
      summary: tool.description,
      snippet,
      rest: tool.description.startsWith(snippet)
        ? tool.description.slice(snippet.length).trim()
        : tool.description,
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
