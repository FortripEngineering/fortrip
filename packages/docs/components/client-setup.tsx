import { MCP_SERVER_URL } from "@fortrip/agent-contract";
import { CodeBlock, Pre } from "fumadocs-ui/components/codeblock";
import { Heading } from "fumadocs-ui/components/heading";

import { CLIENT_IDS, CLIENT_SETUP, MCP_REGISTRY } from "@/lib/prose/clients.ts";
import { inline } from "@/lib/reference/field-table.tsx";

/** Setup for each client, a section each, in `CLIENT_IDS` order. */
export function ClientSetup() {
  return CLIENT_IDS.map((id) => {
    const client = CLIENT_SETUP[id];
    return (
      <section key={id}>
        <Heading as="h3" id={id}>
          {client.name}
        </Heading>
        {client.code && (
          <CodeBlock>
            <Pre>{client.code.text}</Pre>
          </CodeBlock>
        )}
        <ol>
          {client.steps.map((step) => (
            <li key={step}>{inline(step)}</li>
          ))}
        </ol>
        {client.note && <p>{inline(client.note)}</p>}
      </section>
    );
  });
}

/** How the remote server is reached, and where it is listed. */
export function RemoteMcpTable() {
  return (
    <div className="relative my-6 overflow-auto prose-no-margin">
      <table>
        <tbody>
          <tr>
            <td>Endpoint</td>
            <td>
              <code>{MCP_SERVER_URL}</code>
            </td>
          </tr>
          <tr>
            <td>Transport</td>
            <td>Streamable HTTP</td>
          </tr>
          <tr>
            <td>Authentication</td>
            <td>OAuth sign-in with a Fortrip account. No API key.</td>
          </tr>
          <tr>
            <td>Listed in</td>
            <td>
              The <a href={MCP_REGISTRY.url}>MCP Registry</a> as <code>{MCP_REGISTRY.name}</code>, and{" "}
              <a href={MCP_REGISTRY.glamaUrl}>Glama</a>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
