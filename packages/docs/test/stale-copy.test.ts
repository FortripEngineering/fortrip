// Reads the output of `next build`, which the package's test script runs first.
// Each assertion pins one statement the old docs got wrong (spec §8.1).
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { MCP_OUTPUT } from "@fortrip/agent-contract";

import { ERROR_ROWS } from "../lib/reference/error-docs.ts";
import { pageHtml, pageText } from "./built-page.ts";

const meaning = (code: string) => ERROR_ROWS.find((row) => row.code === code)?.meaning ?? "";

describe("stale statements stay fixed", () => {
  it("/api: the pay inputs, and no additive-only promise; /payments: the Alipay or WeChat Pay input", () => {
    const text = pageText("/api");
    assert.doesNotMatch(text, /one of two ways/);
    assert.doesNotMatch(text, /changes only by adding/);
    // §8.1 item 2: exactly one of the three inputs.
    assert.match(text, /exactly one of sharedPaymentToken, payment or method, for the way it pays/);
    // §8.1 item 3, the owner's ruling, which the changelog states in full.
    assert.match(text, /major version/);
    assert.match(text, /changelog/);
    assert.match(pageText("/changelog"), /[Uu]ntil general availability/);
    const payments = pageText("/payments");
    assert.ok(payments.includes("method"));
    assert.ok(payments.includes("payment.methods"));
    assert.ok(payments.includes('"stripe_alipay_wechat_pay"'));
  });

  it("/mcp: content[0] is not always text", () => {
    const text = pageText("/mcp");
    assert.doesNotMatch(text, /content\[0\] is compact text/);
    assert.match(text, /WeChat Pay code/);
    assert.match(text, /content\[1\]/);
  });

  it("/mcp: nextStep only on the answers that declare it; blocks found by type", () => {
    const text = pageText("/mcp");
    const withNextStep = Object.entries(MCP_OUTPUT)
      .filter(([, schema]) => "nextStep" in schema.shape)
      .map(([tool]) => tool);
    assert.ok(withNextStep.length > 0 && !withNextStep.includes("pay_order"));
    const list = `${withNextStep.slice(0, -1).join(", ")} and ${withNextStep.at(-1)}`;
    assert.ok(text.includes(`An answer of ${list} that holds a payment.url also carries nextStep`), list);
    assert.match(text, /by its type \(text, image\), not by its position/);
    assert.match(text, /unless the image couldn't be fetched/);
  });

  it("no page states the ways to pay or the pay inputs as a closed set by hand", () => {
    const docs = new URL("../content/docs/", import.meta.url).pathname;
    for (const page of readdirSync(docs, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".mdx"))) {
      const mdx = readFileSync(join(docs, page), "utf8");
      assert.doesNotMatch(mdx, /\b(?:one|two|three|four|five) ways\b/, page);
      assert.doesNotMatch(mdx, /`sharedPaymentToken`,? (?:or|and) `payment`|`payment`,? (?:or|and) `method`/, page);
      assert.doesNotMatch(mdx, /token,? or (?:by )?Alipay/, page);
    }
  });

  it("the quickstart sends Claude Desktop to client setup, not to the remote server", () => {
    assert.match(pageHtml("/quickstart"), /href="\/install#clients"/);
    assert.doesNotMatch(pageHtml("/quickstart"), /href="\/install#remote-mcp"/);
  });

  it("a tool page says where its text is", () => {
    assert.doesNotMatch(pageText("/mcp/pay-order"), /content\[0\] the same answer as compact text/);
    assert.match(pageText("/mcp/pay-order"), /image/);
  });

  it("the intro and quickstart name Alipay or WeChat Pay", () => {
    for (const route of ["/", "/quickstart"]) {
      assert.match(pageText(route), /Alipay|WeChat Pay/, route);
    }
  });

  it("the payment errors cover Alipay and WeChat Pay (checked against the pay handler)", () => {
    // payment_total_changed: the wallet path checks the total before it opens.
    assert.match(meaning("payment_total_changed"), /same token/);
    assert.match(meaning("payment_total_changed"), /Alipay or WeChat Pay/);
    assert.match(meaning("payment_total_changed"), /charged nothing/);
    // payment_method_unavailable: the wallet's own refusals, and a token
    // refused while a wallet payment is open.
    assert.match(meaning("payment_method_unavailable"), /`method`/);
    assert.match(meaning("payment_method_unavailable"), /Alipay or WeChat Pay/);
    assert.match(meaning("payment_method_unavailable"), /`payment\.methods`/);
  });

  it("no page states the access token's lifetime or the order reference's length", () => {
    const docs = new URL("../content/docs/", import.meta.url).pathname;
    const lib = new URL("../lib/", import.meta.url).pathname;
    const examples = new URL("../examples/", import.meta.url).pathname;
    const files = [
      ...readdirSync(docs, { recursive: true, encoding: "utf8" })
        .filter((f) => f.endsWith(".mdx") && f !== "changelog.mdx")
        .map((f) => join(docs, f)),
      ...readdirSync(lib, { recursive: true, encoding: "utf8" })
        .filter((f) => /\.tsx?$/.test(f))
        .map((f) => join(lib, f)),
      ...readdirSync(examples, { recursive: true, encoding: "utf8" })
        .filter((f) => /\.(?:sh|py|ts)$/.test(f))
        .map((f) => join(examples, f)),
    ];
    assert.ok(files.length > 20, String(files.length));
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      assert.ok(!/\b24 hours?\b|\b24-hour\b|\ba day\b/i.test(source), `${file} states a token lifetime`);
      assert.ok(!/\bsix characters\b|\b6 characters\b/i.test(source), `${file} states a reference length`);
    }
    assert.match(pageText("/api"), /The access token is short-lived: its lifetime, in seconds, is the token response's expires_in\./);
    assert.match(pageText("/cli"), /An access token is short-lived, so it suits a remote agent environment or a CI run; for longer, sign in\./);
    assert.match(pageText("/payments"), /The order's reference, which starts with FT-, is the number the user quotes to support\./);
  });

  it("no page types a CLI exit code", () => {
    const docs = new URL("../content/docs/", import.meta.url).pathname;
    for (const page of readdirSync(docs, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".mdx") && f !== "changelog.mdx")) {
      const prose = readFileSync(join(docs, page), "utf8").replace(/<Fact [^>]*\/>/g, "");
      assert.ok(!/\bexits? (?:with )?\[?(?:code )?\d/.test(prose), `${page} types an exit code`);
    }
  });

  it("/regions states no share its data can't show", () => {
    assert.doesNotMatch(pageText("/regions"), /\d\s?%/);
  });

  // The facts contract 5 changed, as packages/contract/test/no-stale-copy.test.ts
  // keeps them out of what agents read. Pages say "in USD" of nothing: only
  // the token is USD-only, and no page needs the phrase for it.
  it("no page or fixture states an old fact, or says what is in USD", () => {
    const docs = new URL("../content/docs/", import.meta.url).pathname;
    const fixtures = new URL("../lib/reference/fixtures/", import.meta.url).pathname;
    const pages = readdirSync(docs, { recursive: true, encoding: "utf8" })
      .filter((f) => f.endsWith(".mdx") && f !== "changelog.mdx")
      .map((f) => ({ file: f, text: readFileSync(join(docs, f), "utf8") }));
    const fixtureTexts = readdirSync(fixtures)
      .filter((f) => f.endsWith(".json"))
      .map((f) => ({ file: f, text: fixtureText(f, readFileSync(join(fixtures, f), "utf8")) }));
    assert.ok(pages.length > 10 && fixtureTexts.length > 5, `${pages.length} ${fixtureTexts.length}`);
    const found = [...pages, ...fixtureTexts].flatMap(({ file, text }) =>
      [...STALE, /\bin USD\b/].filter((pattern) => pattern.test(text)).map((pattern) => `${file}: ${pattern}`),
    );
    assert.deepEqual(found, []);
  });
});

const STALE: readonly RegExp[] = [
  /payment is in USD/,
  /Charged in USD/,
  /in USD for offers/,
  /total in USD/,
  /the USD total/,
  // A request's money "must be USD or CNY" is the rule, and stays.
  /must be USD(?! or)/,
  /displayCurrency/,
  /display-currency/,
  /\bapprox\b/,
  /--wallet/,
  /payment\.wallets/,
  /payment\.handlers/,
  /credentialLimits/,
  /cancel\.penalty\.amount/,
  /get_planning_guide/,
  /fortrip guide/,
  /US dollars/,
  /(?<!stripe_)alipay_wechat_pay/,
];

/** A fixture as text, less the server-sent notice it mirrors, which is the
 *  server's words for a USD search: exempt by name. */
function fixtureText(file: string, source: string): string {
  if (file !== "search-hotels.json") return source;
  const data = JSON.parse(source);
  const note = data.notes.find((n: { code: string }) => n.code === "indicative_prices");
  assert.ok(note, "search-hotels.json: the indicative_prices note");
  delete note.message;
  return JSON.stringify(data, null, 2);
}
