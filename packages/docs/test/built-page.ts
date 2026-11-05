// Reads the output of `next build`, which the package's test script runs first.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const app = new URL("../.next/server/app/", import.meta.url).pathname;

/** A built page's HTML by its route (`/`, `/api`, `/mcp`). */
export function pageHtml(route: string): string {
  return readFileSync(join(app, `${route === "/" ? "index" : route.slice(1)}.html`), "utf8");
}

/** A built page's text as a reader sees it: no scripts, no tags, entities
 *  decoded, React's `<!-- -->` separators gone, whitespace collapsed. */
export function pageText(route: string): string {
  return pageHtml(route)
    .replaceAll("<!-- -->", "")
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&amp;", "&")
    .replace(/\s+/g, " ")
    .replace(/ ([.,;:)])/g, "$1")
    .replace(/\( /g, "(");
}
