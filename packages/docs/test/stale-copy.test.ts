// Reads the output of `next build`, which the package's test script runs first.
// Each assertion pins one statement the old docs got wrong (spec §8.1).
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { META_KEYS } from "@fortrip/agent-contract";

import { ERROR_ROWS } from "../lib/reference/error-docs.ts";
import { pageHtml, pageText } from "./built-page.ts";

const meaning = (code: string) => ERROR_ROWS.find((row) => row.code === code)?.meaning ?? "";

describe("stale statements stay fixed", () => {
  it("/api: the pay inputs, and no additive-only promise; /payments: the order's token", () => {
    const text = pageText("/api");
    assert.doesNotMatch(text, /one of two ways/);
    assert.doesNotMatch(text, /changes only by adding/);
    // The pay input is the token and the total: no other way is sent.
    assert.match(text, /takes sharedPaymentToken, the token the user approved for the order, and total/);
    assert.doesNotMatch(text, /payment or method/);
    // §8.1 item 3, the owner's ruling, which the changelog states in full.
    assert.match(text, /major version/);
    assert.match(text, /changelog/);
    assert.match(pageText("/changelog"), /[Uu]ntil general availability/);
    const payments = pageText("/payments");
    // An order offers a token as payment.tokenRequest; no list of methods.
    assert.ok(payments.includes("payment.tokenRequest"));
    assert.doesNotMatch(payments, /with method|payment\.methods/);
  });

  // Contract 6: a result is text only, on every tool.
  it("/mcp: a result is one text block, with no structured content or output schema", () => {
    const text = pageText("/mcp");
    assert.match(text, /A result is text only\. content holds exactly one block, of type text/);
    assert.match(text, /There is no structuredContent, and no tool declares an outputSchema/);
    assert.doesNotMatch(text, /content\[1\]|WeChat Pay code|image/);
    // An error is one text block too, its envelope in _meta.
    assert.match(text, /A failed call has isError: true and one text block\./);
    assert.match(text, /_meta\["ai\.fortrip\/error"\] carries the error envelope/);
    // Every _meta key the hosted server returns has its row.
    const html = pageHtml("/mcp");
    assert.deepEqual(Object.values(META_KEYS), ["ai.fortrip/requestId", "ai.fortrip/replayed", "ai.fortrip/error"]);
    for (const key of Object.values(META_KEYS)) {
      assert.ok(html.includes(`<td><code>${key}</code></td>`), key);
    }
    // Where a developer gets JSON instead.
    assert.match(text, /read it over the HTTP API, where each tool has an endpoint that answers JSON for the same input, or run the CLI command with --json/);
  });

  it("/mcp: no nextStep field, the consent rule ends the text", () => {
    const text = pageText("/mcp");
    assert.doesNotMatch(text, /nextStep/);
    assert.match(text, /The consent rule ends the text of every answer that holds a payment link\. Only the pay rule, which repeats it, can come after it; the cancel rule comes before it:/);
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

  it("a tool page says its result is one text block, and where the JSON is", () => {
    for (const route of ["/mcp/pay-order", "/mcp/search-hotels"]) {
      const text = pageText(route);
      assert.match(text, /The result is one text block, content\[0\]: the answer as compact text/, route);
      assert.match(text, /There is no structuredContent: the same answer as JSON is the/, route);
      assert.doesNotMatch(text, /image|content\[1\]/, route);
    }
    assert.match(pageText("/mcp/search-hotels"), /then the presentation hint\./);
    assert.match(pageText("/mcp/pay-order"), /or fortrip orders pay --json\./);
  });

  // Agents no longer open an Alipay or WeChat Pay payment: the user pays
  // that way on the payment link's page.
  it("the payments page names Alipay or WeChat Pay", () => {
    assert.match(pageText("/payments"), /Alipay or WeChat Pay/);
  });

  it("the payment errors name the token and the payment page, never a method agents no longer have", () => {
    assert.match(meaning("payment_total_mismatch"), /same token/);
    assert.match(meaning("payment_total_mismatch"), /hasn't changed/);
    assert.match(meaning("payment_total_mismatch"), /charged nothing/);
    // payment_method_unavailable: a token refused while the user pays on the
    // payment page, among its reasons.
    assert.match(meaning("payment_method_unavailable"), /`payment_open_on_page` \(the user has a payment open on the order's payment page/);
    for (const code of ["payment_total_mismatch", "payment_method_unavailable"]) {
      assert.doesNotMatch(meaning(code), /`method`|Alipay|WeChat|`payment\.methods`/, code);
    }
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

  // The facts contracts 5 and 6 changed, as packages/contract/test/no-stale-copy.test.ts
  // keeps them out of what agents read. Pages say "in USD" of nothing: only
  // the token is USD-only, and no page needs the phrase for it.
  // The lib's text (error meanings, pay ways, limits, environment…) renders
  // into pages too.
  it("no page, fixture or lib text states an old fact, or says what is in USD", () => {
    const docs = new URL("../content/docs/", import.meta.url).pathname;
    const fixtures = new URL("../lib/reference/fixtures/", import.meta.url).pathname;
    const lib = new URL("../lib/", import.meta.url).pathname;
    const pages = readdirSync(docs, { recursive: true, encoding: "utf8" })
      .filter((f) => f.endsWith(".mdx") && f !== "changelog.mdx")
      .map((f) => ({ file: f, text: readFileSync(join(docs, f), "utf8") }));
    const fixtureTexts = readdirSync(fixtures)
      .filter((f) => f.endsWith(".json"))
      .map((f) => ({ file: f, text: fixtureText(f, readFileSync(join(fixtures, f), "utf8")) }));
    const libTexts = readdirSync(lib, { recursive: true, encoding: "utf8" })
      .filter((f) => f.endsWith(".ts"))
      .map((f) => ({ file: `lib/${f}`, text: readFileSync(join(lib, f), "utf8") }));
    assert.ok(
      pages.length > 10 && fixtureTexts.length > 5 && libTexts.length > 20,
      `${pages.length} ${fixtureTexts.length} ${libTexts.length}`,
    );
    for (const file of ["error-docs.ts", "pay-ways.ts", "limits.ts", "environment.ts"]) {
      assert.ok(libTexts.some((t) => t.file.endsWith(`/${file}`)), file);
    }
    const found = [...pages, ...fixtureTexts, ...libTexts].flatMap(({ file, text }) =>
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
  /alipay_wechat_pay/,
  // Contract 6: one name and one place for each concept.
  /book_hotel/,
  /hotels book/,
  /payment\.methods/,
  /price\.total/,
  /chargeCurrency/,
  /cancel\.available/,
  /cancel\.reason/,
  /payment_total_changed/,
  /perNightAllRooms/,
  /hubTotal/,
  /hubIncludes/,
  /include=rooms/,
  /collectedAt/,
  /\basOf\b/,
  /--method/,
  /--first-name|--last-name/,
  /contact\.(?:firstName|lastName)/,
  /maxAmount/,
  /pricing\.scope/,
  /RateLimitScope/,
  /`param`/,
  /details_refused/,
  /WeChat Pay code|qrData/,
  // One offer is one order: no per-stay check, cap or removed order.
  /order_exists/,
  /order_removed/,
  /order_attempts_exhausted/,
  /ordersPerStay/,
  /[Oo]rders per stay/,
  /hasn't failed or expired/,
  /unless the offer's order failed/,
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
