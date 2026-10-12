import { CliError, EXIT } from "./errors.ts";
import { VERSION } from "./version.ts";

export const LOGIN_HINT = "Run `npx @fortrip/huizhi login` first.";

const REQUEST_TIMEOUT_MS = 120_000;

export interface ApiResponse {
  status: number;
  body: Record<string, unknown>;
  headers: Headers;
}

/** One JSON request to the Fortrip API; never throws on HTTP status. */
export async function request(
  apiUrl: string,
  path: string,
  {
    method = "GET",
    token,
    body,
  }: { method?: string; token?: string; body?: unknown } = {},
): Promise<ApiResponse> {
  let response: Response;
  try {
    response = await fetch(`${apiUrl}${path}`, {
      method,
      headers: {
        accept: "application/json",
        "user-agent": `fortrip-cli/${VERSION}`,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      // A redirect to another origin would drop the Authorization header and
      // look like a logout; surface it instead.
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new CliError(
      `Could not reach ${apiUrl}: ${(error as Error).message}`,
      EXIT.error,
    );
  }
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = null;
  }
  const isObject = parsed !== null && typeof parsed === "object";
  return {
    status: response.status,
    body: isObject
      ? (parsed as Record<string, unknown>)
      : { error: `Unexpected ${response.status} response`, raw: text.slice(0, 200) },
    headers: response.headers,
  };
}

/** The `data` of a successful `{ success: true, data }` response, or a
 *  `CliError` whose exit code follows the CLI contract. */
export function unwrap(response: ApiResponse): unknown {
  const { status, body, headers } = response;
  if (status >= 200 && status < 300 && body.success === true) return body.data;

  const { success: _success, error, message, ...rest } = body;
  const text =
    typeof error === "string"
      ? error
      : typeof message === "string"
        ? message
        : `Request failed with status ${status}`;
  const details: Record<string, unknown> = { status, ...rest };

  if (status === 401) {
    throw new CliError(`${text}. ${LOGIN_HINT}`, EXIT.unauthenticated, details);
  }
  if (status === 429) {
    const retryAfter = Number(headers.get("retry-after"));
    throw new CliError(text, EXIT.rateLimited, {
      ...details,
      ...(Number.isFinite(retryAfter) && retryAfter > 0
        ? { retryAfterSeconds: retryAfter }
        : {}),
    });
  }
  if (status === 400) throw new CliError(text, EXIT.usage, details);
  if (status >= 300 && status < 400) {
    throw new CliError(
      `Unexpected redirect to ${headers.get("location") ?? "?"}; check FORTRIP_API_URL`,
      EXIT.error,
      details,
    );
  }
  throw new CliError(text, EXIT.error, details);
}
