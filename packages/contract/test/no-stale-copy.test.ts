import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { z } from "zod";

import { ERROR_CODES, type ErrorCode } from "../src/errors.ts";
import { type GuideSurface, type GuideTopic, renderGuide } from "../src/guide.ts";
import { renderError } from "../src/render/index.ts";
import {
  CALLS,
  CANCEL_NEXT_STEP,
  cancelNextStep,
  ORDER_NEXT_STEP,
  PAY_NEXT_STEP,
  payNextStep,
  PRESENTATION_HINT,
  type RenderSurface,
  TOOLS,
} from "../src/tools.ts";

/*
 * Statements that stopped being true in contract 5 (one currency per search
 * and order, payment.methods, cancel_order's Money, the planning guide's
 * removal, one order per offer) stay out of every text an agent reads: the
 * tool descriptions and schemas, the next steps, the guide, the error
 * renderings, the generated skills and the plugins. The docs pages have the
 * same list (packages/docs/test/stale-copy.test.ts).
 */

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
  // One offer is one order: no per-stay check, cap or removed order.
  /order_exists/,
  /order_removed/,
  /order_attempts_exhausted/,
  /ordersPerStay/,
  /[Oo]rders per stay/,
  // Contract 6: agents open no Alipay or WeChat Pay payment, and the total
  // an order refuses has not changed.
  /stripe_alipay_wechat_pay/,
  /Pay with Alipay or WeChat Pay/,
  /wechatPay/,
  /payment_total_changed/,
  // A failed order's reason is one the server can tell apart.
  /details_refused/,
];

/** Only the token is USD-only: "in USD" is said of it alone. */
const IN_USD = /\bin USD\b/;

const ROOT = new URL("../../../", import.meta.url).pathname;
// Every member of each union: a new surface or topic fails the typecheck
// until it is listed here, so none is skipped.
const SURFACES = Object.keys({
  mcp: true,
  "claude-skill": true,
  cli: true,
} satisfies Record<GuideSurface, true>) as GuideSurface[];
const TOPICS = Object.keys({ main: true, planning: true } satisfies Record<GuideTopic, true>) as GuideTopic[];
const RENDER_SURFACES = Object.keys({ mcp: true, cli: true } satisfies Record<RenderSurface, true>) as RenderSurface[];

type Text = { where: string; text: string; usdAllowed?: boolean };

/** The guide's section on paying by token, which may say "in USD". */
const TOKEN_SECTION = /^## Paying without the link$[\s\S]*?(?=^## )/m;

/** A Markdown guide or skill, its token section allowed "in USD". */
function guideTexts(where: string, markdown: string): Text[] {
  const section = markdown.match(TOKEN_SECTION)?.[0];
  if (section === undefined) return [{ where, text: markdown }];
  return [
    { where, text: markdown.replace(TOKEN_SECTION, "") },
    { where: `${where} (Paying without the link)`, text: section, usdAllowed: true },
  ];
}

/** Every description in a JSON schema. */
function schemaTexts(where: string, node: unknown): Text[] {
  if (Array.isArray(node)) return node.flatMap((item, n) => schemaTexts(`${where}[${n}]`, item));
  if (typeof node !== "object" || node === null) return [];
  const record = node as Record<string, unknown>;
  const own: Text[] = typeof record.description === "string" ? [{ where, text: record.description }] : [];
  return [...own, ...Object.entries(record).flatMap(([key, value]) => schemaTexts(`${where}.${key}`, value))];
}

/** Minimal details for each code that has them; the rest send none. */
const ORDER = "ord_BundAwaiting00000000";
const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`fixtures/v1/${name}.json`, import.meta.url), "utf8"));
const errorDetails = (name: string) => fixture(name).envelope.error.details;
const OFFER = fixture("offers-two-hotels-one-unavailable").data.hotels[0].offers[0];
const DETAILS: Partial<Record<ErrorCode, unknown>> = {
  invalid_request: { issues: [{ pointer: "/stay", message: "m" }] },
  cursor_invalid: { reason: "expired" },
  offer_expired: { offerId: OFFER.offerId, expiredAt: "2026-11-01T00:00:00Z" },
  offer_changed: {
    changes: [
      {
        field: "total",
        previous: { amount: "300.00", currency: "USD" },
        current: OFFER.total,
        worse: true,
      },
    ],
    offer: OFFER,
  },
  offer_already_ordered: { orderId: ORDER },
  order_in_progress: { orderId: ORDER },
  order_not_cancellable: { cancel: { action: null, blockedBy: "confirming", penalty: null, refund: null } },
  order_not_payable: { orderId: ORDER, status: "confirmed" },
  payment_in_progress: { orderId: ORDER },
  payment_total_mismatch: { orderId: ORDER, total: { amount: "365.00", currency: "USD" } },
  payment_credential_invalid: { reason: "currency" },
  payment_declined: { declineCode: null },
  payment_method_unavailable: { reason: "payment_open_on_page" },
  destination_ambiguous: errorDetails("error-destination-ambiguous-suzhou"),
  destination_not_found: errorDetails("error-not-a-locality-patong"),
  search_too_broad: errorDetails("error-search-too-broad-bali"),
  stay_unsupported: { reason: "max_nights", max: 30 },
  stay_in_past: { checkIn: "2026-01-01", timeZone: "Asia/Shanghai" },
  offer_unavailable: { offerId: OFFER.offerId, reason: "sold_out" },
  currency_unavailable: { currency: "CNY" },
  rate_limited: { rateLimit: "search" },
  supplier_unavailable: { outcome: "not_started" },
};

function errorTexts(): Text[] {
  return RENDER_SURFACES.flatMap((surface) =>
    (Object.keys(ERROR_CODES) as ErrorCode[]).map((code) => {
      const details = DETAILS[code];
      const error = {
        code,
        message: "m",
        retryable: ERROR_CODES[code].retryable,
        requestId: "req_1",
        ...(details === undefined ? {} : { details }),
      };
      const text = renderError({ error }, ERROR_CODES[code].status[0], surface);
      // The details parsed: none fell back to raw JSON.
      assert.doesNotMatch(text, /^Details: /m, `${code}: ${text}`);
      return { where: `renderError ${code} (${surface})`, text };
    }),
  );
}

/** Files under `dir` that hold text, from the repository root. */
function textFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { recursive: true, encoding: "utf8" })
    .map((file) => join(dir, file))
    .filter((file) => /\.(?:md|json)$/.test(file));
}

/*
 * The plugin texts. Exempt, by name: the OpenAI plugin's example prompts and
 * its review cases' `prompt` and `expected_behavior` (what a user types and
 * what a reviewer checks, which may name USD), and the Claude plugin
 * README's example prompts.
 */
function pluginText(file: string): string {
  const source = readFileSync(join(ROOT, file), "utf8");
  if (file === "plugins/openai/plugin.json") {
    const manifest = JSON.parse(source);
    const openai = manifest.extensions["com.openai"];
    delete openai.interface.defaultPrompt;
    for (const cases of Object.values(openai.review.test_cases) as Record<string, unknown>[][]) {
      for (const entry of cases) {
        delete entry.prompt;
        delete entry.expected_behavior;
      }
    }
    return JSON.stringify(manifest, null, 2);
  }
  if (file === "plugins/claude/README.md") {
    return source.replace(/^## Example prompts$[\s\S]*?(?=^## )/m, "");
  }
  return source;
}

/** Each source of agent texts, by name. */
function agentSources(): Record<string, Text[]> {
  const pluginFiles = textFiles("plugins");
  const skillFiles = textFiles("skills");
  // Every file under plugins/ is text or an image.
  for (const file of readdirSync(join(ROOT, "plugins"), { recursive: true, encoding: "utf8" })) {
    if (statSync(join(ROOT, "plugins", file)).isFile()) assert.match(file, /\.(?:md|json|png)$/, file);
  }
  assert.ok(skillFiles.includes("skills/fortrip-cli/SKILL.md"), skillFiles.join(", "));
  assert.ok(pluginFiles.includes("plugins/claude/skills/fortrip/SKILL.md"), pluginFiles.join(", "));
  return {
    descriptions: TOOLS.map((spec) => ({ where: `${spec.name} description`, text: spec.description })),
    schemas: TOOLS.flatMap((spec) => [
      ...schemaTexts(`${spec.name} input`, z.toJSONSchema(spec.input, { io: "input" })),
      ...schemaTexts(`${spec.name} output`, z.toJSONSchema(spec.output, { io: "output" })),
    ]),
    calls: RENDER_SURFACES.flatMap((surface) =>
      Object.entries(CALLS[surface]).map(([key, text]) => ({ where: `CALLS.${surface}.${key}`, text })),
    ),
    nextSteps: [
      { where: "ORDER_NEXT_STEP", text: ORDER_NEXT_STEP },
      { where: "CANCEL_NEXT_STEP", text: CANCEL_NEXT_STEP },
      { where: "PAY_NEXT_STEP", text: PAY_NEXT_STEP, usdAllowed: true },
      { where: "PRESENTATION_HINT", text: PRESENTATION_HINT },
      ...RENDER_SURFACES.flatMap((surface) => [
        { where: `cancelNextStep(${surface})`, text: cancelNextStep(surface) },
        { where: `payNextStep(${surface})`, text: payNextStep(surface), usdAllowed: true },
      ]),
    ],
    guide: SURFACES.flatMap((surface) =>
      TOPICS.flatMap((topic) => guideTexts(`renderGuide ${surface} ${topic}`, renderGuide(surface, topic))),
    ),
    errors: errorTexts(),
    skills: skillFiles.flatMap((file) => guideTexts(file, readFileSync(join(ROOT, file), "utf8"))),
    plugins: pluginFiles.flatMap((file) => guideTexts(file, pluginText(file))),
  };
}

describe("no stale copy in what agents read", () => {
  const sources = agentSources();
  const texts = Object.values(sources).flat();

  it("collects the tools, next steps, guide, errors, skills and plugins", () => {
    for (const [name, source] of Object.entries(sources)) {
      assert.ok(source.length > 0 && source.every((t) => t.text.trim()), name);
    }
    assert.ok(texts.length > 300, String(texts.length));
    // The exemptions are not vacuous: each holds a statement in USD.
    for (const where of [
      "PAY_NEXT_STEP",
      "renderGuide cli main (Paying without the link)",
      "skills/fortrip-cli/SKILL.md (Paying without the link)",
    ]) {
      assert.match(texts.find((t) => t.where === where)?.text ?? "", IN_USD, where);
    }
  });

  it("states none of the old facts", () => {
    const found = texts.flatMap(({ where, text }) =>
      STALE.filter((pattern) => pattern.test(text)).map((pattern) => `${where}: ${pattern}`),
    );
    assert.deepEqual(found, []);
  });

  it('says "in USD" only of the token', () => {
    const found = texts
      .filter(({ text, usdAllowed }) => !usdAllowed && IN_USD.test(text))
      .map(({ where, text }) => `${where}: …${text.slice(Math.max(0, text.search(IN_USD) - 60), text.search(IN_USD) + 20)}…`);
    assert.deepEqual(found, []);
  });
});
