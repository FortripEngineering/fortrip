import { buildOpenApi } from "@/lib/openapi/build";

export const dynamic = "force-static";

export function GET() {
  return Response.json(buildOpenApi());
}
