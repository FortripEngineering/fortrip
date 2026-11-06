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
  /** What the tool does for a person, and what it changes, in plain text:
   *  the page's description (meta, header, cards, llms.txt), before the
   *  description the model reads. The API reference page of the tool's
   *  endpoint shares it. */
  human: string;
  readOnly: boolean;
  /** What a call does: "Read-only", or what it writes. */
  access: string;
  /** The matching CLI command as typed: `fortrip hotels offers`. */
  cli: string;
  /** The slug of that command's page. */
  cliSlug: string;
  /** The response schema, or a description when there is none. */
  /** The response schema. */
  returns: { title: string; href: string };
}

/** What the contract doesn't say about a tool: where the docs list it. The keys are in docs order,
 *  and a tool added to the contract fails the typecheck until it is listed. */
const DOCS: Record<
  ToolName,
  { group: string; access: string; human: string }
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
    human:
      "Cancels the user's booking under its cancellation terms, once they agree to the penalty and refund. The hotel booking is cancelled and the refund is issued.",
  },
  pay_order: {
    group: "Orders",
    access: "Pays an order",
    human:
      "Pays an order with a Link token (a shared payment token from the user's Stripe Link wallet), or opens an Alipay or WeChat Pay payment. A payment link needs no call.",
  },
};

export const MCP_TOOLS: McpTool[] = (Object.keys(DOCS) as ToolName[]).map(
  (name) => {
    const tool = TOOLS.find((spec) => spec.name === name);
    const command = COMMANDS.find((spec) => spec.tool === name);
    if (!tool || !command) {
      throw new Error(`${name} is not in the contract's TOOLS and COMMANDS`);
    }
    const { group, access, human } = DOCS[name];
    const response = responseDocFor(name);
    if (!response) throw new Error(`${name}: what does it return?`);
    return {
      slug: name.replaceAll("_", "-"),
      name,
      title: tool.title,
      group,
      summary: tool.description,
      human,
      readOnly: tool.annotations.readOnlyHint,
      access,
      cli: commandInvocation(command),
      cliSlug: commandSlug(command),
      returns: { title: schemaTitle(response), href: schemaHref(response) },
    };
  },
);
