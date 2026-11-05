import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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

type DenyList = ReadonlyArray<readonly [digest: string, length: number]>;

/** A deny-list of supplier identifiers, stored hashed so the public repo
 *  doesn't name them: the SHA-256 (hex) of each identifier, lowercased with
 *  underscores removed, and its length in characters. */
const SUPPLIER_IDS: DenyList = [
  ["83744a8acc0bbd849f67cf8a663c8139244af28e0806e394902538ca94d8afbf", 6],
  ["a84517962b87b0482e3e0a1885aa7c1d761f74aecb37c59a7c9e5451b66f0905", 2],
  ["77cc3393037cd2c286855f6be406746866c1d3847c81768b50e5dfb06119eeb0", 9],
  ["3c43293d9e249bf8f2017fa8ac8bb719eb78aab4b001918d6c8d5dcb319d5931", 5],
];

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** The digests of `denyList` found in `text`: anywhere inside a run of
 *  letters and digits, with case and underscores ignored, so `Name`,
 *  `name_id`, `nameId` and a name inside a longer CJK run all match. */
function deniedIn(text: string, denyList: DenyList): string[] {
  const digests = new Set(denyList.map(([digest]) => digest));
  const lengths = new Set(denyList.map(([, length]) => length));
  const found = new Set<string>();
  for (const run of text.toLowerCase().replaceAll("_", "").match(/[\p{L}\p{N}]+/gu) ?? []) {
    const chars = [...run];
    for (const length of lengths) {
      for (let i = 0; i + length <= chars.length; i += 1) {
        const digest = sha256(chars.slice(i, i + length).join(""));
        if (digests.has(digest)) found.add(digest);
      }
    }
  }
  return [...found];
}

test("the supplier deny-list matches inside identifiers, case and underscores ignored", () => {
  // A stand-in list: the real one is hashed, so it can't be written out here.
  const list: DenyList = [
    [sha256("acmecorp"), 8],
    [sha256("旅行"), 2],
  ];
  for (const text of ["Booked through AcmeCorp.", "acme_corp_id", "acmeCorpHotels", "我们的旅行社"]) {
    assert.equal(deniedIn(text, list).length, 1, text);
  }
  for (const text of ["acme corp", "Acme", "旅 行", ""]) {
    assert.deepEqual(deniedIn(text, list), [], text);
  }
  assert.equal(SUPPLIER_IDS.length, 4);
  for (const [digest, length] of SUPPLIER_IDS) {
    assert.match(digest, /^[0-9a-f]{64}$/);
    assert.ok(Number.isInteger(length) && length > 0);
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
