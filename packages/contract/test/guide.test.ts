import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { COMMANDS, GLOBAL_FLAGS } from "../src/commands.ts";
import {
  type GuideSurface,
  type GuideTopic,
  renderGuide,
  renderText,
} from "../src/guide.ts";
import { BOARD_CODES, LIMITS, SUPPORT_EMAIL } from "../src/limits.ts";
import { ERROR_REASONS } from "../src/reasons.ts";

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
    "booking duration": /about two minutes/,
    "amount or terms null": new RegExp(
      `If \`amount\` or \`terms\` is null, don't give the link: call \`[^\`]+\` again with the same details, and if either is still null, tell the user to contact ${SUPPORT_EMAIL.replace(".", "\\.")}`,
    ),
    "rates occupancy": /both require `(--)?rooms` and `(--)?adults`/,
    "guest name": new RegExp(`1–${LIMITS.guestName} characters`),
    "search too broad": /`matched`/,
    "price units": /`totalPrice`/,
    paymentUrl: /exactly as returned/,
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

  it("price units: totalPrice for the whole stay, dailyPrices per room per night", () => {
    for (const surface of SURFACES) {
      assert.match(
        flat(renderGuide(surface, "main")),
        /`totalPrice` is the whole stay for all rooms, and `dailyPrices` are per room per night/,
        surface,
      );
    }
  });

  it("search too broad: matched and maxMatches, narrow the search", () => {
    for (const surface of SURFACES) {
      assert.match(
        flat(renderGuide(surface, "main")),
        /`matched` and `maxMatches`: narrow it/,
        surface,
      );
    }
  });

  it("paymentUrl: given exactly as returned, never rebuilt", () => {
    for (const surface of SURFACES) {
      assert.match(
        flat(renderGuide(surface, "main")),
        /give `paymentUrl` exactly as returned/,
        surface,
      );
    }
  });
});

describe("consent before the payment link, on every surface", () => {
  // Conditions decide what each surface shows, so one misplaced {{#if}}
  // could drop a consent step from one surface without any other error.
  for (const surface of SURFACES) {
    const book = renderText("{{tool:book}}", surface);

    it(`${surface} main: book only the picked rate, show the charge and terms, ask, wait`, () => {
      const text = flat(renderGuide(surface, "main"));
      for (const phrase of [
        `Call \`${book}\` only for the rate the user picked`,
        "end that reply by asking the user to confirm, and wait for a clear yes",
        "give `paymentUrl` exactly as returned",
      ]) {
        assert.ok(text.toLowerCase().includes(phrase.toLowerCase()), phrase);
      }
      assert.match(
        text,
        /[Ss]how (the user )?the `stay`[^.]*`amount`[^.]*`currency`[^.]*every item in `terms`/,
      );
    });

    it(`${surface} planning: the link only after the user confirms what book returned`, () => {
      const text = flat(renderGuide(surface, "planning"));
      for (const phrase of [
        `Call \`${book}\` only for the rate the user picked`,
        `give its payment link only after the user confirms the amount, currency, stay and terms that \`${book}\` returned`,
      ]) {
        assert.ok(text.includes(phrase), phrase);
      }
    });
  }
});

describe("the MCP instructions", () => {
  const text = flat(renderGuide("mcp", "main"));

  it("say what get_planning_guide is, never order a fetch of it", () => {
    assert.match(text, /`get_planning_guide` returns Fortrip's guidance for flexible dates/);
    assert.doesNotMatch(text, /follow it|call `?get_planning_guide/);
  });

  it("carry the cross-tool rules", () => {
    for (const phrase of [
      "Call order: `search_hotels` → (optional) `get_hotel` → `get_rates` → `create_booking`",
      "minimum-price feed, not live rates",
      "2 rooms for 4 adults is `rooms: 2, adults: 2`",
      "`nationality` given to `get_rates` isn't sent with the booking",
      "anyone holding it can pay",
      "Never ask for, accept or pass on payment card details; payment happens only on the payment page.",
      "Never ask the user to paste a token",
      `emails ${SUPPORT_EMAIL} with the booking's \`orderUrl\``,
    ]) {
      assert.ok(text.includes(phrase), phrase);
    }
  });

  it("name every tool as the server does", () => {
    for (const name of ["search_hotels", "get_hotel", "get_rates", "create_booking"]) {
      assert.match(text, new RegExp(`\`${name}\``), name);
    }
    assert.doesNotMatch(text, /fortrip:|fortrip search|--rooms/);
  });
});

describe("the Claude skill", () => {
  const main = renderGuide("claude-skill", "main");

  it("keeps the tools table, the payment-link sequence and the errors table", () => {
    assert.match(main, /^\| Tool \| Returns \|$/m);
    for (const tool of ["search_hotels", "get_hotel", "get_rates", "create_booking"]) {
      assert.match(main, new RegExp(`^\\| \`fortrip:${tool}\` \\|`, "m"), tool);
    }
    assert.match(main, /^## Before giving the payment link$/m);
    assert.match(main, /^1\. Show the `stay`/m);
    assert.match(main, /^2\. End that reply by asking the user to confirm/m);
    assert.match(main, /^3\. Then give `paymentUrl` exactly as returned/m);
    for (const reason of Object.keys(ERROR_REASONS)) {
      assert.match(main, new RegExp(`^\\| \`${reason}\` `, "m"), reason);
    }
  });

  it("points to its planning reference file, and has no CLI text", () => {
    assert.match(main, /\[references\/planning\.md\]\(references\/planning\.md\)/);
    assert.doesNotMatch(main, /--rooms|exit code|fortrip search/i);
  });

  it("names tools as fortrip:<tool>", () => {
    const planning = renderGuide("claude-skill", "planning");
    for (const text of [main, planning]) {
      assert.doesNotMatch(text, /(?<!fortrip:)\b(search_hotels|get_hotel|get_rates|create_booking)\b/);
    }
  });
});

describe("the CLI guide", () => {
  const main = flat(renderGuide("cli", "main"));
  const planning = flat(renderGuide("cli", "planning"));

  it("states the booking contract", () => {
    for (const phrase of [
      // Errors by reason.
      "`already_booked`",
      "`price_or_terms_changed`",
      "`rate_unavailable`",
      "`supplier_unavailable`",
      "`refused`",
      // Meal codes and quantity.
      "RO room only, BB breakfast, HB breakfast + dinner, FB breakfast + lunch + dinner, BL lunch, BD dinner, HBBL breakfast + lunch, HBLD lunch + dinner, AI all inclusive",
      "`boardCount`, how many guests per room the meal plan covers",
      "breakfast for 1 of 2",
      "`retryAfterSeconds`",
      // Occupancy and consent.
      "**per room**",
      "`--rooms 2 --adults 2`",
      "both require `--rooms` and `--adults`",
      "give `paymentUrl` exactly as returned",
      "`stay`",
      "Never ask for, accept or pass on payment card details",
      "`--nationality` given to `fortrip rates` isn't sent with the booking",
      "run it again with identical flags",
      "`nationality`) is rejected",
      // Errors and sign-in edge cases.
      "`maxMatches`",
      "at most 15 nights; book a longer stay as separate bookings",
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
      "`FORTRIP_CURRENCY`",
      "`fortrip guide planning`",
      "info@fortrip.ai",
    ]) {
      assert.ok(main.includes(phrase), phrase);
    }
  });

  it("is the guide of CLI 1.0: fortrip guide, browser sign-in, no paths", () => {
    for (const text of [main, planning]) {
      assert.doesNotMatch(text, /fortrip skill|fth_|\/api\//);
    }
    assert.doesNotMatch(main, /--rooms 1\]|\[--adults/);
  });

  it("the planning guide asks for confirmation of what book returned", () => {
    assert.ok(
      planning.includes(
        "give its payment link only after the user confirms the amount, currency, stay and terms that `fortrip book` returned",
      ),
    );
    assert.ok(planning.includes("Occupancy is per room and the same in every room"));
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

  it("names only commands the CLI has", () => {
    const names = new Set(COMMANDS.map((spec) => spec.name));
    for (const text of [main, planning]) {
      for (const [, name] of text.matchAll(/`fortrip ([a-z]+)/g)) {
        assert.ok(names.has(name as never), `fortrip ${name}`);
      }
    }
  });
});

describe("the full guides", () => {
  for (const surface of ["claude-skill", "cli"] as const) {
    const main = renderGuide(surface, "main");

    it(`${surface}: every error reason has a row`, () => {
      for (const reason of Object.keys(ERROR_REASONS)) {
        assert.match(main, new RegExp(`^\\| \`${reason}\``, "m"), reason);
      }
    });

    it(`${surface}: every meal code is explained`, () => {
      for (const code of BOARD_CODES) {
        assert.match(main, new RegExp(`\\b${code} [a-z]`), code);
      }
    });

    it(`${surface}: the limits are the contract's`, () => {
      const text = flat(main);
      assert.ok(
        text.includes(
          `1–${LIMITS.rooms} rooms, 1–${LIMITS.adultsPerRoom} adults and 0–${LIMITS.childrenPerRoom} children (aged 0–${LIMITS.childAgeMax}) per room, 1–${LIMITS.nights} nights`,
        ),
      );
    });
  }
});

describe("renderText", () => {
  it("renders tools for each surface", () => {
    assert.equal(renderText("{{tool:search}}", "mcp"), "search_hotels");
    assert.equal(renderText("{{tool:search}}", "claude-skill"), "fortrip:search_hotels");
    assert.equal(renderText("{{tool:search}}", "cli"), "fortrip search");
    assert.equal(renderText("{{tool:book}}", "mcp"), "create_booking");
    assert.equal(renderText("{{tool:guide}}", "mcp"), "get_planning_guide");
    assert.equal(renderText("{{tool:guide}}", "cli"), "fortrip guide");
    assert.equal(renderText("{{tool:whoami}}", "cli"), "fortrip whoami");
  });

  it("renders args as fields, or as the CLI's flags", () => {
    assert.equal(renderText("{{arg:rooms}}", "mcp"), "rooms");
    assert.equal(renderText("{{arg:rooms}}", "claude-skill"), "rooms");
    assert.equal(renderText("{{arg:rooms}}", "cli"), "--rooms");
    assert.equal(renderText("{{arg:childrenAges}}", "cli"), "--child-age");
    assert.equal(renderText("{{arg:checkIn}}", "cli"), "--check-in");
  });

  it("renders limits and the support address", () => {
    assert.equal(renderText("{{limit:nights}}", "cli"), String(LIMITS.nights));
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
