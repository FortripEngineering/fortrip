// Reads the output of `next build`, which the package's test script runs first.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const app = new URL("../.next/server/app/", import.meta.url).pathname;

/** The languages a page is built in; the first is the default, whose routes
 *  have no prefix. */
const LANGS = ["en", "zh"] as const;

/** A built page's file by its route: `/` and `/api` are English (`en.html`,
 *  `en/api.html`), `/zh` and `/zh/api` Chinese (`zh.html`, `zh/api.html`). */
export function pageFile(route: string): string {
  const [, first = "", rest = ""] = /^\/([^/]*)(.*)$/.exec(route) ?? [];
  const translated = LANGS.slice(1).includes(first as (typeof LANGS)[number]);
  const lang = translated ? first : LANGS[0];
  const path = translated ? rest : route === "/" ? "" : route;
  return join(app, `${lang}${path}.html`);
}

/** A built page's HTML by its route (`/`, `/api`, `/zh/api`). */
export function pageHtml(route: string): string {
  return readFileSync(pageFile(route), "utf8");
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

/** Every built page's route in a language: `en.html` is `/`, `en/mcp.html`
 *  is `/mcp`; `zh.html` is `/zh`, `zh/mcp.html` is `/zh/mcp`. */
export function pageRoutes(lang: (typeof LANGS)[number] = LANGS[0]): string[] {
  const prefix = lang === LANGS[0] ? "" : `/${lang}`;
  const pages = readdirSync(join(app, lang), { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".html"))
    .map((file) => `${prefix}/${file.replace(/\.html$/, "")}`);
  return [prefix || "/", ...pages];
}

/** Every built page's route, in every language. */
export function allPageRoutes(): string[] {
  return LANGS.flatMap((lang) => pageRoutes(lang));
}

/** A static route handler's output by its path (`/llms.txt`, `/sitemap.xml`). */
export function routeBody(path: string): string {
  return readFileSync(join(app, `${path.slice(1)}.body`), "utf8");
}

/** A page's Markdown, as `/payments.md` and `/zh/payments.md` serve it (a
 *  root's is `/index.md`, `/zh/index.md`). */
export function pageMarkdown(route: string): string {
  const root = route === "/" || LANGS.slice(1).some((lang) => route === `/${lang}`);
  return routeBody(`/llms.md${route === "/" ? "" : route}${root ? "/index" : ""}`);
}

/** A page's route by its file under `content/docs`: `payments.mdx` is
 *  `/payments`, `payments.zh.mdx` `/zh/payments`, `index.zh.mdx` `/zh`. */
export function mdxRoute(file: string): string {
  const [, path = "", lang] = /^(.*?)(?:\.(\w+))?\.mdx$/.exec(file) ?? [];
  const prefix = lang ? `/${lang}` : "";
  const page = `/${path.replace(/(^|\/)index$/, "")}`.replace(/(.)\/$/, "$1");
  return page === "/" ? prefix || "/" : `${prefix}${page}`;
}

/** Markdown with its fenced code blocks taken out. */
export function withoutFences(markdown: string): string {
  return markdown.replace(/^(```+|~~~+)[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, "");
}

/** Markdown with its code (fenced blocks and inline spans) taken out. */
export function withoutCode(markdown: string): string {
  return withoutFences(markdown).replace(/(`+)[\s\S]*?\1/g, "");
}
