import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/*
 * The public docs, their data and components must not name the hotel
 * supplier or a model.
 */

const ROOT = new URL("../", import.meta.url).pathname;
const SCANNED = ["content", "lib", "components", "app"];

const BANNED: Array<[string, RegExp]> = [["a model name", /\b(?:sonnet|opus|haiku|gpt-?\d|deepseek|gemini)\b/i]];

/** The supplier's identifiers, from the environment (a CI secret) so that
 *  this repository carries none: lowercased, underscores removed. Unset, as on
 *  a fork or a laptop, there is nothing to look for. */
const SUPPLIER_IDS = normalized(process.env.SUPPLIER_DENYLIST ?? "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

function normalized(text: string): string {
  return text.toLowerCase().replaceAll("_", "");
}

/** The entries of `denyList` found in `text`: anywhere inside a run of
 *  letters and digits, with case and underscores ignored, so `Name`,
 *  `name_id`, `nameId` and a name inside a longer CJK run all match. */
function deniedIn(text: string, denyList: readonly string[]): string[] {
  const runs = normalized(text).match(/[\p{L}\p{N}]+/gu) ?? [];
  return denyList.filter((id) => runs.some((run) => run.includes(id)));
}

test("the supplier deny-list matches inside identifiers, case and underscores ignored", () => {
  // A stand-in list: the real one is not in this repository.
  const list = ["acmecorp", "旅行"];
  for (const text of ["Booked through AcmeCorp.", "acme_corp_id", "acmeCorpHotels", "我们的旅行社"]) {
    assert.equal(deniedIn(text, list).length, 1, text);
  }
  for (const text of ["acme corp", "Acme", "旅 行", ""]) {
    assert.deepEqual(deniedIn(text, list), [], text);
  }
});

test("the public docs name no supplier or model", () => {
  const found: string[] = [];
  let scanned = 0;
  for (const root of SCANNED) {
    const files = readdirSync(join(ROOT, root), { recursive: true, encoding: "utf8" }).filter(
      // `app/openapi.json` is a route's folder.
      (file) => /\.(?:tsx?|mdx?|css|json)$/.test(file) && statSync(join(ROOT, root, file)).isFile(),
    );
    for (const file of files) {
      scanned += 1;
      readFileSync(join(ROOT, root, file), "utf8")
        .split("\n")
        .forEach((line, index) => {
          for (const [what, pattern] of BANNED) {
            if (pattern.test(line)) found.push(`${root}/${file}:${index + 1} ${what}`);
          }
          if (deniedIn(line, SUPPLIER_IDS).length > 0) found.push(`${root}/${file}:${index + 1} a supplier identifier`);
        });
    }
  }
  assert.ok(scanned > 20, "the scan read the pages");
  assert.deepEqual(found, []);
});
