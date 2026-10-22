import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

type GuestName = typeof import("../src/guest-name.ts");

// These read the built package (`dist/`), which `pnpm test` builds first. They
// are imported by URL so `tsc --noEmit` does not need `dist/` to exist.
const dist = (name: string) => new URL(`../dist/${name}`, import.meta.url);

const GUEST_NAME_EXPORTS = [
  "GUEST_NAME_MESSAGE",
  "GUEST_NAME_PATTERN",
  "GUEST_NAME_TITLE",
  "guestNameRe",
  "normalizeGuestName",
];

/** Every module specifier a built file imports, re-exports or `import()`s. */
function specifiersOf(source: string): string[] {
  const found: string[] = [];
  const pattern =
    /\b(?:import|export)\b[^"';]*?\bfrom\s*["']([^"']+)["']|\bimport\s*["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/g;
  for (const match of source.matchAll(pattern)) {
    found.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return found;
}

/** The built file plus every relative module it reaches, with what they import. */
async function reachableFrom(entry: string) {
  const files = new Map<string, { source: string; specifiers: string[] }>();
  const queue = [entry];
  for (let name = queue.pop(); name !== undefined; name = queue.pop()) {
    if (files.has(name)) continue;
    const source = await readFile(dist(name), "utf8");
    const specifiers = specifiersOf(source);
    files.set(name, { source, specifiers });
    for (const specifier of specifiers) {
      if (specifier.startsWith("./")) queue.push(specifier.slice("./".length));
    }
  }
  return files;
}

function reachesZod(files: Awaited<ReturnType<typeof reachableFrom>>): boolean {
  return [...files.values()].some(
    ({ source, specifiers }) =>
      /zod/i.test(source) ||
      specifiers.some(
        (specifier) => specifier === "zod" || specifier.startsWith("zod/"),
      ),
  );
}

describe("the ./guest-name entry point", () => {
  it("exposes exactly the guest-name rule, equal to the root entry's", async () => {
    const entry = (await import(dist("guest-name.js").href)) as GuestName;
    const root = (await import(dist("index.js").href)) as GuestName;

    assert.deepEqual(Object.keys(entry).sort(), GUEST_NAME_EXPORTS);
    assert.equal(entry.GUEST_NAME_MESSAGE, root.GUEST_NAME_MESSAGE);
    assert.equal(entry.GUEST_NAME_PATTERN, root.GUEST_NAME_PATTERN);
    assert.equal(entry.GUEST_NAME_TITLE, root.GUEST_NAME_TITLE);
    assert.deepEqual(entry.guestNameRe, root.guestNameRe);
    for (const value of ["  O’Brien  ", "Anne \t Marie", "Wei"]) {
      assert.equal(
        entry.normalizeGuestName(value),
        root.normalizeGuestName(value),
      );
    }
    assert.equal(entry.normalizeGuestName("  O’Brien  "), "O'Brien");
  });

  it("resolves through the package's exports map", async () => {
    const specifier = "@fortrip/agent-contract/guest-name";
    const viaExports = (await import(specifier)) as GuestName;
    const direct = (await import(dist("guest-name.js").href)) as GuestName;

    assert.deepEqual(Object.keys(viaExports).sort(), GUEST_NAME_EXPORTS);
    assert.deepEqual(viaExports.guestNameRe, direct.guestNameRe);
  });

  it("does not reach zod, so browser code can import it cheaply", async () => {
    const files = await reachableFrom("guest-name.js");

    assert.ok(files.has("guest-name.js"));
    for (const [name, { specifiers }] of files) {
      assert.ok(
        specifiers.every((specifier) => specifier.startsWith("./")),
        `${name} imports a package: ${specifiers.join(", ")}`,
      );
    }
    assert.equal(reachesZod(files), false);
  });

  it("is told apart from the root entry, which does reach zod", async () => {
    assert.equal(reachesZod(await reachableFrom("index.js")), true);
  });
});
