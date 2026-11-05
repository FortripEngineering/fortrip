import type { ReactNode } from "react";

import type { FieldRow } from "./schema-rows.ts";

/** `code` spans inside plain descriptions. */
export function inline(text: string): ReactNode[] {
  return text.split(/(`[^`]+`)/).map((part, i) =>
    part.startsWith("`") ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: static text, never reordered
      <code key={i}>{part.slice(1, -1)}</code>
    ) : (
      part
    ),
  );
}

const BADGE = {
  required: "bg-fd-error/10 text-fd-error",
  optional: "bg-fd-secondary text-fd-muted-foreground",
};

export function FieldTable({ rows }: { rows: FieldRow[] }) {
  return (
    <div className="not-prose mt-4 border-t text-sm" role="list">
      {rows.map((row) => (
        <div
          key={row.key}
          role="listitem"
          className="border-b py-3"
          style={{ paddingLeft: row.depth * 20 }}
        >
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <code className="font-mono text-[13px] font-medium [overflow-wrap:anywhere]">
              {row.path}
            </code>
            <span className="font-mono text-xs text-fd-muted-foreground">
              {row.variant ? `when ${row.type}` : row.type}
            </span>
            {row.badge && (
              <span className={`rounded px-1.5 text-[11px] leading-[18px] ${BADGE[row.badge]}`}>
                {row.badge}
              </span>
            )}
          </div>
          {(row.description || row.meta.length > 0) && (
            <p className="mt-1 leading-relaxed">
              {inline(row.description)}
              {row.meta.length > 0 && (
                <span className="block text-xs text-fd-muted-foreground">
                  {row.meta.join(" · ")}
                </span>
              )}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
