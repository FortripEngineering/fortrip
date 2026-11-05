import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ServerCodeBlock } from "fumadocs-ui/components/codeblock.rsc";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";

const LANGUAGES = [
  { label: "curl", dir: "curl", ext: "sh", lang: "bash" },
  { label: "TypeScript", dir: "ts", ext: "ts", lang: "ts" },
  { label: "Python", dir: "py", ext: "py", lang: "python" },
] as const;

/** One example in three languages, read from `examples/` at build time. The
 *  files are what the examples test holds to the contract. */
export function Example({ name }: { name: string }) {
  return (
    <Tabs groupId="example-language" persist items={LANGUAGES.map((l) => l.label)}>
      {LANGUAGES.map(({ label, dir, ext, lang }) => (
        <Tab key={label} value={label}>
          <ServerCodeBlock
            lang={lang}
            code={readFileSync(join(process.cwd(), "examples", dir, `${name}.${ext}`), "utf8").trimEnd()}
          />
        </Tab>
      ))}
    </Tabs>
  );
}
