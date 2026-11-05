// Starts the output of `next build`, which the package's test script runs
// first, and asks its search route.
import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { createServer } from "node:net";
import { after, before, describe, it } from "node:test";

import { PAY_WAYS } from "@fortrip/agent-contract";

import { PAY_WAY_DOCS } from "../lib/prose/pay-ways.ts";
import { ENDPOINTS } from "../lib/reference/api-docs.ts";

interface Result {
  url: string;
  type: string;
  content: string;
}

const root = new URL("..", import.meta.url).pathname;
let server: ChildProcess | undefined;
let origin = "";

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer().listen(0, () => {
      const address = probe.address();
      probe.close(() => (typeof address === "object" && address ? resolve(address.port) : reject(new Error("no port"))));
    });
  });
}

async function search(query: string): Promise<Result[]> {
  const response = await fetch(`${origin}/api/search?query=${encodeURIComponent(query)}`);
  assert.equal(response.status, 200);
  return (await response.json()) as Result[];
}

describe("search", () => {
  before(async () => {
    const port = await freePort();
    origin = `http://127.0.0.1:${port}`;
    const child = spawn("node_modules/.bin/next", ["start", "-p", String(port), "-H", "127.0.0.1"], {
      cwd: root,
      stdio: ["ignore", "ignore", "pipe"],
    });
    server = child;
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const exited = new Promise<never>((_, reject) => {
      child.once("exit", (code, signal) => reject(new Error(`next start exited (${code ?? signal}):\n${stderr}`)));
    });
    const ready = (async () => {
      for (let i = 0; ; i++) {
        try {
          if ((await fetch(`${origin}/api/search?query=x`, { signal: AbortSignal.timeout(2000) })).ok) return;
        } catch {
          // not listening yet
        }
        if (child.exitCode !== null || child.signalCode !== null) throw new Error(`next start exited:\n${stderr}`);
        if (i > 150) throw new Error(`next start didn't answer:\n${stderr}`);
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    })();
    await Promise.race([ready, exited]);
    exited.catch(() => {});
  });

  after(async () => {
    if (!server || server.exitCode !== null || server.signalCode !== null) return;
    const exit = new Promise((resolve) => server?.once("exit", resolve));
    server.kill();
    await exit;
  });

  it("finds each way to pay on /payments, at the section its component renders", async () => {
    for (const way of PAY_WAYS) {
      const { title } = PAY_WAY_DOCS[way];
      const anchor = `/payments#pay-${way.replaceAll("_", "-")}`;
      const results = await search(title);
      assert.ok(
        results.some((r) => r.url === anchor && r.content === title),
        `${way}: ${JSON.stringify(results.filter((r) => r.url.startsWith("/payments")))}`,
      );
    }
  });

  it("finds each endpoint on /api, in its table row", async () => {
    for (const endpoint of ENDPOINTS) {
      const route = `${endpoint.method} ${endpoint.path}`;
      const results = await search(endpoint.path);
      assert.ok(
        results.some((r) => r.url.startsWith("/api#") && r.content.startsWith("|") && r.content.includes(route)),
        `${route}: ${JSON.stringify(results.slice(0, 5))}`,
      );
    }
  });
});
