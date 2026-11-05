// Reads the examples under examples/ and the output of `next build`, which
// the package's test script runs first. The examples are real files; these
// tests hold them to the contract so they can't drift from it.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  ACCOUNT_ROUTES,
  containsCardNumber,
  createSearchHotelsInput,
  HTTP_ROUTES,
  PAY_INPUT_WAYS,
  PAY_WAYS,
  PUBLIC_ORIGINS,
  routePath,
  TOOLS,
  type HttpToolName,
} from "@fortrip/agent-contract";

import { pageText } from "./built-page.ts";

const root = new URL("../examples/", import.meta.url).pathname;
const read = (file: string) => readFileSync(join(root, file), "utf8");

// Ids in the contract's formats: a prefix and 20 letters or digits.
const HOTEL = "htl_Qm3xK9vT2pLw7Hn4Rb8Z";
const OFFER = "off_Bz6yN1cD5fGh8JkM2pQs";
const ORDER = "ord_Wr4tY7uI0oPa3SdF6gHj";

interface Example {
  name: string;
  route: { method: "GET" | "POST"; path: string; pathFields: readonly string[]; queryFields: readonly string[] };
  /** The tool whose input schema the request must satisfy; none for the account routes. */
  tool?: HttpToolName;
  /** Fields the path and query carry, which are not in the body. */
  fromUrl?: Record<string, unknown>;
  /** The shared body, examples/bodies/<name>.json. */
  body?: boolean;
}

const EXAMPLES: Example[] = [
  { name: "device-login", route: ACCOUNT_ROUTES.authConfig },
  { name: "search", route: HTTP_ROUTES.search_hotels, tool: "search_hotels", body: true },
  { name: "offers", route: HTTP_ROUTES.get_hotel_offers, tool: "get_hotel_offers", body: true },
  { name: "order", route: HTTP_ROUTES.book_hotel, tool: "book_hotel", body: true },
  { name: "pay-token", route: HTTP_ROUTES.pay_order, tool: "pay_order", fromUrl: { orderId: ORDER }, body: true },
  { name: "pay-wallet", route: HTTP_ROUTES.pay_order, tool: "pay_order", fromUrl: { orderId: ORDER }, body: true },
  { name: "get-order", route: HTTP_ROUTES.get_order, tool: "get_order", fromUrl: { orderId: ORDER } },
  { name: "list-orders", route: HTTP_ROUTES.list_orders, tool: "list_orders", fromUrl: { limit: 10 } },
  { name: "cancel", route: HTTP_ROUTES.cancel_order, tool: "cancel_order", fromUrl: { orderId: ORDER }, body: true },
];

const LANGS = [
  { dir: "curl", ext: "sh" },
  { dir: "ts", ext: "ts" },
  { dir: "py", ext: "py" },
] as const;

const file = (lang: (typeof LANGS)[number], name: string) => `${lang.dir}/${name}.${lang.ext}`;
const bodyOf = (name: string): Record<string, unknown> => JSON.parse(read(`bodies/${name}.json`));

/** The JSON the example sends, as written in its file: the heredoc of a curl
 *  script, or the `body = {…}` literal of a TypeScript or Python one. */
function embeddedBodyText(lang: (typeof LANGS)[number], text: string): string {
  const pattern =
    lang.dir === "curl"
      ? /<<'JSON'\n([\s\S]*?)\nJSON\n/
      : /^(?:const )?body = (\{[\s\S]*?\n\})(?:;)?$/m;
  const match = text.match(pattern);
  assert.ok(match?.[1], `${lang.dir}: no embedded body`);
  return match[1];
}

const hasPython = !spawnSync("python3", ["--version"]).error;

/** The body as the language reads it: JSON for curl and TypeScript, and for
 *  Python what `ast.literal_eval` makes of the dict (JSON's `true` is a
 *  NameError there, which `JSON.parse` would accept). */
function embeddedBody(lang: (typeof LANGS)[number], text: string): unknown {
  const body = embeddedBodyText(lang, text);
  if (lang.dir !== "py") return JSON.parse(body);
  const run = spawnSync("python3", ["-I", "-c", "import ast, json, sys; print(json.dumps(ast.literal_eval(sys.argv[1])))", body]);
  assert.equal(run.status, 0, String(run.stderr));
  return JSON.parse(String(run.stdout));
}

describe("examples", () => {
  it("every example has a file in each language, and nothing else is there", () => {
    for (const lang of LANGS) {
      const have = readdirSync(join(root, lang.dir)).sort();
      const want = EXAMPLES.map((e) => `${e.name}.${lang.ext}`).sort();
      assert.deepEqual(have, want, lang.dir);
    }
    const bodies = readdirSync(join(root, "bodies")).sort();
    assert.deepEqual(
      bodies,
      EXAMPLES.filter((e) => e.body).map((e) => `${e.name}.json`).sort(),
    );
  });

  it("each body is valid input for its tool, with the path fields added", () => {
    for (const example of EXAMPLES.filter((e) => e.body)) {
      const input = { ...example.fromUrl, ...bodyOf(example.name) };
      const schema =
        example.tool === "search_hotels"
          ? createSearchHotelsInput(() => Date.parse("2026-11-05T00:00:00Z"))
          : TOOLS.find((tool) => tool.name === example.tool)?.input;
      assert.ok(schema, example.name);
      const result = schema.safeParse(input);
      assert.ok(result.success, `${example.name}: ${JSON.stringify(result.error?.issues)}`);
      // No field is sent that the route carries in its path.
      for (const field of example.route.pathFields) assert.ok(!(field in bodyOf(example.name)), field);
    }
  });

  it("the requests without a body are valid input too", () => {
    for (const example of EXAMPLES.filter((e) => !e.body && e.tool)) {
      const schema = TOOLS.find((tool) => tool.name === example.tool)?.input;
      const result = schema?.safeParse(example.fromUrl);
      assert.ok(result?.success, `${example.name}: ${JSON.stringify(result?.error?.issues)}`);
    }
  });

  it("the sample ids are the ones in the contract's formats", () => {
    const text = LANGS.flatMap((lang) => EXAMPLES.map((e) => read(file(lang, e.name)))).join("\n");
    for (const [prefix, id] of [["htl", HOTEL], ["off", OFFER], ["ord", ORDER]] as const) {
      assert.match(id, new RegExp(`^${prefix}_[0-9A-Za-z]{20}$`));
    }
    // Every id-shaped string in an example is one of the three samples.
    const used = new Set(text.match(/\b(?:htl|off|ord)_[0-9A-Za-z]+/g));
    assert.deepEqual([...used].sort(), [HOTEL, OFFER, ORDER].sort());
  });

  it("the pay examples cover every way that has a pay request, and payment_link has none", () => {
    const sent = (name: string) =>
      Object.keys(bodyOf(name)).flatMap((key) => (key in PAY_INPUT_WAYS ? [PAY_INPUT_WAYS[key as keyof typeof PAY_INPUT_WAYS]] : []));
    const covered = new Set([...sent("pay-token"), ...sent("pay-wallet")]);
    assert.deepEqual(
      [...covered].sort(),
      PAY_WAYS.filter((way) => way !== "payment_link").sort(),
    );
    // Exactly one way per request.
    assert.equal(sent("pay-token").length, 1);
    assert.equal(sent("pay-wallet").length, 1);
    // payment_link: the order's link, read from get_order.
    for (const lang of LANGS) assert.match(read(file(lang, "get-order")), /payment\.url|get\("url"\)/);
  });

  for (const lang of LANGS) {
    describe(lang.dir, () => {
      for (const example of EXAMPLES) {
        it(`${example.name}: method, path and token`, () => {
          const text = read(file(lang, example.name));
          const url = `${PUBLIC_ORIGINS.api}${routePath(example.route, example.fromUrl ?? {})}`;
          assert.ok(text.includes(`"${url}"`), `${file(lang, example.name)} lacks "${url}"`);
          // The device flow posts to the sign-in server; its Fortrip call is a GET.
          if (example.name === "device-login") return;
          // The token is sent as a bearer header, from FORTRIP_TOKEN.
          assert.match(
            text,
            lang.dir === "curl"
              ? /-H "Authorization: Bearer \$FORTRIP_TOKEN"/
              : lang.dir === "ts"
                ? /process\.env\.FORTRIP_TOKEN[\s\S]*Authorization: `Bearer \$\{token\}`/
                : /os\.environ\["FORTRIP_TOKEN"\][\s\S]*"Authorization": f"Bearer \{token\}"/,
          );
          // A body is sent as JSON (httpx's json= sets the header itself).
          if (example.body) {
            assert.match(
              text,
              lang.dir === "curl" ? /-H "Content-Type: application\/json"/ : lang.dir === "ts" ? /"Content-Type": "application\/json"/ : /json=body/,
            );
          }
          // A slow answer is waited for, and an HTTP error is not mistaken for success.
          assert.match(
            text,
            lang.dir === "curl" ? /--max-time 60/ : lang.dir === "ts" ? /AbortSignal\.timeout\(60_000\)/ : /timeout=60/,
          );
          assert.match(
            text,
            lang.dir === "curl" ? /--fail-with-body/ : lang.dir === "ts" ? /if \(!response\.ok\)[\s\S]*response\.status[\s\S]*await response\.json\(\)/ : /if response\.is_error:[\s\S]*status_code[\s\S]*response\.json\(\)/,
          );
          if (example.route.method === "POST") {
            assert.match(text, lang.dir === "curl" ? /-X POST/ : lang.dir === "ts" ? /method: "POST"/ : /httpx\.post\(/);
          } else {
            assert.doesNotMatch(text, /-X POST|method: "POST"|httpx\.post\(/);
          }
          assert.doesNotMatch(text, /Bearer [A-Za-z0-9_-]{10,}/);
        });

        if (example.body) {
          it(`${example.name}: sends exactly the shared body`, (t) => {
            if (lang.dir === "py" && !hasPython) return t.skip("python3 is not installed");
            assert.deepEqual(embeddedBody(lang, read(file(lang, example.name))), bodyOf(example.name));
          });
        }
      }
    });
  }

  for (const lang of LANGS) {
    it(`${lang.dir}/device-login follows the device flow: checks the grant, backs off, stops at expiry`, () => {
      const text = read(file(lang, "device-login"));
      assert.ok(text.includes("urn:ietf:params:oauth:grant-type:device_code"));
      assert.ok(text.includes("device_code"));
      assert.ok(text.includes("authorization_pending"));
      assert.ok(text.includes("slow_down"));
      assert.match(text, /expires_in/);
      // The interval grows on slow_down (RFC 8628: by 5 seconds).
      assert.match(text, /interval( \+= 5|=\$\(\(interval \+ 5\)\))/);
      // The device-authorization answer is checked before polling.
      assert.match(text, lang.dir === "curl" ? /-z "\$device_code"/ : lang.dir === "ts" ? /!deviceResponse\.ok \|\| !device\?\.device_code/ : /device_response\.is_error[\s\S]*"device_code" not in device/);
    });
  }

  it("no file holds a card number", () => {
    const files = readdirSync(root, { recursive: true, encoding: "utf8" }).filter((f) => /\.\w+$/.test(f));
    assert.ok(files.length >= 28, files.join(", "));
    for (const f of files) assert.ok(!containsCardNumber(read(f)), f);
  });

  it("the Python examples compile", (t) => {
    const probe = spawnSync("python3", ["--version"]);
    if (probe.error) return t.skip("python3 is not installed");
    for (const example of EXAMPLES) {
      const run = spawnSync("python3", ["-I", "-c", "import sys; compile(open(sys.argv[1]).read(), sys.argv[1], 'exec')", join(root, file(LANGS[2], example.name))]);
      assert.equal(run.status, 0, `${example.name}: ${run.stderr}`);
    }
  });

  it("the shell examples parse", (t) => {
    const probe = spawnSync("bash", ["--version"]);
    if (probe.error) return t.skip("bash is not installed");
    for (const example of EXAMPLES) {
      const run = spawnSync("bash", ["-n", join(root, file(LANGS[0], example.name))]);
      assert.equal(run.status, 0, `${example.name}: ${run.stderr}`);
    }
  });
});

describe("the examples page", () => {
  const mdx = readFileSync(new URL("../content/docs/examples.mdx", import.meta.url), "utf8");

  it("shows every example once, by name", () => {
    for (const example of EXAMPLES) {
      assert.equal(mdx.split(`<Example name="${example.name}" />`).length - 1, 1, example.name);
    }
    assert.ok(existsSync(new URL("../components/example.tsx", import.meta.url)));
  });

  it("renders each example's curl and links to /payments", () => {
    const text = pageText("/examples");
    for (const example of EXAMPLES) {
      const url = `${PUBLIC_ORIGINS.api}${routePath(example.route, example.fromUrl ?? {})}`;
      assert.ok(text.includes(url), `${example.name}: ${url}`);
    }
    assert.match(readFileSync(new URL("../.next/server/app/examples.html", import.meta.url), "utf8"), /href="\/payments/);
  });
});
