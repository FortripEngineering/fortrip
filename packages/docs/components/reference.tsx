import type { ToolName } from "@fortrip/agent-contract";
import { ServerCodeBlock } from "fumadocs-ui/components/codeblock.rsc";
import { Heading } from "fumadocs-ui/components/heading";
import Link from "next/link";
import type { ReactNode } from "react";

import { MODEL_READS } from "@/lib/markdown/pages.ts";
import { fieldRows } from "@/lib/markdown/widgets.ts";
import { contentSentence, SURFACE_HEADINGS, toolSentence } from "@/lib/prose/mcp-content.ts";
import { CLI_COMMANDS, type CliCommand } from "@/lib/reference/cli-commands.ts";
import { FieldTable, inline } from "@/lib/reference/field-table.tsx";
import { MCP_TOOLS } from "@/lib/reference/mcp-tools.ts";

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

/** A command's usage, how it works, options and output. On a command's own
 *  page each part has its heading; in an operation's CLI section they follow
 *  one another under that section's heading. */
function CommandBody({ command, headings }: { command: CliCommand; headings: boolean }) {
  const title = (id: string, text: string) =>
    headings && (
      <Heading as="h2" id={id}>
        {text}
      </Heading>
    );
  return (
    <>
      {title("usage", "Usage")}
      {/* Highlighted like a Markdown block (its lines carry the padding), spaced like one. */}
      <ServerCodeBlock lang="text" code={command.usage} codeblock={{ className: "my-4" }} />
      {command.how && (
        <>
          {title("how", "How it works")}
          {command.how.map((paragraph) => (
            <p key={paragraph}>{inline(paragraph)}</p>
          ))}
        </>
      )}
      {command.flags && (
        <>
          {title("options", "Options")}
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
      {title("output", "Output")}
      <p>
        {inline(command.output)}
        {command.schema && (
          <>
            {" "}
            {/* An operation's page shows the object above, under its responses. */}
            {headings && (
              <>
                The JSON is the <Link href={command.schema.href}>{command.schema.title}</Link> object.{" "}
              </>
            )}
            Errors go to stderr with an <Link href="/errors#exit-codes">exit code</Link>.
          </>
        )}
      </p>
    </>
  );
}

/** The page body of a command that calls no operation: usage, options and
 *  output (its summary is the page's description). `path` is its page slug. */
export function CommandPage({ path }: { path: string }) {
  const command = CLI_COMMANDS.find((c) => c.slug === path);
  if (!command) throw new Error(`${path} has no docs page`);
  return <CommandBody command={command} headings />;
}

/** The first line of an operation's page: its MCP tool and its CLI command,
 *  each linking to its section at the end of the page. */
export function SurfaceLinks({ name }: { name: ToolName }) {
  const tool = MCP_TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`${name} has no docs page`);
  return (
    <p className="text-sm text-fd-muted-foreground">
      MCP:{" "}
      <Link href="#mcp">
        <code>{tool.name}</code>
      </Link>{" "}
      · CLI:{" "}
      <Link href="#cli">
        <code>{tool.cli}</code>
      </Link>
    </p>
  );
}

/** The sections that end an operation's page, after its HTTP request and
 *  responses: the MCP tool and the CLI command that take the same input. */
export function OperationSurfaces({ name }: { name: ToolName }) {
  const tool = MCP_TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`${name} has no docs page`);
  const command = CLI_COMMANDS.find((c) => c.slug === tool.cliSlug);
  return (
    <>
      <Heading as="h2" id="mcp">
        {SURFACE_HEADINGS.mcp}
      </Heading>
      <p>{inline(toolSentence(tool.name, tool.access))}</p>
      <p>
        {inline(contentSentence(tool.name))} Errors are described in the <Link href="/mcp#errors">MCP overview</Link>.
      </p>
      {command && (
        <>
          <Heading as="h2" id="cli">
            {SURFACE_HEADINGS.cli}
          </Heading>
          <CommandBody command={command} headings={false} />
        </>
      )}
    </>
  );
}

/** A field list (`lib/markdown/widgets.ts` names them), which an MDX page
 *  keeps as `<Fields of="…" />`. */
export function Fields({ of }: { of: string }) {
  return <FieldTable rows={fieldRows(of)} />;
}
