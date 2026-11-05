import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The languages each example is written in: its tab, folder, extension and highlighting. */
export const EXAMPLE_LANGUAGES = [
  { label: "curl", dir: "curl", ext: "sh", lang: "bash" },
  { label: "TypeScript", dir: "ts", ext: "ts", lang: "ts" },
  { label: "Python", dir: "py", ext: "py", lang: "python" },
] as const;

/** An example's code in one language, read from `examples/` at build time.
 *  The files are what the examples test holds to the contract. */
export function exampleCode(name: string, language: (typeof EXAMPLE_LANGUAGES)[number]): string {
  return readFileSync(join(process.cwd(), "examples", language.dir, `${name}.${language.ext}`), "utf8").trimEnd();
}
