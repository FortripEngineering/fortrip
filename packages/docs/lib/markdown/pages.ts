// The Markdown of the generated pages: a command's (rendered by
// `CommandPage`) and an operation's (rendered by Fumadocs OpenAPI, then
// `OperationSurfaces`). Each is built from the data its page shows.
import { ORDER_HTTP, PUBLIC_ORIGINS, type ToolName } from "@fortrip/agent-contract";
import type { PhrasingContent } from "mdast";

import { answers, OPERATIONS } from "../openapi/build.ts";
import { contentSentence, SURFACE_HEADINGS, toolSentence } from "../prose/mcp-content.ts";
import { inputAnchor } from "../reference/api-docs.ts";
import { CLI_COMMANDS, type CliCommand } from "../reference/cli-commands.ts";
import { MCP_TOOLS } from "../reference/mcp-tools.ts";
import { responseDocForCommand, schemaHref, schemaTitle } from "../reference/response-docs.ts";
import {
  type Block,
  blockquote,
  code,
  codeBlock,
  codeList,
  heading,
  inline,
  joined,
  link,
  list,
  paragraph,
  strong,
  table,
  text,
} from "./mdast.ts";
import { toMarkdown } from "./stringify.ts";
import { fields } from "./widgets.ts";

/** The label of the block that quotes a tool's description verbatim. */
export const MODEL_READS = "What the model reads (tool description)";

/** A tool's description, verbatim, under its label. */
export function modelReads(description: string): Block[] {
  return [paragraph([strong(text(MODEL_READS))]), blockquote([paragraph(inline(description))])];
}

/** A command's usage, how it works, options and output, as `CommandBody`
 *  lays them out: each part under its heading on a command's own page, one
 *  after another in an operation's CLI section. */
function commandBlocks(command: CliCommand, headings: boolean): Block[] {
  const title = (id: string, label: string): Block[] => (headings ? [heading(2, [text(label)], id)] : []);
  return [
    ...title("usage", "Usage"),
    codeBlock(null, command.usage),
    ...(command.how ? [...title("how", "How it works"), ...command.how.map((p) => paragraph(inline(p)))] : []),
    ...(command.flags
      ? [
          ...title("options", "Options"),
          table(
            ["Flag", "Field", "Description"],
            command.flags.map(([flag, field, description]) => ({
              cells: [[code(flag)], [field ? code(field) : text("—")], inline(description)],
            })),
          ),
        ]
      : []),
    ...title("output", "Output"),
    paragraph([
      ...inline(command.output),
      ...(command.schema
        ? [
            // An operation's page shows the object above, under its responses.
            ...(headings
              ? [text(" The JSON is the "), link(command.schema.href, text(command.schema.title)), text(" object.")]
              : []),
            text(" Errors go to stderr with an "),
            link("/errors#exit-codes", text("exit code")),
            text("."),
          ]
        : []),
    ]),
  ];
}

/** The page body of a command that calls no operation, as `CommandPage` lays it out. */
export function commandMarkdown(slug: string): string {
  const command = CLI_COMMANDS.find((c) => c.slug === slug);
  if (!command) throw new Error(`${slug} has no docs page`);
  return toMarkdown(commandBlocks(command, true));
}

/** The sections that end an operation's page, as `OperationSurfaces` lays
 *  them out: the MCP tool and the CLI command that take the same input. */
function surfaceBlocks(name: ToolName): Block[] {
  const tool = MCP_TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`${name} has no docs page`);
  const command = CLI_COMMANDS.find((c) => c.slug === tool.cliSlug);
  return [
    heading(2, [text(SURFACE_HEADINGS.mcp)], "mcp"),
    paragraph(inline(toolSentence(tool.name, tool.access))),
    paragraph([
      ...inline(contentSentence(tool.name)),
      text(" Errors are described in the "),
      link("/mcp#errors", text("MCP overview")),
      text("."),
    ]),
    ...(command ? [heading(2, [text(SURFACE_HEADINGS.cli)], "cli"), ...commandBlocks(command, false)] : []),
  ];
}

/** An operation page's body, as the page shows it: the operation's tool
 *  description, route, input and answers, then its MCP tool and its CLI
 *  command. Its short summary heads the page; `/openapi.json` has the whole
 *  schema. */
export function operationMarkdown(id: string): string {
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
          response ? link(schemaHref(response), text(schemaTitle(response))) : text(endpoint.title),
          ...(op.id === "create_order" && status === String(ORDER_HTTP.replayedStatus)
            ? [text(", with "), code(`${ORDER_HTTP.replayedHeader}: true`)]
            : []),
        ];
  const blocks: Block[] = [
    // As `SurfaceLinks` writes it.
    ...(tool
      ? [paragraph([text("MCP: "), link("#mcp", code(tool.name)), text(" · CLI: "), link("#cli", code(tool.cli))])]
      : []),
    ...(tool ? modelReads(tool.summary) : []),
    paragraph([code(`${route.method} ${route.path}`), text(" on "), code(PUBLIC_ORIGINS.api)]),
    paragraph(
      endpoint.auth
        ? [text("Needs an access token: see "), link("/api#authentication", text("Authentication")), text(".")]
        : [text("Needs no sign-in.")],
    ),
  ];
  if (tool) {
    blocks.push(
      heading(2, [text("Input")], inputAnchor(route)),
      ...(where.length > 0 ? [paragraph([...joined(where, "; "), text(".")])] : []),
      fields(`input:${tool.name}`),
    );
  }
  blocks.push(
    heading(2, [text("Responses")], "responses"),
    list(Object.keys(answers(op)).map(answer)),
    paragraph([text("The schema of every request and response: "), link("/openapi.json", code("/openapi.json")), text(".")]),
    ...(tool ? surfaceBlocks(tool.name) : []),
  );
  return toMarkdown(blocks);
}
