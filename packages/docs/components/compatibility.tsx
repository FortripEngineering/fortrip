import Link from "next/link";

import { PRE_RELEASE_POLICY } from "@/lib/prose/compatibility.ts";
import { inline } from "@/lib/reference/field-table.tsx";

/** The pre-release compatibility policy, with its links. */
export function PreReleasePolicy() {
  return (
    <p>
      {PRE_RELEASE_POLICY.split(/(\[[^\]]+\]\([^)]+\))/).map((part, i) => {
        const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
        return link ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: static text, never reordered
          <Link key={i} href={link[2] as string}>
            {inline(link[1] as string)}
          </Link>
        ) : (
          inline(part)
        );
      })}
    </p>
  );
}
