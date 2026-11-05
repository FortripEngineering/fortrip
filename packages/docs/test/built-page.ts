// Reads the output of `next build`, which the package's test script runs first.
import { readdirSync, readFileSync } from "node:fs";
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

/** Every built page's route: `index.html` is `/`, `mcp/x.html` is `/mcp/x`. */
export function pageRoutes(): string[] {
  return readdirSync(app, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".html") && !/(^|\/)_/.test(file))
    .map((file) => `/${file.replace(/\.html$/, "")}`.replace(/^\/index$/, "/"));
}

/** A static route handler's output by its path (`/llms.txt`, `/sitemap.xml`). */
export function routeBody(path: string): string {
  return readFileSync(join(app, `${path.slice(1)}.body`), "utf8");
}

/** A page's Markdown, as `/payments.md` serves it (the root's is `/index.md`). */
export function pageMarkdown(route: string): string {
  return routeBody(`/llms.md${route === "/" ? "/index" : route}`);
}

/** Markdown with its code (fenced blocks and inline spans) taken out. */
export function withoutCode(markdown: string): string {
  return markdown.replace(/^(```+|~~~+)[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, "").replace(/(`+)[\s\S]*?\1/g, "");
}
