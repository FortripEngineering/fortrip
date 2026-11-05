// The Markdown of the generated pages: a tool's, a command's (rendered by
// `ToolPage` and `CommandPage`) and an API operation's (rendered by Fumadocs
// OpenAPI). Each is built from the data its page shows.
import { ORDER_HTTP, PUBLIC_ORIGINS, type ToolName } from "@fortrip/agent-contract";
import type { PhrasingContent } from "mdast";

import { answers, OPERATIONS } from "../openapi/build.ts";
import { contentSentence } from "../prose/mcp-content.ts";
import { CLI_COMMANDS } from "../reference/cli-commands.ts";
import { MCP_TOOLS } from "../reference/mcp-tools.ts";
import { responseDocFor, responseDocForCommand, schemaHref } from "../reference/response-docs.ts";
import {
  type Block,
  code,
  codeBlock,
  codeList,
  heading,
  inline,
  joined,
  link,
  list,
  paragraph,
  table,
  text,
} from "./mdast.ts";
import { toMarkdown } from "./stringify.ts";
import { fields } from "./widgets.ts";

/** A tool page's body, as `ToolPage` lays it out. */
export function toolMarkdown(name: ToolName): string {
  const tool = MCP_TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`${name} has no docs page`);
  const cli = CLI_COMMANDS.find((command) => command.slug === tool.cliSlug);
  const rest = tool.summary.slice(tool.snippet.length).trim();
  const output =
    typeof tool.returns === "string"
      ? [text(tool.returns)]
      : [
          code("structuredContent"),
          text(" is the "),
          link(tool.returns.href, text(tool.returns.title)),
          text(" object. "),
          ...inline(contentSentence(tool.name)),
          ...(responseDocFor(tool.name)?.mcpNextStep
            ? [text(" It also carries "), code("nextStep"), text(", the rule for sharing "), code("payment.url"), text(".")]
            : []),
          text(" Errors are described in the "),
          link("/mcp#results", text("overview")),
          text("."),
        ];
  return toMarkdown([
    ...(rest ? [paragraph(inline(rest))] : []),
    paragraph([
      code(tool.name),
      text(` · ${tool.access}`),
      ...(cli ? [text(" · CLI: "), link(`/cli/${cli.slug}`, code(tool.cli))] : []),
    ]),
    heading(2, [text("Input")], "input"),
    tool.name === "get_planning_guide" ? paragraph([text("None.")]) : fields(`input:${tool.name}`),
    heading(2, [text("Output")], "output"),
    paragraph(output),
  ]);
}

/** A command page's body, as `CommandPage` lays it out. */
export function commandMarkdown(slug: string): string {
  const command = CLI_COMMANDS.find((c) => c.slug === slug);
  if (!command) throw new Error(`${slug} has no docs page`);
  const mcp = MCP_TOOLS.find((tool) => tool.slug === command.mcp);
  return toMarkdown([
    ...(mcp ? [paragraph([text("MCP: "), link(`/mcp/${mcp.slug}`, code(mcp.name))])] : []),
    heading(2, [text("Usage")], "usage"),
    codeBlock(null, command.usage),
    ...(command.how
      ? [heading(2, [text("How it works")], "how"), ...command.how.map((p) => paragraph(inline(p)))]
      : []),
    ...(command.flags
      ? [
          heading(2, [text("Options")], "options"),
          table(
            ["Flag", "Field", "Description"],
            command.flags.map(([flag, field, description]) => ({
              cells: [[code(flag)], [field ? code(field) : text("—")], inline(description)],
            })),
          ),
        ]
      : []),
    heading(2, [text("Output")], "output"),
    paragraph(inline(command.output)),
    ...(command.schema
      ? [
          paragraph([
            text("The JSON is the "),
            link(command.schema.href, text(command.schema.title)),
            text(" object. Errors go to stderr with an "),
            link("/errors#exit-codes", text("exit code")),
            text("."),
          ]),
        ]
      : []),
  ]);
}

/** An API reference page's body: the operation's route, description, input
 *  and answers. The whole schema is in `/openapi.json`. The description is
 *  left out when it is the page's `description`, which heads the page. */
export function operationMarkdown(id: string, pageDescription?: string): string {
  const op = OPERATIONS.find((o) => o.id === id);
  if (!op) throw new Error(`${id} has no API reference page`);
  const { route, endpoint } = op;
  const tool = MCP_TOOLS.find((t) => t.name === endpoint.tool);
  const response = responseDocForCommand(endpoint.cliSlug);
  // "Path: `orderId`; the JSON body holds the rest", each part capitalized only first.
  const where: PhrasingContent[][] = [];
  const part = (label: string, rest: PhrasingContent[] = []) =>
    where.push([text(where.length === 0 ? label[0]!.toUpperCase() + label.slice(1) : label), ...rest]);
  if (route.pathFields.length > 0) part("path: ", codeList(route.pathFields));
  if (route.queryFields.length > 0) part("query: ", codeList(route.queryFields));
  if (route.method === "POST") part(where.length === 0 ? "the JSON body holds every field" : "the JSON body holds the rest");
  const answer = (status: string) =>
    status === "default"
      ? [code("default"), text(": the "), link("/errors", text("error envelope"))]
      : [
          code(status),
          text(": "),
          response ? link(schemaHref(response), text(response.title)) : text(endpoint.title),
          ...(op.id === "book_hotel" && status === String(ORDER_HTTP.replayedStatus)
            ? [text(", with "), code(`${ORDER_HTTP.replayedHeader}: true`)]
            : []),
        ];
  const blocks: Block[] = [
    paragraph([code(`${route.method} ${route.path}`), text(" on "), code(PUBLIC_ORIGINS.api)]),
    ...(op.description === pageDescription ? "" : (op.description ?? ""))
      .split(/\n\n+/)
      .filter(Boolean)
      .map((p) => paragraph(inline(p))),
    paragraph(
      endpoint.auth
        ? [text("Needs an access token: see "), link("/api#authentication", text("Authentication")), text(".")]
        : [text("Needs no sign-in.")],
    ),
  ];
  if (tool && tool.name !== "get_planning_guide") {
    blocks.push(
      heading(2, [text("Input")], "input"),
      paragraph([
        text("The input of the MCP tool "),
        link(`/mcp/${tool.slug}`, code(tool.name)),
        ...(where.length > 0 ? [text(". "), ...joined(where, "; ")] : []),
        text("."),
      ]),
      fields(`input:${tool.name}`),
    );
  }
  blocks.push(
    heading(2, [text("Responses")], "responses"),
    list(Object.keys(answers(op)).map(answer)),
    paragraph([text("The schema of every request and response: "), link("/openapi.json", code("/openapi.json")), text(".")]),
  );
  return toMarkdown(blocks);
}
