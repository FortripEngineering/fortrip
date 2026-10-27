import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  COMMAND_GROUPS,
  COMMANDS,
  commandInvocation,
  GLOBAL_FLAGS,
} from "../src/commands.ts";
import {
  type GuideSurface,
  type GuideTopic,
  renderGuide,
  renderText,
} from "../src/guide.ts";
import { LIMITS, SUPPORT_EMAIL } from "../src/limits.ts";
import { PRESENTATION_HINT, TOOLS } from "../src/tools.ts";

const SURFACES: readonly GuideSurface[] = ["mcp", "claude-skill", "cli"];
const TOPICS: readonly GuideTopic[] = ["main", "planning"];
const RENDERINGS = SURFACES.flatMap((surface) =>
  TOPICS.map((topic) => ({ surface, topic, label: `${surface} ${topic}` })),
);

/** The supplier's name, assembled so this file doesn't carry it. */
const SUPPLIER = new RegExp(["hui" + "zhi", "汇" + "智"].join("|"), "i");

/** Line breaks fall anywhere in Markdown prose. */
function flat(text: string): string {
  return text.replace(/\s+/g, " ");
}

function count(text: string, pattern: RegExp): number {
  return [...flat(text).matchAll(new RegExp(pattern, "g"))].length;
}

describe("renderGuide", () => {
  it("states how to present hotels in the Claude skill; MCP results carry PRESENTATION_HINT instead", () => {
    assert.match(renderGuide("claude-skill", "main"), /## Presenting hotels/);
    assert.doesNotMatch(renderGuide("mcp", "main"), /Presenting hotels/);
    assert.doesNotMatch(renderGuide("cli", "main"), /Presenting hotels/);
    // One rule, one text: the skill's section is the hint's.
    assert.ok(
      renderGuide("claude-skill", "main").includes(
        PRESENTATION_HINT.replace(/^Presentation: /, ""),
      ),
    );
    assert.match(PRESENTATION_HINT, /estimate per room-night/);
    assert.match(PRESENTATION_HINT, /never invent photos, ratings, reviews, prices, terms or coordinates/);
    assert.match(PRESENTATION_HINT, /whole stay for all rooms, in USD/);
  });

  for (const { surface, topic, label } of RENDERINGS) {
    it(`${label}: every token and condition is resolved`, () => {
      const text = renderGuide(surface, topic);
      assert.doesNotMatch(text, /{{|}}/);
      assert.ok(text.trim().length > 0);
    });

    it(`${label}: tidy Markdown, ending in one newline`, () => {
      const text = renderGuide(surface, topic);
      assert.match(text, /[^\n]\n$/);
      assert.doesNotMatch(text, /\n\n\n/);
      assert.doesNotMatch(text, /[ \t]+\n/);
    });

    it(`${label}: never names the supplier or an API path`, () => {
      const text = renderGuide(surface, topic);
      assert.doesNotMatch(text, SUPPLIER);
      assert.doesNotMatch(text, /\/api\//);
    });
  }

  for (const topic of TOPICS) {
    it(`claude-skill ${topic}: no npx, fortrip@latest or get_planning_guide (Directory Policy §2F)`, () => {
      const text = renderGuide("claude-skill", topic);
      assert.doesNotMatch(text, /\bnpx\b|fortrip@latest|get_planning_guide/);
    });
  }

  it("the MCP instructions are at most 2,500 characters", () => {
    const text = renderGuide("mcp", "main");
    assert.ok(text.length <= 2500, `${text.length} characters`);
  });

  it("is the same text every time", () => {
    for (const { surface, topic } of RENDERINGS) {
      assert.equal(renderGuide(surface, topic), renderGuide(surface, topic));
    }
  });
});

describe("the settled rules (design §3.4)", () => {
  // One phrase per rule, each said once per main guide, so no guide can
  // state a rule twice in two ways.
  const SETTLED: Record<string, RegExp> = {
    "order duration": /about two minutes/,
    "guest name": new RegExp(`1–${LIMITS.guestName} characters`),
    "search too broad": /`search_too_broad`/,
    "offer changed": /`offer_changed`/,
    "price units": /`price\.total` is the whole stay for all rooms/,
    "payment.url": /exactly as returned/,
    "one party per call": /one party per call/,
  };

  for (const surface of SURFACES) {
    for (const [rule, pattern] of Object.entries(SETTLED)) {
      it(`${surface} main states "${rule}" exactly once`, () => {
        assert.equal(count(renderGuide(surface, "main"), pattern), 1);
      });
      it(`${surface} planning states "${rule}" at most once`, () => {
        assert.ok(count(renderGuide(surface, "planning"), pattern) <= 1);
      });
    }
  }

  it("price units: price.total is the whole stay for all rooms, charged in USD for offers and their orders", () => {
    for (const surface of SURFACES) {
      assert.match(
        flat(renderGuide(surface, "main")),
        /`price\.total` is the whole stay for all rooms and is what is charged, in USD for offers and the orders made from them/,
        surface,
      );
    }
  });

  it("USD and Adaptive Pricing, stated plainly", () => {
    for (const surface of SURFACES) {
      const text = flat(renderGuide(surface, "main"));
      assert.match(text, /pay in (their|the) card's (local )?currency at Stripe's rate/, surface);
      assert.match(text, /`approx`[^.]*never the charge/, surface);
    }
  });

  it("search too broad: ask which locality unless one is named, pass it back by id, never by name", () => {
    for (const surface of SURFACES) {
      assert.match(
        flat(renderGuide(surface, "main")),
        /`search_too_broad`[^.]*localities[^.]*ask the user which[^.]*unless[^.]*already name[^.]*never by (its )?name/,
        surface,
      );
      assert.match(
        flat(renderGuide(surface, "planning")),
        /too broad to price, show its localities and ask the user which they prefer, unless the request already names one of them/,
        surface,
      );
    }
  });

  it('"4 stars" leaves out 4.5 unless the user means exactly 4, in main and planning', () => {
    for (const { surface, topic, label } of RENDERINGS) {
      if (surface === "mcp" && topic === "main") continue;
      assert.match(
        flat(renderGuide(surface, topic)),
        /"4 stars" as [^.]*leaves out 4\.5: unless the user means exactly 4, use [^.]* or ask/,
        label,
      );
    }
  });

  it("offer changed: show every change and ask again", () => {
    for (const surface of SURFACES) {
      assert.match(
        flat(renderGuide(surface, "main")),
        /`offer_changed`.{0,300}?every change.{0,200}?ask (the user )?again/,
        surface,
      );
    }
  });

  it("one party per call: one order per party", () => {
    for (const surface of SURFACES) {
      assert.match(
        flat(renderGuide(surface, "main")),
        /one party per call[^.]*order once per party/,
        surface,
      );
    }
  });

  it("guests: at least one per room, never invented", () => {
    for (const surface of SURFACES) {
      assert.match(
        flat(renderGuide(surface, "main")),
        /at least one guest per room[^.]*never invent guests/,
        surface,
      );
    }
  });

  it("destinations: a name needs its country, ambiguity means asking the user", () => {
    for (const surface of SURFACES) {
      const text = flat(renderGuide(surface, "main"));
      assert.match(text, /`destination_ambiguous`[^.]*ask the user[^.]*never pick one yourself/, surface);
      // D9: the API never guesses a country, so neither does the agent.
      assert.match(text, /`countryCode` \(ask the user if unclear\)|The country is required: ask the user when it isn't clear/, surface);
    }
  });

  it('"not listed" is not "no"', () => {
    for (const surface of SURFACES) {
      assert.match(flat(renderGuide(surface, "main")), /"[Nn]ot listed"[^.]* not "no"/, surface);
    }
  });

  it("payment.url: given exactly as returned, never rebuilt", () => {
    for (const surface of SURFACES) {
      assert.match(
        flat(renderGuide(surface, "main")),
        /give `payment\.url` exactly as returned/,
        surface,
      );
    }
  });

  it("no 2.0 vocabulary or fields", () => {
    for (const { surface, topic, label } of RENDERINGS) {
      const text = flat(renderGuide(surface, topic));
      assert.doesNotMatch(
        text,
        /live rates?|\b(the|a) rate\b|rate plan|paymentUrl|statusUrl|orderUrl|totalPrice|dailyPrices|boardCode|maxMatches|ratePlan|\bfx\b|`amount`|`terms`|\bbooking\b/i,
        label,
      );
    }
  });
});

describe("consent before the payment link, on every surface", () => {
  // Conditions decide what each surface shows, so one misplaced {{#if}}
  // could drop a consent step from one surface without any other error.
  for (const surface of SURFACES) {
    const book = renderText("{{tool:hotels book}}", surface);

    it(`${surface} main: order only the picked offer, show the charge and terms, ask, wait`, () => {
      const text = flat(renderGuide(surface, "main"));
      for (const phrase of [
        `Call \`${book}\` only for the offer the user picked`,
        "end that reply by asking the user to confirm, and wait for a clear yes",
        "give `payment.url` exactly as returned",
      ]) {
        assert.ok(text.toLowerCase().includes(phrase.toLowerCase()), phrase);
      }
      assert.match(
        text,
        /[Ss]how (the user )?the order's total[^.]*currency[^.]*the stay[^.]*every term/,
      );
    });

    it(`${surface} planning: the link only after the user confirms what book returned`, () => {
      const text = flat(renderGuide(surface, "planning"));
      for (const phrase of [
        `Call \`${book}\` only for the offer the user picked`,
        `give its payment link only after the user confirms the total, currency, stay and terms of the order \`${book}\` returned`,
      ]) {
        assert.ok(text.includes(phrase), phrase);
      }
    });
  }
});

describe("consent before cancelling an order", () => {
  for (const surface of ["claude-skill", "cli"] as const) {
    const cancel = renderText("{{tool:orders cancel}}", surface);
    const penalty = renderText("{{arg:maximumPenalty}}", surface);

    it(`${surface} main: show the stay, the penalty and the refund, ask, wait, then pass the penalty shown`, () => {
      const text = flat(renderGuide(surface, "main"));
      assert.match(text, /Show the user the stay[^.]*`cancel\.penalty` and `cancel\.refund` \(amount and currency\)/);
      assert.ok(
        text.includes("End that reply by asking the user to confirm the cancellation, and wait for a clear yes"),
      );
      assert.ok(text.includes(`\`${cancel}\` with \`${penalty}\` set to \`cancel.penalty.amount\` as shown`));
      assert.match(text, /Never state a refund the order didn't return, and never choose or work out an amount yourself/);
      assert.match(text, /`cancellation_changed`[^.]*read the order again and ask the user again/);
    });
  }

  // C7: the CLI never cancels without the penalty the user agreed to.
  it("the CLI guide says orders cancel without --max-penalty cancels nothing", () => {
    assert.match(
      flat(renderGuide("cli", "main")),
      /Without `--max-penalty`, `fortrip orders cancel` cancels nothing/,
    );
  });
});

describe("the MCP instructions", () => {
  const text = flat(renderGuide("mcp", "main"));

  it("say what get_planning_guide is, never order a fetch of it", () => {
    assert.match(text, /`get_planning_guide` returns Fortrip's guidance for flexible dates/);
    assert.doesNotMatch(text, /follow it|call `?get_planning_guide/);
  });

  it("carry the cross-tool rules", () => {
    for (const phrase of [
      "Call order: `search_hotels` → (optional) `get_hotel` → `get_hotel_offers` → `book_hotel`; after the user pays, `get_order`",
      "anyone holding it can pay",
      "Never ask for, accept or pass on payment card details; payment happens only on the payment page.",
      "Never ask the user to paste a token",
      `emails ${SUPPORT_EMAIL}`,
    ]) {
      assert.ok(text.includes(phrase), phrase);
    }
  });

  it("name every tool as the server does", () => {
    assert.equal(TOOLS.length, 8);
    for (const { name } of TOOLS) {
      assert.match(text, new RegExp(`\`${name}\``), name);
    }
    assert.doesNotMatch(text, /fortrip:|fortrip hotels|fortrip orders|--room/);
  });

  it("state each of these once", () => {
    for (const pattern of [/`offer_changed`/, /\bindicative\b/i, /\bget_order\b/, /`countryCode`/]) {
      assert.equal(count(text, pattern), 1, String(pattern));
    }
  });
});

describe("the Claude skill", () => {
  const main = renderGuide("claude-skill", "main");

  it("keeps the tools table and the payment-link sequence", () => {
    assert.match(main, /^\| Tool \| Returns \|$/m);
    for (const { name } of TOOLS.filter((tool) => tool.name !== "get_planning_guide")) {
      assert.match(main, new RegExp(`^\\| \`fortrip:${name}\` \\|`, "m"), name);
    }
    assert.match(main, /^## Before giving the payment link$/m);
    assert.match(main, /^1\. Show the order's total/m);
    assert.match(main, /^2\. End that reply by asking the user to confirm/m);
    assert.match(main, /^3\. Then give `payment\.url` exactly as returned/m);
  });

  it("points to its planning reference file, and has no CLI text", () => {
    assert.match(main, /\[references\/planning\.md\]\(references\/planning\.md\)/);
    assert.doesNotMatch(main, /--room|exit code|fortrip hotels|fortrip orders/i);
  });

  it("names tools as fortrip:<tool>", () => {
    const planning = renderGuide("claude-skill", "planning");
    for (const text of [main, planning]) {
      assert.doesNotMatch(text, /(?<!fortrip:)\b(search_hotels|get_hotel|get_hotel_offers|book_hotel|get_order|list_orders)\b/);
    }
  });
});

describe("the CLI guide", () => {
  const main = flat(renderGuide("cli", "main"));
  const planning = flat(renderGuide("cli", "planning"));

  it("states the booking contract", () => {
    for (const phrase of [
      "`retryAfterSeconds`",
      // Consent.
      "give `payment.url` exactly as returned",
      "`price.total`",
      "Never ask for, accept or pass on payment card details",
      "run it again with identical flags",
      // Errors and sign-in edge cases.
      'Exit 3 with `tokenSource: "FORTRIP_TOKEN"`',
      "The saved sign-in is kept until the user approves the new link",
      "allow the command at least 3 minutes",
      "can carry `warning`",
      // Sign-in, CLI options and support.
      "exits with code **3**",
      "`loginUrl`",
      "`userCode`",
      "Never ask the user to paste a token",
      "`--body",
      "`fortrip guide planning`",
      "`--json`",
      "`fortrip orders get`",
      "info@fortrip.ai",
    ]) {
      assert.ok(main.includes(phrase), phrase);
    }
  });

  it("is the guide of CLI 3.0: fortrip guide, browser sign-in, no paths", () => {
    for (const text of [main, planning]) {
      assert.doesNotMatch(text, /fortrip skill|fth_|\/api\//);
    }
    assert.doesNotMatch(main, /--rooms \d|--adults|--currency|FORTRIP_CURRENCY/);
  });

  it("the planning guide asks for confirmation of what book returned", () => {
    assert.ok(
      planning.includes(
        "give its payment link only after the user confirms the total, currency, stay and terms of the order `fortrip hotels book` returned",
      ),
    );
    assert.ok(planning.includes("Offers and orders take one party per call"));
  });

  it("names only flags the CLI has", () => {
    const known = new Set([
      ...COMMANDS.flatMap((spec) => [
        ...spec.flags.map((flag) => flag.flag),
        ...(spec.options ?? []).map((option) => option.flag),
      ]),
      ...GLOBAL_FLAGS.map((option) => option.flag),
    ]);
    for (const text of [main, planning]) {
      for (const [, flag] of text.matchAll(/(?<![\w-])--([a-z][a-z-]*)/g)) {
        assert.ok(known.has(flag as string), `--${flag}`);
      }
    }
  });

  it("names only commands the CLI has, with their group", () => {
    const invocations = new Set(COMMANDS.map(commandInvocation));
    const groups = new Set<string>(COMMAND_GROUPS.map((group) => group.name));
    let named = 0;
    for (const text of [main, planning]) {
      for (const [, first, second] of text.matchAll(/`fortrip ([a-z]+)(?: ([a-z]+))?/g)) {
        // A group alone (`fortrip hotels --help`) is its help.
        if (groups.has(first as string) && second === undefined) continue;
        const invocation = groups.has(first as string)
          ? `fortrip ${first} ${second}`
          : `fortrip ${first}`;
        assert.ok(invocations.has(invocation), invocation);
        named++;
      }
    }
    assert.ok(named > 10, `${named} commands named`);
  });

});

describe("the full guides", () => {
  for (const surface of ["claude-skill", "cli"] as const) {
    const main = renderGuide(surface, "main");
    const book = renderText("{{tool:hotels book}}", surface);
    const order = renderText("{{tool:orders get}}", surface);

    it(`${surface}: the rules of the full guide`, () => {
      const text = flat(main);
      for (const pattern of [
        // Text matching (§7.5).
        /[Tt]ypos return nothing/,
        /distinctive words/,
        // Stars (§7.7).
        /"4 stars" as [^.]*leaves out 4\.5/,
        // Amenities (§7.7).
        /"not listed" is not "absent"/,
        // Indicative versus offer prices (§7.9).
        /indicative[^.]*not bookable/,
        // A different party per room (§4).
        /`stay_unsupported`/,
        /`party_split_required`/,
        // Destinations (§7.2).
        /`destination_not_found`/,
        /\{ kind: "locality", placeId \}|--locality/,
        // After payment (§4).
        new RegExp(`check the order with \`${order}\``),
        // Purchases the protocol blocks (§10.1).
        /`order_exists`.{0,600}?another party.{0,300}?cancelled.{0,300}?website checkout.{0,300}?failed/,
        /`offer_already_ordered`/,
        /`order_removed`.{0,120}?get offers again and order the new offer/,
        /`order_in_progress`/,
        /`offer_expired`/,
        /`ordering_paused`/,
      ]) {
        assert.match(text, pattern, String(pattern));
      }
      assert.ok(text.includes(`\`${book}\``));
    });

    it(`${surface}: the limits are the contract's`, () => {
      const text = flat(main);
      assert.ok(
        text.includes(
          `1–${LIMITS.rooms} rooms, 1–${LIMITS.adultsPerRoom} adults and 0–${LIMITS.childrenPerRoom} children (aged 0–${LIMITS.childAgeMax}) per room, 1–${LIMITS.nightsSupplier} nights`,
        ),
      );
    });
  }
});

describe("renderText", () => {
  it("renders tools for each surface", () => {
    assert.equal(renderText("{{tool:hotels search}}", "mcp"), "search_hotels");
    assert.equal(renderText("{{tool:hotels search}}", "claude-skill"), "fortrip:search_hotels");
    assert.equal(renderText("{{tool:hotels search}}", "cli"), "fortrip hotels search");
    assert.equal(renderText("{{tool:hotels get}}", "cli"), "fortrip hotels get");
    assert.equal(renderText("{{tool:hotels offers}}", "mcp"), "get_hotel_offers");
    assert.equal(renderText("{{tool:orders list}}", "cli"), "fortrip orders list");
    assert.equal(renderText("{{tool:orders get}}", "mcp"), "get_order");
    assert.equal(renderText("{{tool:hotels book}}", "mcp"), "book_hotel");
    assert.equal(renderText("{{tool:hotels book}}", "claude-skill"), "fortrip:book_hotel");
    assert.equal(renderText("{{tool:guide}}", "mcp"), "get_planning_guide");
    assert.equal(renderText("{{tool:guide}}", "cli"), "fortrip guide");
    assert.equal(renderText("{{tool:whoami}}", "cli"), "fortrip whoami");
  });

  it("renders args as fields, or as the CLI's flags", () => {
    assert.equal(renderText("{{arg:stay.rooms}}", "mcp"), "stay.rooms");
    assert.equal(renderText("{{arg:stay.rooms}}", "claude-skill"), "stay.rooms");
    assert.equal(renderText("{{arg:stay.rooms}}", "cli"), "--room");
    assert.equal(renderText("{{arg:items.offerId}}", "cli"), "--offer");
    assert.equal(renderText("{{arg:stay.checkIn}}", "cli"), "--check-in");
  });

  it("renders limits and the support address", () => {
    assert.equal(renderText("{{limit:nightsSupplier}}", "cli"), String(LIMITS.nightsSupplier));
    assert.equal(renderText("{{support}}", "mcp"), SUPPORT_EMAIL);
  });

  it("keeps what a condition names for this surface", () => {
    const text = "a{{#if cli}} b{{/if}}{{#if mcp claude-skill}} c{{/if}} d";
    assert.equal(renderText(text, "cli"), "a b d");
    assert.equal(renderText(text, "mcp"), "a c d");
    assert.equal(renderText(text, "claude-skill"), "a c d");
  });

  it("drops a condition's own lines, and nests", () => {
    const text = [
      "one",
      "{{#if claude-skill cli}}",
      "two",
      "  {{#if cli}}",
      "  three",
      "  {{/if}}",
      "{{/if}}",
      "four",
      "",
    ].join("\n");
    assert.equal(renderText(text, "cli"), "one\ntwo\n  three\nfour\n");
    assert.equal(renderText(text, "claude-skill"), "one\ntwo\nfour\n");
    assert.equal(renderText(text, "mcp"), "one\nfour\n");
  });

  it("throws on an unknown token, so a typo can't ship", () => {
    for (const text of [
      "{{tool:serch}}",
      // A hotel command is named with its group.
      "{{tool:search}}",
      "{{tool:book}}",
      "{{tool:hotels}}",
      "{{tool:hotels whoami}}",
      "{{tool:hotels  search}}",
      "{{tool:hotels search extra}}",
      "{{arg:adutls}}",
      "{{limit:nigths}}",
      "{{suport}}",
      "{{ support }}",
      "{{tools:search}}",
      "{{support",
      "support}}",
    ]) {
      for (const surface of SURFACES) {
        assert.throws(() => renderText(text, surface), /guide/i, `${text} on ${surface}`);
      }
    }
  });

  it("throws on a tool the surface doesn't have", () => {
    // The Claude plugin ships the planning guide as a file (Directory Policy §2F).
    assert.throws(() => renderText("{{tool:guide}}", "claude-skill"), /guide/i);
    assert.throws(() => renderText("{{tool:whoami}}", "mcp"), /guide/i);
    assert.throws(() => renderText("{{tool:login}}", "claude-skill"), /guide/i);
  });

  it("throws on a broken or unknown condition", () => {
    for (const text of [
      "{{#if cli}}a",
      "a{{/if}}",
      "{{#if cli}}{{#if mcp}}a{{/if}}",
      "{{#if}}a{{/if}}",
      "{{#if claude}}a{{/if}}",
    ]) {
      for (const surface of SURFACES) {
        assert.throws(() => renderText(text, surface), /guide/i, `${text} on ${surface}`);
      }
    }
  });

  it("checks a condition's tokens on every surface, shown or not", () => {
    assert.throws(() => renderText("{{#if cli}}{{tool:serch}}{{/if}}", "mcp"), /guide/i);
  });
});
