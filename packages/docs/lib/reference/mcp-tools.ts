import {
  COMMANDS,
  commandInvocation,
  TOOLS,
  type ToolName,
} from "@fortrip/agent-contract";
import { commandSlug } from "./cli-commands.ts";
import { responseDocFor, schemaHref, schemaTitle } from "./response-docs.ts";

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
  /** What the tool does for a person, and what it changes: the page's
   *  opening, before the description the model reads. */
  human: string;
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
  { group: string; access: string; human: string; returns?: string; cliArgs?: string; snippet?: string }
> = {
  search_hotels: {
    group: "Hotels",
    access: "Read-only",
    human:
      "Finds hotels in a place, around a point, in a country or by name, with an indicative price when you give dates. It only reads: nothing is booked or held.",
  },
  get_hotel: {
    group: "Hotels",
    access: "Read-only",
    human:
      "Shows one hotel's details: address, check-in and check-out times, description, policies, amenities and, on request, its rooms. It only reads, and has no prices.",
  },
  get_hotel_offers: {
    group: "Hotels",
    access: "Read-only",
    human:
      "Gets the live, bookable offers for one stay at the hotels you name: the total, meals, cancellation terms and confirmation of each. It only reads: nothing is booked or held.",
  },
  book_hotel: {
    group: "Orders",
    access: "Creates an unpaid order",
    human:
      "Creates an order from one offer, with the guests and a contact. Nothing is charged: the order waits for the user to pay it, by its payment link or another way.",
  },
  get_order: {
    group: "Orders",
    access: "Read-only",
    human: "Shows one of the user's orders: its status, payment, stay and terms. It only reads.",
  },
  list_orders: {
    group: "Orders",
    access: "Read-only",
    human: "Lists the user's orders, newest first, a page at a time. It only reads.",
  },
  cancel_order: {
    group: "Orders",
    access: "Cancels an order",
    snippet: "Cancel one of the user's orders under its cancellation terms, when its cancel.available is true.",
    human:
      "Cancels the user's booking under its cancellation terms, once they agree to the penalty and refund. The hotel booking is cancelled and the refund is issued.",
  },
  pay_order: {
    group: "Orders",
    access: "Pays an order",
    human:
      "Pays an order with a Link token, a shared payment token from the user's Stripe Link wallet, or opens an Alipay or WeChat Pay payment for the user. A payment link needs no call: the user opens the order's `payment.url`.",
  },
  get_planning_guide: {
    group: "Guides",
    access: "Read-only",
    human: "Returns the guide an agent follows when a request is more than one hotel for fixed dates. It only reads.",
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
    const { group, access, human, returns, cliArgs, snippet = firstSentence(tool.description) } = DOCS[name];
    const response = responseDocFor(name);
    if (!response && !returns) throw new Error(`${name}: what does it return?`);
    return {
      slug: name.replaceAll("_", "-"),
      name,
      title: tool.title,
      group,
      summary: tool.description,
      snippet,
      human,
      readOnly: tool.annotations.readOnlyHint,
      access,
      cli: cliArgs
        ? `${commandInvocation(command)} ${cliArgs}`
        : commandInvocation(command),
      cliSlug: commandSlug(command),
      returns: response
        ? { title: schemaTitle(response), href: schemaHref(response) }
        : (returns as string),
    };
  },
);
