import { ServerCodeBlock } from "fumadocs-ui/components/codeblock.rsc";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";

import { EXAMPLE_LANGUAGES, exampleCode } from "@/lib/reference/examples.ts";

/** One example in three languages. */
export function Example({ name }: { name: string }) {
  return (
    <Tabs groupId="example-language" persist items={EXAMPLE_LANGUAGES.map((l) => l.label)}>
      {EXAMPLE_LANGUAGES.map((language) => (
        <Tab key={language.label} value={language.label}>
          <ServerCodeBlock lang={language.lang} code={exampleCode(name, language)} />
        </Tab>
      ))}
    </Tabs>
  );
}
