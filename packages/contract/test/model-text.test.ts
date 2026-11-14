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
 * What a model reads names what it can see. An MCP result is
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
  "spec", "status", "topic", "type", "unassigned", "unavailable", "unreadable", "until", "url", "version",
  "website", "window", "worse",
]);

const outputKeys = new Set(outputPaths.flat());
/** Refused wherever they stand: `fromPerRoomNight`, `usageLimits`, `nextCursor`. */
const REFUSED_KEYS = new Set(
  [...outputKeys].filter((key) => !OWN_ARGUMENTS.has(key) && !PLAIN_ENGLISH.has(key) && !STRIPE_NAMES.has(key)),
);
/** Refused wherever they stand: `payment.url`, `cancel.penalty`, `total.amount`. */
const REFUSED_CHAINS = new Set([...chains(outputPaths)].filter((chain) => !OWN_CHAINS.has(chain)));

const KEY = "[A-Za-z_][A-Za-z0-9_]*";

/** A path with indexes, read as its keys: `hotels[0].offers`, `data[].x` and
 *  `items[0]["hotel"]` are `hotels.offers`, `data.x` and `items.hotel`. */
function withoutIndexes(text: string): string {
  return text
    .replace(/\[\s*(?:\d+|\*)?\s*\]/g, "")
    .replace(new RegExp(`\\[\\s*["'](${KEY})["']\\s*\\]`, "g"), ".$1");
}

/** JSON Pointers in `text`, each as its keys: `/payment/status`, and
 *  `/items/0/hotel` without its index. Not part of a URL (a pointer starts
 *  after a space or a bracket, never after a host), and not an API route
 *  (`/v1/…`), which names endpoints. */
function pointers(text: string): string[][] {
  return [...text.matchAll(/(?<![A-Za-z0-9_.:\/-])(?!\/v\d+\/)((?:\/[A-Za-z0-9_]+){2,})/g)].map(([pointer]) =>
    pointer.split("/").filter((step) => step !== "" && !/^\d+$/.test(step)),
  );
}

/** A key with its fields listed after it in prose: "the payment object
 *  (status, url)", "cancel (action and blockedBy)". Named when every word
 *  listed is a field of that key in an answer. */
function proseForms(text: string): string[] {
  const found: string[] = [];
  for (const [, head, list] of text.matchAll(new RegExp(`\\b(${KEY})(?: (?:object|field|block))? \\(([^()]*)\\)`, "g"))) {
    const fields = (list as string).split(/,| and | or /).map((field) => field.trim()).filter(Boolean);
    if (fields.length === 0 || !fields.every((field) => new RegExp(`^${KEY}$`).test(field))) continue;
    if (fields.every((field) => REFUSED_CHAINS.has(`${head}.${field}`))) found.push(`${head} (${fields.join(", ")})`);
  }
  return found;
}

/** The output JSON paths `text` names, however they are written: dotted
 *  (`payment.url`), with indexes (`hotels[0].offers`), as a JSON Pointer
 *  (`/payment/status`), or as a key and its fields in prose ("payment
 *  object (status, url)"). */
function pathsNamed(text: string): string[] {
  const found = new Set<string>();
  const dotted = [...withoutIndexes(text).matchAll(new RegExp(`${KEY}(?:\\.${KEY})+`, "g"))].map(([path]) => path.split("."));
  for (const keys of [...dotted, ...pointers(text)]) {
    for (const chain of chains([keys])) if (REFUSED_CHAINS.has(chain)) found.add(chain);
  }
  for (const form of proseForms(text)) found.add(form);
  for (const [word] of text.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) if (REFUSED_KEYS.has(word)) found.add(word);
  for (const [, word] of text.matchAll(/`([A-Za-z_]+)`/g)) {
    if (PLAIN_ENGLISH.has(word as string) && !OWN_ARGUMENTS.has(word as string)) found.add(`\`${word}\``);
  }
  return [...found];
}

describe("the list of output JSON paths", () => {
  it("is built from the output schemas, and holds the paths a rule used to name", () => {
    for (const chain of ["payment.url", "cancel.penalty", "cancel.refund", "payment.tokenRequest", "payment.status", "indicativePrice.fromPerRoomNight", "handler.config.business_profile", "error.details", "details.issues"]) {
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

  // A path is a path in any notation: with an index, as a JSON Pointer, or
  // as a key with its fields listed after it. Each is planted in a real
  // description, which names none without it.
  it("finds a path written with brackets, as a pointer, or as a key and its fields in prose", () => {
    const description = TOOLS.find((spec) => spec.name === "get_order")!.description;
    assert.deepEqual(pathsNamed(description), []);
    /** What the checker finds once `words` stand in the description. */
    const planted = (words: string) => pathsNamed(`${description} ${words}`).sort();
    // Bracket forms: an index, an empty index, a quoted key.
    assert.deepEqual(planted("Read hotels[0].offers for the prices."), ["hotels.offers"]);
    assert.deepEqual(planted("Read data[].photo.caption first."), ["data.photo", "data.photo.caption", "photo.caption"]);
    assert.deepEqual(planted('Read items[0]["hotel"].cancellation.'), ["hotel.cancellation", "items.hotel.cancellation"]);
    // Pointer forms, with and without an index.
    assert.deepEqual(planted("Check /payment/status before paying."), ["payment.status"]);
    assert.deepEqual(planted("The terms are at /items/0/hotel/cancellation."), ["hotel.cancellation", "items.hotel.cancellation"]);
    // Prose forms: the key, then its fields in parentheses.
    assert.deepEqual(planted("See the payment object (status, url)."), ["payment (status, url)"]);
    assert.deepEqual(planted("The cancel field (action and blockedBy) says which."), ["blockedBy", "cancel (action, blockedBy)"]);
    assert.deepEqual(planted("Its payment (url) is the link."), ["payment (url)"]);
  });

  it("leaves alone what only looks like one: a URL, a route, a caller's own pointer, a label with its parts", () => {
    assert.deepEqual(pathsNamed("the page at https://fortrip.ai/orders/ord_1/payment/status"), []);
    assert.deepEqual(pathsNamed("POST /v1/hotels/offers answers the offers"), []);
    assert.deepEqual(pathsNamed("already given at /items/0/offerId: remove this one"), []);
    assert.deepEqual(pathsNamed("Field /stay/rooms/0/adults: must be at least 1"), []);
    assert.deepEqual(pathsNamed("the contact (name, email, phone), the stay (hotel, room, dates)"), []);
    assert.deepEqual(pathsNamed("the usage limits on that line (max_amount in cents, currency, expires_at)"), []);
    assert.deepEqual(pathsNamed("the penalty and the refund on its Cancel line (amount and currency)"), []);
  });

  it("finds a path however it is written", () => {
    assert.deepEqual(pathsNamed("give them payment.url exactly as returned"), ["payment.url"]);
    assert.deepEqual(pathsNamed("the order's `payment.tokenRequest` is not null").sort(), ["payment.tokenRequest", "tokenRequest"]);
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
    assert.deepEqual([...new Set(given)].sort(), ["cancel.penalty", "nextCursor", "payment.tokenRequest", "payment.tokenRequest.usageLimits", "tokenRequest", "tokenRequest.usageLimits", "usageLimits"]);
  });
});

/*
 * Paired evals pinned three behaviour rules in tool descriptions. Each is
 * also in the result text it governs. The consent rules of cancelling and
 * paying are now in that text alone: an eval measures whether they hold
 * without the description's sentence. Asking again after an offer changed
 * stays in create_order's description too.
 */
describe("the three pinned rules are in the result they govern", () => {
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
      assert.ok(lines.includes("Show the user these changes, then end your reply by asking them whether to order the new offer, and wait for their answer before ordering it."), surface);
      // After the changes and the new offer: the rule comes after its data.
      assert.ok(lines.indexOf("Show the user these changes, then end your reply by asking them whether to order the new offer, and wait for their answer before ordering it.") > lines.indexOf("New offer, held for ordering:"), surface);
    }
  });

  // The rule is in the results that govern it, not in the tool's description: an
  // eval rerun on 6.0.0-rc.1 measures whether it holds there alone.
  it("consent before cancelling: the cancel paragraph of the order's text, and not cancel_order's description", () => {
    assert.doesNotMatch(description("cancel_order"), /clear yes|only after the user/);
    assert.ok(description("cancel_order").includes("Paid (the order's Cancel line says it can be cancelled): pass maximumPenalty, the penalty on that line exactly as shown."));
    const RULE = "show the user the order's stay (hotel, dates) and the penalty and the refund on its Cancel line (amount and currency), then end your reply by asking them to confirm the cancellation, and wait for a clear yes.";
    const confirmed = fixture("order-confirmed").data;
    for (const surface of RENDER_SURFACES) {
      assert.ok(cancelNextStep(surface).includes(RULE), surface);
      // The last paragraph of every read that holds an order that can be cancelled.
      assert.ok(renderToolResult("get_order", confirmed, surface).endsWith(`\n\n${cancelNextStep(surface)}`), surface);
      assert.ok(renderToolResult("list_orders", { data: [confirmed], nextCursor: null }, surface).endsWith(`\n\n${cancelNextStep(surface)}`), surface);
      // And of the refusal that tells a caller the order is cancelled, not closed.
      const refusal = renderError(
        { error: { code: "order_not_cancellable", message: SERVER_MESSAGE, retryable: false, requestId: "req_1", details: { orderId: confirmed.orderId, cancel: confirmed.cancel } } },
        409,
        surface,
      );
      assert.ok(refusal.split("\n").includes(cancelNextStep(surface)), surface);
    }
  });

  it("consent before paying: the pay paragraph of the order's text, and not pay_order's description", () => {
    assert.doesNotMatch(description("pay_order"), /clear yes|only after the user/);
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
 * One function returns the whole text of a result, how to present
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
 * The text of an error is built from its code and details, so it is
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

/*
 * Rules that left a tool description for the text they govern.
 * Each stands in one place now, so each is pinned where it is: a rule that
 * can be deleted with every test green is a rule nobody will notice missing.
 */
describe("the rules that moved out of descriptions are in the text that governs them", () => {
  const ORDER = "ord_BundAwaiting00000000";
  const error = (code: ErrorCode, details: unknown, surface: RenderSurface, extra: Record<string, unknown> = {}) =>
    renderError({ error: { code, message: SERVER_MESSAGE, retryable: ERROR_CODES[code].retryable, requestId: "req_1", ...(details === undefined ? {} : { details }), ...extra } }, ERROR_CODES[code].status[0], surface);
  /** The one line of `text` that holds `words`. */
  const lineWith = (text: string, words: string) => {
    const lines = text.split("\n").filter((line) => line.includes(words));
    assert.equal(lines.length, 1, `${words}: ${text}`);
    return lines[0]!;
  };

  it("offer_already_ordered: pay only the new link", () => {
    for (const surface of RENDER_SURFACES) {
      const line = lineWith(error("offer_already_ordered", { orderId: ORDER }, surface), "pay only the new link");
      assert.ok(line.endsWith("When a new order replaces an unpaid one, tell the user to pay only the new link: the earlier one expires unpaid."), line);
      assert.ok(line.includes("for another order of the stay (another party, or a corrected guest name or contact), get offers again and order the new offer."), line);
    }
  });

  it("cancellation_changed: read the order, show the figures now on its Cancel line, ask again", () => {
    for (const surface of RENDER_SURFACES) {
      const line = lineWith(error("cancellation_changed", undefined, surface), "ask them again before cancelling");
      assert.match(line, /^Read the order again with (?:get_order|`fortrip orders get <orderId>`), show the user the penalty and the refund now on its Cancel line, and ask them again before cancelling\.$/);
    }
  });

  it("a payment is retried with the same token, never a new one", () => {
    for (const surface of RENDER_SURFACES) {
      assert.equal(
        lineWith(error("service_unavailable", undefined, surface), "never a new one"),
        "Retry once with the same details (a payment with the same token, never a new one); if it fails again, tell the user.",
      );
    }
    const mismatch = error("payment_total_mismatch", { orderId: ORDER, total: { amount: "365.00", currency: "USD" } }, "mcp");
    assert.ok(lineWith(mismatch, "the same token").includes("Confirm this total with the user, then call pay_order again with it and the same token. Nothing was charged."));
    // A token the order refused is the one case for a new one, and it says so.
    const invalid = error("payment_credential_invalid", { reason: "expired" }, "mcp");
    assert.ok(lineWith(invalid, "request a new one").endsWith('request a new one with the usage limits on the order\'s "Pay without the link" line. Nothing was charged.'));
  });

  it("a limit or an outage is waited out, then retried once", () => {
    for (const surface of RENDER_SURFACES) {
      assert.ok(lineWith(error("rate_limited", { rateLimit: "orders_pay" }, surface), "retry once").endsWith("counts payments: wait, then retry once."));
      assert.equal(
        lineWith(error("supplier_unavailable", { outcome: "unknown" }, surface), "Retry once"),
        "Retry once with the same details; if it fails again, tell the user.",
      );
      assert.ok(lineWith(error("order_in_progress", { orderId: ORDER }, surface), "wait, then").endsWith(": wait, then send the same call again with the same details."));
    }
  });

  it("rooms for different parties: one call per party, in the search note and in the error", () => {
    const search = JSON.parse(readFileSync(new URL("./fixtures/v1/search-locality-phuket.json", import.meta.url), "utf8")).data;
    search.notes = [{ code: "party_split_required", message: SERVER_MESSAGE }];
    for (const surface of RENDER_SURFACES) {
      assert.equal(
        lineWith(renderToolResult("search_hotels", search, surface), "party_split_required"),
        "- Note party_split_required: the rooms are for different parties, so the search used only the dates. Offers take one party per call: get offers for each party separately.",
      );
      assert.equal(
        lineWith(error("stay_unsupported", { reason: "mixed_occupancy" }, surface), "same party"),
        "Every room must have the same party: ask once per party.",
      );
    }
  });
});

/*
 * A value someone else wrote is shown in double quotes; what Fortrip
 * generates is bare. A rule that says "as shown" has to be read the same way
 * by every model: a name is given without its quotes, a link, a penalty and
 * a total have none to drop.
 */
describe("a rule that tells the model to copy what the text shows says what the quotes are", () => {
  const sources = agentSources();
  const golden = (name: string) => readFileSync(new URL(`./fixtures/v1/${name}.txt`, import.meta.url), "utf8");

  it("the presentation paragraph says names are in double quotes, as a JSON string, and are given without them", () => {
    assert.ok(
      PRESENTATION_HINT.endsWith(
        ' Otherwise use a short list. A hotel\'s name is shown in double quotes, as text from the hotel, written as a JSON string (inside it, \\" is a "): present it to the user without the quotes, exactly as written inside them. Never invent photos, ratings, reviews, prices, terms or coordinates.',
      ),
      PRESENTATION_HINT,
    );
    // What the clause is for: a name with quotes of its own is shown escaped, and read back whole.
    const hotel = JSON.parse(readFileSync(new URL("./fixtures/v1/hotel-long-description.json", import.meta.url), "utf8"));
    hotel.data.name = 'Hotel "Le Roi"';
    hotel.data.names = { en: hotel.data.name, zh: null };
    const shown = renderToolResult("get_hotel", hotel.data).split("\n")[0]!;
    assert.ok(shown.startsWith('Hotel: "Hotel \\"Le Roi\\"" · '), shown);
    assert.equal(JSON.parse(/^Hotel: ("(?:[^"\\]|\\.)*")/.exec(shown)![1]!), 'Hotel "Le Roi"');
  });

  // A search shows no coordinates, so the paragraph does not send the model to look for them there.
  it("the presentation paragraph says where coordinates are shown: in hotel details, not in a search", () => {
    assert.ok(
      PRESENTATION_HINT.includes(
        " and draw a map only from coordinates the text shows: hotel details show them, a search does not. Offer the choices",
      ),
      PRESENTATION_HINT,
    );
    const search = JSON.parse(readFileSync(new URL("./fixtures/v1/search-shanghai-area.json", import.meta.url), "utf8"));
    const { lat, lng } = search.data.data[0].location;
    assert.ok(!renderToolResult("search_hotels", search.data).split("\n").find((l) => l.startsWith("1. Hotel: "))!.includes(String(lat)));
    assert.equal(typeof lng, "number");
    const hotel = JSON.parse(readFileSync(new URL("./fixtures/v1/hotel-long-description.json", import.meta.url), "utf8"));
    assert.match(renderToolResult("get_hotel", hotel.data), / · coordinates -?\d+(?:\.\d+)?, -?\d+(?:\.\d+)? · /);
  });

  it("no model-facing text says to keep a value 'as returned'", () => {
    const names = ["descriptions", "calls", "nextSteps", "guide", "errors", "results", "skills"] as const;
    const found = names.flatMap((name) => (sources[name] as Text[]).filter(({ text }) => /as returned/i.test(text)).map(({ where }) => where));
    assert.deepEqual(found, []);
  });

  it("the guides say the same of a hotel's name, and of the names and contact of an order", () => {
    for (const { where, text } of [...(sources.guide as Text[]), ...(sources.skills as Text[])]) {
      assert.doesNotMatch(text, /hotel names as/i, where);
    }
    // Each skill says it once for every value, and again where an order is shown before paying.
    const QUOTES =
      'In that text, a value in double quotes (the name of a hotel, a room, a place or a guest, an address, the contact, special requests) is text someone else wrote, as a JSON string (inside it, \\" is a "): give it to the user without the quotes, exactly as written inside them. Ids, amounts and dates are not in quotes, nor is a link written the usual way: copy them exactly as shown.';
    for (const file of ["skills/fortrip-cli/SKILL.md", "plugins/claude/skills/fortrip/SKILL.md"]) {
      const skill = (sources.skills as Text[]).concat(sources.plugins as Text[]).filter(({ where }) => where.startsWith(file)).map(({ text }) => text).join("\n");
      assert.ok(skill.includes(QUOTES), file);
      assert.ok(
        skill.includes("The order's text shows names, the contact and special requests in double quotes: show the user what is inside the quotes, exactly as written, so they can catch a wrong one before paying"),
        file,
      );
      assert.ok(skill.includes("give the payment link exactly as shown (it is not in quotes; don't shorten, rebuild or re-encode it)"), file);
    }
    // The Claude skill has the presentation paragraph; both planning references say it of a plan's hotels.
    const all = [...(sources.skills as Text[]), ...(sources.plugins as Text[])].map(({ text }) => text).join("\n");
    assert.ok(all.includes('A hotel\'s name is shown in double quotes, as text from the hotel, written as a JSON string (inside it, \\" is a "): present it to the user without the quotes, exactly as written inside them.'));
    assert.equal(all.split("Give a hotel's name without the double quotes the text shows it in, exactly as written inside them, and dates in the user's notation.").length - 1, 2);
  });

  it("what a rule says to copy exactly is bare in the text: a payment link, a penalty, a total, an id", () => {
    const awaiting = golden("order-awaiting-payment");
    assert.match(awaiting, /^Payment link \([^)]*\): https:\/\/\S+$/m);
    assert.match(awaiting, /^Total: USD 365\.00 · /m);
    assert.match(awaiting, /^Order ord_BundAwaiting00000000 · reference FT-7KQ2MX · /m);
    assert.match(golden("order-confirmed"), /^Cancel: can cancel now: penalty USD 120\.00, refund USD 246\.00 \(/m);
    // And what someone else wrote is in quotes: a hotel's name, a guest's, the contact.
    assert.match(awaiting, /^Hotel: "The Bund Riverside Hotel" \("外滩江畔酒店"\) · /m);
    assert.match(awaiting, /^Guests: "Mary Smith", "Tom Smith"$/m);
    assert.match(awaiting, /^Contact: "Mary Smith" · "mary\.smith@example\.com" · "\+1 415 555 0134"$/m);
  });
});
