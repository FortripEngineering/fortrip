import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { z } from "zod";

import { ERROR_CODES, type ErrorCode } from "../src/errors.ts";
import { errorEnvelope } from "../src/outputs/error-details.ts";
import { renderHotel } from "../src/render/hotel.ts";
import { renderError, renderToolResult } from "../src/render/index.ts";
import { renderOffers } from "../src/render/offers.ts";
import { renderSearch } from "../src/render/search.ts";
import {
  cancelNextStep,
  payNextStep,
  PRESENTATION_HINT,
  type RenderSurface,
  TOOLS,
  type ToolName,
} from "../src/tools.ts";
import { agentSources, errorTexts, RENDER_SURFACES, SERVER_MESSAGE, type Text } from "./agent-texts.ts";

/*
 * What a model reads names what it can see (spec D2, D3). An MCP result is
 * one text block, so a model reads a tool's title, description and input
 * schema, the text of its results and errors, and the guide: never the JSON
 * of an answer. A rule that points at `payment.url` points at nothing.
 */

type Json = { properties?: Record<string, Json>; items?: Json; anyOf?: Json[]; oneOf?: Json[]; enum?: unknown[]; const?: unknown };

/** Every key path of a JSON Schema: the keys from the root to each property,
 *  through the items of a list and the branches of a union. */
function keyPaths(node: Json | undefined, path: string[] = []): string[][] {
  if (!node || typeof node !== "object") return [];
  return [
    ...Object.entries(node.properties ?? {}).flatMap(([key, child]) => [[...path, key], ...keyPaths(child, [...path, key])]),
    ...keyPaths(node.items, path),
    ...[...(node.anyOf ?? []), ...(node.oneOf ?? [])].flatMap((branch) => keyPaths(branch, path)),
  ];
}

/** Every value a JSON Schema names: its enums and constants. */
function namedValues(node: unknown): string[] {
  if (Array.isArray(node)) return node.flatMap(namedValues);
  if (!node || typeof node !== "object") return [];
  const { enum: values, const: only } = node as Json;
  return [
    ...(values ?? []).filter((v): v is string => typeof v === "string"),
    ...(typeof only === "string" ? [only] : []),
    ...Object.values(node).flatMap(namedValues),
  ];
}

/** Every run of two or more keys in a row along `paths`, dotted: `payment.url`. */
function chains(paths: string[][]): Set<string> {
  const found = new Set<string>();
  for (const path of paths) {
    for (let from = 0; from < path.length; from++) {
      for (let to = from + 2; to <= path.length; to++) found.add(path.slice(from, to).join("."));
    }
  }
  return found;
}

const outputs = [...TOOLS.map((spec) => spec.output), errorEnvelope].map((schema) => z.toJSONSchema(schema, { io: "output" }) as Json);
const inputs = TOOLS.map((spec) => z.toJSONSchema(spec.input, { io: "input" }) as Json);
const outputPaths = outputs.flatMap((json) => keyPaths(json));
const inputPaths = inputs.flatMap((json) => keyPaths(json));

/** What a caller writes itself: the keys of the inputs, and the values they
 *  name (`roomTypes`, `place_name`). A text may name these: they are the
 *  caller's own arguments. */
const OWN_ARGUMENTS = new Set([...inputPaths.flat(), ...namedValues(inputs)]);
const OWN_CHAINS = chains(inputPaths);

/** Stripe's own names for what a token is requested with. The order's "Pay
 *  without the link" line shows them as they are, since their values are
 *  copied into a Stripe call, so they are labels of the text too. */
const STRIPE_NAMES = new Set(["business_profile", "max_amount", "expires_at"]);

/**
 * Output keys that are also plain English words. Written as a word, one of
 * these names nothing in the JSON ("the total", "its status"), so it is
 * refused only as code, in backticks. Every other output key is refused
 * wherever it stands. A new lowercase key is listed here or fails the test.
 */
const PLAIN_ENGLISH = new Set([
  "action", "address", "at", "basis", "beds", "bookable", "cancel", "cancellation", "cancelled", "candidates", "caption", "center",
  "changes", "code", "config", "confirmation", "count", "coverage", "covers", "current", "data", "deposit",
  "description", "details", "disclosure", "dominated", "environment", "error", "failure", "field", "from", "handler",
  "hotels", "id", "included", "includes", "issues", "known", "label", "line", "listed", "localities", "mandatory",
  "matched", "meals", "members", "message", "mode", "more", "names", "notes", "offer", "offers", "omitted",
  "outcome", "payment", "penalties", "penalty", "photo", "photos", "places", "pointer", "policies", "population", "previous",
  "priced", "reason", "reference", "refund", "region", "required", "resolution", "retryable", "schema", "scope",
  "spec", "status", "token", "topic", "type", "unassigned", "unavailable", "unreadable", "until", "url", "version",
  "website", "window", "worse",
]);

const outputKeys = new Set(outputPaths.flat());
/** Refused wherever they stand: `fromPerRoomNight`, `usageLimits`, `nextCursor`. */
const REFUSED_KEYS = new Set(
  [...outputKeys].filter((key) => !OWN_ARGUMENTS.has(key) && !PLAIN_ENGLISH.has(key) && !STRIPE_NAMES.has(key)),
);
/** Refused wherever they stand: `payment.url`, `cancel.penalty`, `total.amount`. */
const REFUSED_CHAINS = new Set([...chains(outputPaths)].filter((chain) => !OWN_CHAINS.has(chain)));

/** The output JSON paths `text` names. */
function pathsNamed(text: string): string[] {
  const found = new Set<string>();
  for (const [dotted] of text.matchAll(/[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+/g)) {
    const keys = dotted.split(".");
    for (const chain of chains([keys])) if (REFUSED_CHAINS.has(chain)) found.add(chain);
  }
  for (const [word] of text.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) if (REFUSED_KEYS.has(word)) found.add(word);
  for (const [, word] of text.matchAll(/`([A-Za-z_]+)`/g)) {
    if (PLAIN_ENGLISH.has(word as string) && !OWN_ARGUMENTS.has(word as string)) found.add(`\`${word}\``);
  }
  return [...found];
}

describe("the list of output JSON paths", () => {
  it("is built from the output schemas, and holds the paths a rule used to name", () => {
    for (const chain of ["payment.url", "cancel.penalty", "cancel.refund", "payment.token", "payment.status", "indicativePrice.fromPerRoomNight", "handler.config.business_profile", "error.details", "details.issues"]) {
      assert.ok(REFUSED_CHAINS.has(chain), chain);
    }
    for (const key of ["fromPerRoomNight", "usageLimits", "nextCursor", "payAtProperty", "expiresAt", "requiresSignIn", "manageUrl", "blockedBy", "retryAfterSeconds", "roomType", "perRoomNight", "currencyHint", "localCharge"]) {
      assert.ok(REFUSED_KEYS.has(key), key);
    }
    assert.ok(REFUSED_CHAINS.size > 1000 && REFUSED_KEYS.size > 50, `${REFUSED_CHAINS.size} chains, ${REFUSED_KEYS.size} keys`);
  });

  it("leaves the caller's own arguments alone", () => {
    for (const own of ["stay.rooms", "hotel.rooms", "filters.price.maxPerRoomNight", "destination.radiusMeters"]) {
      assert.ok(!REFUSED_CHAINS.has(own), own);
    }
    for (const own of ["limitPerHotel", "maximumPenalty", "sharedPaymentToken", "offerId", "placeId", "countryCode", "roomTypes", "place_name"]) {
      assert.ok(!REFUSED_KEYS.has(own), own);
    }
  });

  it("every plain-English word listed is an output key, and every lowercase output key is listed or the caller's own", () => {
    for (const word of PLAIN_ENGLISH) assert.ok(outputKeys.has(word), word);
    for (const word of STRIPE_NAMES) assert.ok(outputKeys.has(word), word);
    const unlisted = [...outputKeys].filter((key) => /^[a-z]+$/.test(key) && !PLAIN_ENGLISH.has(key) && !OWN_ARGUMENTS.has(key));
    // What is left is refused wherever it stands: no word of plain English.
    assert.deepEqual(unlisted.sort(), []);
  });

  it("finds a path however it is written", () => {
    assert.deepEqual(pathsNamed("give them payment.url exactly as returned"), ["payment.url"]);
    assert.deepEqual(pathsNamed("the order's `payment.token` is not null").sort(), ["payment.token"]);
    assert.deepEqual(pathsNamed("its usageLimits (max_amount in cents)"), ["usageLimits"]);
    assert.deepEqual(pathsNamed("the order's `reference`, its status and its total"), ["`reference`"]);
    assert.deepEqual(pathsNamed("Pass maximumPenalty as that penalty; `total` is the order's total."), []);
  });
});

describe("no model-facing text names a JSON path of an answer", () => {
  const sources = agentSources();
  /** Read by a model: everything but the output schemas' own descriptions
   *  (the docs' and the HTTP API's) and the plugins' manifests and READMEs
   *  (a directory's and a person's). */
  const MODEL_FACING = ["descriptions", "calls", "nextSteps", "guide", "errors", "results", "skills"] as const;
  /** Shared with HTTP readers: an input's description, and the CLI flag that takes it. */
  const SHARED = ["inputs", "commands"] as const;

  it("collects the titles and descriptions, the paragraphs, the guides, every rendered result and error, and the skills", () => {
    for (const name of [...MODEL_FACING, ...SHARED]) assert.ok((sources[name] ?? []).length > 0, name);
    const count = MODEL_FACING.reduce((n, name) => n + (sources[name] as Text[]).length, 0);
    assert.ok(count > 150, String(count));
  });

  for (const name of MODEL_FACING) {
    it(`${name}: none`, () => {
      const found = (sources[name] as Text[]).flatMap(({ where, text }) => pathsNamed(text).map((path) => `${where}: ${path}`));
      assert.deepEqual(found, []);
    });
  }

  // HTTP readers share an input's description, so it may give the path of
  // what it describes: the concept first, the path in parentheses.
  for (const name of SHARED) {
    it(`${name}: an answer's path only in parentheses, after the concept`, () => {
      const inParentheses = /\([^()]*\)/g;
      const found = (sources[name] as Text[]).flatMap(({ where, text }) =>
        pathsNamed(text.replace(inParentheses, "")).map((path) => `${where}: ${path}`),
      );
      assert.deepEqual(found, []);
      const given = (sources[name] as Text[]).filter(({ text }) => pathsNamed(text).length > 0);
      assert.ok(given.length > 0, "the walk found the paths in parentheses");
      for (const { where, text } of given) assert.doesNotMatch(text, /^\(/, where);
    });
  }

  it("inputs: the paths given are the ones a model needs the concept for", () => {
    const given = (sources.inputs as Text[]).flatMap(({ text }) => pathsNamed(text));
    assert.deepEqual([...new Set(given)].sort(), ["cancel.penalty", "nextCursor", "payment.token", "payment.token.usageLimits", "token.usageLimits", "usageLimits"]);
  });
});

/*
 * Spec D3: paired evals pinned three behaviour rules in tool descriptions.
 * Each is also in the result text it governs, so that a later release can
 * cut the description's sentence once an eval covers the text alone.
 */
describe("the three pinned rules are in the description and in the result they govern", () => {
  const description = (name: ToolName) => TOOLS.find((spec) => spec.name === name)!.description;
  const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/v1/${name}.json`, import.meta.url), "utf8"));
  const offer = fixture("offers-two-hotels-one-unavailable").data.hotels[0].offers[0];

  it("ask again after an offer changed: create_order's description, and the offer_changed error", () => {
    assert.ok(
      description("create_order").includes(
        "If the price or terms changed since the offer, the answer is offer_changed with every change and a new offer: show the changes and ask the user again before ordering it.",
      ),
    );
    const error = {
      code: "offer_changed",
      message: SERVER_MESSAGE,
      retryable: false,
      requestId: "req_1",
      details: { changes: [{ field: "total", previous: { amount: "300.00", currency: "USD" }, current: offer.total, worse: true }], offer },
    };
    for (const surface of RENDER_SURFACES) {
      const lines = renderError({ error }, 409, surface).split("\n");
      assert.ok(lines.includes("Show the user these changes and ask again before ordering the new offer."), surface);
      // After the changes and the new offer: the rule comes after its data.
      assert.ok(lines.indexOf("Show the user these changes and ask again before ordering the new offer.") > lines.indexOf("New offer, held for ordering:"), surface);
    }
  });

  it("consent before cancelling: cancel_order's description, and the cancel paragraph of the order's text", () => {
    assert.ok(
      description("cancel_order").includes(
        "only after the user confirmed the penalty and the refund on that line with a clear yes, pass maximumPenalty, that penalty exactly as shown.",
      ),
    );
    const RULE = "show the user the order's stay (hotel, dates) and the penalty and the refund on its Cancel line (amount and currency), then end your reply by asking them to confirm the cancellation, and wait for a clear yes.";
    const confirmed = fixture("order-confirmed").data;
    for (const surface of RENDER_SURFACES) {
      assert.ok(cancelNextStep(surface).includes(RULE), surface);
      // The last paragraph of every read that holds an order that can be cancelled.
      assert.ok(renderToolResult("get_order", confirmed, surface).endsWith(`\n\n${cancelNextStep(surface)}`), surface);
      assert.ok(renderToolResult("list_orders", { data: [confirmed], nextCursor: null }, surface).endsWith(`\n\n${cancelNextStep(surface)}`), surface);
      // And of the refusal that tells a caller the order is cancelled, not closed.
      const refusal = renderError(
        { error: { code: "order_not_cancellable", message: SERVER_MESSAGE, retryable: false, requestId: "req_1", details: { cancel: confirmed.cancel } } },
        409,
        surface,
      );
      assert.ok(refusal.split("\n").includes(cancelNextStep(surface)), surface);
    }
  });

  it("consent before paying: pay_order's description, and the pay paragraph of the order's text", () => {
    assert.ok(
      description("pay_order").includes(
        "Call it only after the user confirmed the order's total and currency, the stay with each room's guests, the contact, any special requests and every term with a clear yes.",
      ),
    );
    const RULE = /Before you (?:call pay_order|run `fortrip orders pay`), show the user the order's total and currency, the stay \(hotel, room, dates, and each room's party and guest names\), the contact \(name, email, phone\), any special requests and every term \(meals, cancellation, fees payable at the property\), then end your reply by asking them to confirm, and wait for a clear yes\./;
    const payable = fixture("order-payable-by-token").data;
    for (const surface of RENDER_SURFACES) {
      assert.match(payNextStep(surface), RULE, surface);
      for (const tool of ["create_order", "get_order"] as const) {
        assert.ok(renderToolResult(tool, payable, surface).endsWith(`\n\n${payNextStep(surface)}`), `${surface} ${tool}`);
      }
      assert.ok(renderToolResult("list_orders", { data: [payable], nextCursor: null }, surface).endsWith(`\n\n${payNextStep(surface)}`), surface);
    }
  });
});

/*
 * Spec D2: one function returns the whole text of a result, how to present
 * hotels included, so the hosted server and the CLI's bridge append nothing
 * (a client may join separate text blocks with no separator).
 */
describe("renderToolResult owns the whole text: it alone adds how to present hotels", () => {
  const dir = new URL("./fixtures/v1/", import.meta.url);
  const fixtures = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(new URL(f, dir), "utf8")) as { tool?: ToolName; data?: unknown; envelope?: unknown; status?: number });
  const HOTEL_TOOLS = new Set<ToolName>(["search_hotels", "get_hotel", "get_hotel_offers"]);
  const times = (text: string) => text.split(PRESENTATION_HINT).length - 1;

  it("an MCP result of search_hotels, get_hotel and get_hotel_offers ends with it, once; no other text has it", () => {
    let hotels = 0;
    for (const f of fixtures) {
      if (f.tool === undefined) {
        for (const surface of RENDER_SURFACES) assert.equal(times(renderError(f.envelope, f.status, surface)), 0);
        continue;
      }
      const mcp = renderToolResult(f.tool, f.data, "mcp");
      assert.equal(times(mcp), HOTEL_TOOLS.has(f.tool) ? 1 : 0, f.tool);
      if (HOTEL_TOOLS.has(f.tool)) {
        hotels++;
        assert.ok(mcp.endsWith(`\n\n${PRESENTATION_HINT}`), f.tool);
        // The CLI's text is the same data without it: there the rule is the skill's.
        assert.equal(renderToolResult(f.tool, f.data, "cli").includes(PRESENTATION_HINT), false, f.tool);
      }
    }
    assert.ok(hotels >= 7, String(hotels));
  });

  it("a hotel result that is not in the expected shape still ends with it", () => {
    for (const tool of HOTEL_TOOLS) {
      const text = renderToolResult(tool, { unexpected: true });
      assert.match(text, /^This [a-z_]+ result is not in the expected shape/);
      assert.ok(text.endsWith(`\n\n${PRESENTATION_HINT}`) && times(text) === 1, tool);
      assert.equal(times(renderToolResult(tool, { unexpected: true }, "cli")), 0, tool);
    }
  });

  it("the renderers it calls add none of their own", () => {
    const data = (tool: ToolName) => fixtures.find((f) => f.tool === tool)!.data as never;
    for (const surface of RENDER_SURFACES) {
      assert.equal(times(renderSearch(data("search_hotels"), surface)), 0);
      assert.equal(times(renderOffers(data("get_hotel_offers"), surface)), 0);
    }
    assert.equal(times(renderHotel(data("get_hotel"))), 0);
  });

  // In the source: the paragraph is defined in tools.ts, added in
  // render/index.ts and exported by index.ts, and named nowhere else.
  it("no other module of the package names it", () => {
    const src = new URL("../src/", import.meta.url);
    const files = readdirSync(src, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".ts"));
    const naming = files.filter((f) => /PRESENTATION_HINT|Presentation: /.test(readFileSync(new URL(f, src), "utf8")));
    assert.deepEqual(naming.sort(), ["index.ts", "render/index.ts", "tools.ts"]);
    const adds = readFileSync(new URL("render/index.ts", src), "utf8").match(/\$\{PRESENTATION_HINT\}/g) ?? [];
    assert.equal(adds.length, 1);
  });
});

/*
 * Spec D2: the text of an error is built from its code and details, so it is
 * complete without the server's message, which names JSON paths.
 */
describe("every known error is worded without the server's message", () => {
  it("only client_outdated shows the message; every other code has words of its own, on both surfaces", () => {
    const texts = errorTexts();
    assert.equal(texts.length, Object.keys(ERROR_CODES).length * RENDER_SURFACES.length);
    for (const { where, text } of texts) {
      const outdated = where.startsWith("renderError client_outdated ");
      assert.equal(text.includes(SERVER_MESSAGE), outdated, where);
      const [head, retry, ...rest] = text.split("\n");
      assert.match(head!, /^Error [a-z_]+ \(HTTP \d+\): \S/, where);
      assert.match(retry!, /^(Retryable|Not retryable)/, where);
      // Beyond what happened: what to do next, then the request id.
      if (!outdated) assert.ok(rest.length >= 2, `${where}: ${text}`);
      assert.equal(rest.at(-1), "Request id: req_1", where);
    }
  });

  it("says what happened differently for every code", () => {
    const heads = new Set(
      (Object.keys(ERROR_CODES) as ErrorCode[]).map((code) =>
        renderError({ error: { code, message: SERVER_MESSAGE, retryable: false, requestId: "req_1" } }, 400).split("\n")[0],
      ),
    );
    // Details that don't parse fall back to the message: one head for those.
    assert.ok(heads.size >= 9, String(heads.size));
    const surface: RenderSurface = "mcp";
    const worded = new Set(errorTexts().filter(({ where }) => where.endsWith(`(${surface})`)).map(({ text }) => text.split("\n")[0]!.replace(/^Error [a-z_]+ \(HTTP \d+\): /, "")));
    assert.equal(worded.size, Object.keys(ERROR_CODES).length);
  });
});
