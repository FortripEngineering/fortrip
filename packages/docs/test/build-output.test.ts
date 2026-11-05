// Reads the output of `next build`, which the package's test script runs first.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { fact } from "../components/fact.tsx";

const server = new URL("../.next/server/", import.meta.url).pathname;

describe("built site", () => {
  it("states the contract's values on the index page", () => {
    // React separates adjacent text with <!-- -->; the reader sees one run of text.
    const html = readFileSync(join(server, "app/index.html"), "utf8").replaceAll("<!-- -->", "");
    assert.ok(html.includes(`any MCP client with OAuth at ${fact("MCP_SERVER_URL")}.`));
    assert.ok(html.includes(`live offers for up to ${fact("LIMITS.offersHotels")} hotels`));
    assert.ok(html.includes(`up to ${fact("LIMITS.rooms")} rooms`));
  });

  it("leaves no <Fact> tag in any output, search data included", () => {
    const files = readdirSync(server, { recursive: true, encoding: "utf8" }).filter(
      // `app/openapi.json` is a route's folder.
      (f) => /\.(js|html|rsc|json|body)$/.test(f) && statSync(join(server, f)).isFile(),
    );
    assert.ok(files.length > 0);
    const leaks = files.filter((f) => readFileSync(join(server, f), "utf8").includes("<Fact"));
    assert.deepEqual(leaks, []);
  });
});
