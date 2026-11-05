import { GLOBAL_FLAGS, LIMITS, type ToolName } from "@fortrip/agent-contract";
import { CodeBlock, Pre } from "fumadocs-ui/components/codeblock";
import { Heading } from "fumadocs-ui/components/heading";
import Link from "next/link";
import type { ReactNode } from "react";

import { CLI_COMMANDS, RAW_BODY_EXAMPLE } from "@/lib/reference/cli-commands.ts";
import { ERROR_ROWS } from "@/lib/reference/error-docs.ts";
import { FieldTable, inline } from "@/lib/reference/field-table.tsx";
import { TOOL_INPUTS } from "@/lib/reference/input-docs.ts";
import { failClosedClause, limitRows, OPERATION_NAMES, rateLimitRows } from "@/lib/reference/limits.ts";
import { MCP_TOOLS } from "@/lib/reference/mcp-tools.ts";
import { regionGroups } from "@/lib/reference/regions.ts";
import { RESPONSE_DOCS, responseDocFor } from "@/lib/reference/response-docs.ts";
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

function Code({ children }: { children: string }) {
  return (
    <CodeBlock>
      <Pre>{children}</Pre>
    </CodeBlock>
  );
}

function access(tool: (typeof MCP_TOOLS)[number]): string {
  if (tool.readOnly) return "Read-only";
  const writes: Partial<Record<ToolName, string>> = {
    cancel_order: "Cancels an order",
    pay_order: "Pays an order",
  };
  return writes[tool.name] ?? "Creates an unpaid order";
}

/** The tools, each linking to its page. */
export function ToolList() {
  return (
    <Table head={["Tool", "Description", "Access"]}>
      {MCP_TOOLS.map((tool) => (
        <tr key={tool.slug}>
          <td>
            <Link href={`/mcp/${tool.slug}`}>
              <code>{tool.name}</code>
            </Link>
          </td>
          <td>{tool.title}</td>
          <td>{access(tool)}</td>
        </tr>
      ))}
    </Table>
  );
}

/** A tool's page body: its contract description after the first sentence
 *  (the page's description), input fields and output. */
export function ToolPage({ name }: { name: ToolName }) {
  const tool = MCP_TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`${name} has no docs page`);
  const input = tool.name === "get_planning_guide" ? null : TOOL_INPUTS[tool.name];
  const cli = CLI_COMMANDS.find((command) => command.slug === tool.cliSlug);
  const nextStep = responseDocFor(tool.name)?.mcpNextStep === true;
  const rest = tool.summary.slice(tool.snippet.length).trim();
  return (
    <>
      {rest && <p>{inline(rest)}</p>}
      <p className="text-sm text-fd-muted-foreground">
        <code>{tool.name}</code> · {access(tool)}
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
          <Link href={tool.returns.href}>{tool.returns.title}</Link> object, and{" "}
          <code>content[0]</code> the same answer as compact text.
          {nextStep && (
            <>
              {" "}
              It also carries <code>nextStep</code>, the rule for sharing <code>payment.url</code>.
            </>
          )}{" "}
          Errors are described in the <Link href="/mcp#results">overview</Link>.
        </p>
      )}
    </>
  );
}

/** The commands, each linking to its page. */
export function CommandList() {
  return (
    <Table head={["Command", "Description"]}>
      {CLI_COMMANDS.map((command) => (
        <tr key={command.slug}>
          <td>
            <Link href={`/cli/${command.slug}`}>
              <code>{command.invocation}</code>
            </Link>
          </td>
          <td>{command.title}</td>
        </tr>
      ))}
    </Table>
  );
}

/** The options of the CLI itself. */
export function GlobalFlags() {
  return (
    <Table>
      {GLOBAL_FLAGS.map((option) => (
        <tr key={option.flag}>
          <td>
            <code>{`${option.short ? `-${option.short}, ` : ""}--${option.flag}`}</code>
          </td>
          <td>{option.description}</td>
        </tr>
      ))}
    </Table>
  );
}

export function RawBodyExample() {
  return <Code>{`fortrip hotels search --body '${JSON.stringify(RAW_BODY_EXAMPLE)}'`}</Code>;
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
      <Code>{command.usage}</Code>
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

/** Every response object, a section each. */
export function SchemaTables() {
  return RESPONSE_DOCS.map((doc) => {
    const tools = MCP_TOOLS.filter((tool) => doc.tools.includes(tool.name));
    const commands = CLI_COMMANDS.filter((c) => doc.cliSlugs.includes(c.slug));
    return (
      <section key={doc.id}>
        <Heading as="h2" id={doc.id}>
          {doc.title}
        </Heading>
        <p className="text-sm text-fd-muted-foreground">
          {doc.http.map((endpoint) => (
            <span key={endpoint}>
              <code>{endpoint}</code>
              {" · "}
            </span>
          ))}
          {tools.map((tool) => (
            <span key={tool.slug}>
              <Link href={`/mcp/${tool.slug}`}>
                <code>{tool.name}</code>
              </Link>
              {" · "}
            </span>
          ))}
          {commands.map((command, i) => (
            <span key={command.slug}>
              {i > 0 && " · "}
              <Link href={`/cli/${command.slug}`}>
                <code>{command.invocation}</code>
              </Link>
            </span>
          ))}
        </p>
        {doc.mcpNextStep && (
          <p>
            Over MCP the object also carries <code>nextStep</code>: what to show the user and ask
            before giving them <code>payment.url</code>.
          </p>
        )}
        <FieldTable rows={doc.rows} />
      </section>
    );
  });
}

export function ErrorCodes() {
  return (
    <Table head={["Code", "Status", "Retry", "Meaning and details"]}>
      {ERROR_ROWS.map((row) => (
        <tr key={row.code} id={`code-${row.code}`}>
          <td>
            <code>{row.code}</code>
          </td>
          <td>{row.status}</td>
          <td>{row.retryable ? "Yes" : "No"}</td>
          <td>
            {inline(row.meaning)}
            {row.details && (
              <>
                <br />
                <code>details: {row.details}</code>
              </>
            )}
          </td>
        </tr>
      ))}
    </Table>
  );
}

/** The rate limits, then which calls the limiter refuses while it is down. */
export function RateLimitsTable() {
  return (
    <>
      <Table head={["Scope", "Calls", "Per minute"]}>
        {rateLimitRows().map((row) => (
          <tr key={row.scope}>
            <td>
              <code>{row.scope}</code>
            </td>
            <td>
              {row.operations
                .map((name) => OPERATION_NAMES[name])
                .join(", ")
                .replace(/^./, (c) => c.toUpperCase())}
            </td>
            <td>{row.perMinute}</td>
          </tr>
        ))}
      </Table>
      <p>
        If the rate limiter itself is down, calls go through, except {failClosedClause()}{" "}
        <code>503 service_unavailable</code> instead.
      </p>
    </>
  );
}

export function LimitsTable() {
  return (
    <Table head={["Limit", "Value", "Applies to"]}>
      {limitRows(LIMITS).map(([name, value, description]) => (
        <tr key={name}>
          <td>{name}</td>
          <td>{inline(value)}</td>
          <td>{inline(description)}</td>
        </tr>
      ))}
    </Table>
  );
}

/** The enabled regions by country, with their count. */
export function RegionList() {
  const groups = regionGroups();
  const total = groups.reduce((sum, group) => sum + group.regions.length, 0);
  return (
    <>
      <p>
        {total} regions in {groups.length} {groups.length === 1 ? "country" : "countries"}. Search
        one by name with its <code>countryCode</code>, or as{" "}
        <code>{'{ kind: "place", placeId }'}</code>.
      </p>
      {groups.map((group) => (
        <div key={group.countryCode}>
          <h3>
            {group.country} <code>{group.countryCode}</code>
          </h3>
          <Table head={["Region", "placeId"]}>
            {group.regions.map((region) => (
              <tr key={region.placeId}>
                <td>{region.name}</td>
                <td>
                  <code>{region.placeId}</code>
                </td>
              </tr>
            ))}
          </Table>
        </div>
      ))}
    </>
  );
}
