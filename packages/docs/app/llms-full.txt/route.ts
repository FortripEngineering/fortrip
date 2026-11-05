import { docsLlms } from "@/lib/llms";

export const dynamic = "force-static";

/** Every page's Markdown, one after another. */
export async function GET() {
  return new Response(await docsLlms.full(), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
