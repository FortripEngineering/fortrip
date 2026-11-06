import type { ToolName } from "@fortrip/agent-contract";
import { ServerCodeBlock } from "fumadocs-ui/components/codeblock.rsc";
import { Heading } from "fumadocs-ui/components/heading";
import Link from "next/link";
import type { ReactNode } from "react";

import { MODEL_READS } from "@/lib/markdown/pages.ts";
import { fieldRows } from "@/lib/markdown/widgets.ts";
import { contentSentence } from "@/lib/prose/mcp-content.ts";
import { CLI_COMMANDS } from "@/lib/reference/cli-commands.ts";
import { FieldTable, inline } from "@/lib/reference/field-table.tsx";
import { TOOL_INPUTS } from "@/lib/reference/input-docs.ts";
import { MCP_TOOLS } from "@/lib/reference/mcp-tools.ts";
import { responseDocFor } from "@/lib/reference/response-docs.ts";
import { inputRows } from "@/lib/reference/schema-rows.ts";

/** A table as Fumadocs renders one from Markdown: scrolls sideways when narrow. */
function Table({ head, children }: { head?: string[]; children: ReactNode }) {
  return (
    <div className="relative my-6 overflow-auto prose-no-margin">
      <table>
        {head && (
          <thead>
            <tr>
              {head.map((cell) => (
                <th key={cell}>{cell}</th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/** A tool's description, verbatim, under its label (`modelReads` is its Markdown). */
export function ModelReads({ description }: { description: string }) {
  return (
    <>
      <p>
        <strong>{MODEL_READS}</strong>
      </p>
      <blockquote>
        <p>{inline(description)}</p>
      </blockquote>
    </>
  );
}

/** A tool's page body, under its description (what it does for a person):
 *  the tool, its access and command, its description as the model reads it,
 *  input fields and output. */
export function ToolPage({ name }: { name: ToolName }) {
  const tool = MCP_TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`${name} has no docs page`);
  const input = tool.name === "get_planning_guide" ? null : TOOL_INPUTS[tool.name];
  const cli = CLI_COMMANDS.find((command) => command.slug === tool.cliSlug);
  const nextStep = responseDocFor(tool.name)?.mcpNextStep === true;
  return (
    <>
      <p className="text-sm text-fd-muted-foreground">
        <code>{tool.name}</code> · {tool.access}
        {cli && (
          <>
            {" "}
            · CLI:{" "}
            <Link href={`/cli/${cli.slug}`}>
              <code>{tool.cli}</code>
            </Link>
          </>
        )}
      </p>
      <ModelReads description={tool.summary} />
      <Heading as="h2" id="input">
        Input
      </Heading>
      {input ? <FieldTable rows={inputRows(input)} /> : <p>None.</p>}
      <Heading as="h2" id="output">
        Output
      </Heading>
      {typeof tool.returns === "string" ? (
        <p>{tool.returns}</p>
      ) : (
        <p>
          <code>structuredContent</code> is the{" "}
          <Link href={tool.returns.href}>{tool.returns.title}</Link> object. {inline(contentSentence(tool.name))}
          {nextStep && (
            <>
              {" "}
              It also carries <code>nextStep</code>, the rule for sharing <code>payment.url</code>.
            </>
          )}{" "}
          Errors are described in the <Link href="/mcp#errors">overview</Link>.
        </p>
      )}
    </>
  );
}

/** A command's page body: usage, options and output (its summary is the
 *  page's description). `path` is its page slug. */
export function CommandPage({ path }: { path: string }) {
  const command = CLI_COMMANDS.find((c) => c.slug === path);
  if (!command) throw new Error(`${path} has no docs page`);
  const mcp = MCP_TOOLS.find((tool) => tool.slug === command.mcp);
  return (
    <>
      {mcp && (
        <p className="text-sm text-fd-muted-foreground">
          MCP:{" "}
          <Link href={`/mcp/${mcp.slug}`}>
            <code>{mcp.name}</code>
          </Link>
        </p>
      )}
      <Heading as="h2" id="usage">
        Usage
      </Heading>
      {/* Highlighted like a Markdown block (its lines carry the padding), spaced like one. */}
      <ServerCodeBlock lang="text" code={command.usage} codeblock={{ className: "my-4" }} />
      {command.how && (
        <>
          <Heading as="h2" id="how">
            How it works
          </Heading>
          {command.how.map((paragraph) => (
            <p key={paragraph}>{inline(paragraph)}</p>
          ))}
        </>
      )}
      {command.flags && (
        <>
          <Heading as="h2" id="options">
            Options
          </Heading>
          <Table head={["Flag", "Field", "Description"]}>
            {command.flags.map(([flag, field, description]) => (
              <tr key={flag}>
                <td>
                  <code>{flag}</code>
                </td>
                <td>{field ? <code>{field}</code> : "—"}</td>
                <td>{inline(description)}</td>
              </tr>
            ))}
          </Table>
        </>
      )}
      <Heading as="h2" id="output">
        Output
      </Heading>
      <p>{inline(command.output)}</p>
      {command.schema && (
        <p>
          The JSON is the <Link href={command.schema.href}>{command.schema.title}</Link> object.
          Errors go to stderr with an <Link href="/errors#exit-codes">exit code</Link>.
        </p>
      )}
    </>
  );
}

/** A field list (`lib/markdown/widgets.ts` names them), which an MDX page
 *  keeps as `<Fields of="…" />`. */
export function Fields({ of }: { of: string }) {
  return <FieldTable rows={fieldRows(of)} />;
}
