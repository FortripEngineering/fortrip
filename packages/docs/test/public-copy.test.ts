import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/*
 * The public docs, their data and components must not name the hotel
 * supplier or a model. (Ported from fortrip-ai `components/docs/public-copy.test.ts`.)
 */

const ROOT = new URL("../", import.meta.url).pathname;
const SCANNED = ["content", "lib", "components", "app"];

const BANNED: Array<[string, RegExp]> = [
  ["the supplier's name or ids", /(?!)/],
  ["a model name", /\b(?:sonnet|opus|haiku|gpt-?\d|deepseek|gemini)\b/i],
];

test("the public docs name no supplier or model", () => {
  const found: string[] = [];
  let scanned = 0;
  for (const root of SCANNED) {
    const files = readdirSync(join(ROOT, root), { recursive: true, encoding: "utf8" }).filter(
      (file) => /\.(?:tsx?|mdx?|css|json)$/.test(file),
    );
    for (const file of files) {
      scanned += 1;
      readFileSync(join(ROOT, root, file), "utf8")
        .split("\n")
        .forEach((line, index) => {
          for (const [what, pattern] of BANNED) {
            if (pattern.test(line)) found.push(`${root}/${file}:${index + 1} ${what}`);
          }
        });
    }
  }
  assert.ok(scanned > 20, "the scan read the pages");
  assert.deepEqual(found, []);
});
