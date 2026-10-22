import { CliError, EXIT } from "./errors.ts";
import { VERSION } from "./version.ts";

export const LOGIN_HINT = "Rerun the command to get a new sign-in link.";

/** Longer than the API's longest route (`book`, 120 s), so the CLI doesn't
 *  give up, and an agent retry, just as the server is answering. */
export const REQUEST_TIMEOUT_MS = 150_000;

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
    throw transportError(apiUrl, error);
  }
  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    throw transportError(apiUrl, error, response.status);
  }
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = null;
  }
  const isObject = parsed !== null && typeof parsed === "object";
  const result: Record<string, unknown> = isObject
    ? (parsed as Record<string, unknown>)
    : { error: `Unexpected ${response.status} response`, raw: text.slice(0, 200) };
  // A 5xx without the API's JSON (a proxy's error page, or nothing) is a
  // platform hiccup.
  if (response.status >= 500 && !(isObject && text)) result.retryable = true;
  return { status: response.status, body: result, headers: response.headers };
}

/** No answer, or the connection dropped: worth one retry. */
function transportError(apiUrl: string, error: unknown, status?: number): CliError {
  const message =
    (error as Error)?.name === "TimeoutError"
      ? `No response from ${apiUrl} within ${REQUEST_TIMEOUT_MS / 1_000} s`
      : `Could not reach ${apiUrl}: ${(error as Error)?.message ?? String(error)}`;
  return new CliError(message, EXIT.error, {
    ...(status !== undefined ? { status } : {}),
    retryable: true,
  });
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
  // A 429, or a retryable 503, says how long to wait.
  const retryAfter = Number(headers.get("retry-after"));
  const details: Record<string, unknown> = {
    status,
    ...rest,
    ...(Number.isFinite(retryAfter) && retryAfter > 0
      ? { retryAfterSeconds: retryAfter }
      : {}),
  };

  if (status === 401) {
    throw new CliError(`${text}. ${LOGIN_HINT}`, EXIT.unauthenticated, details);
  }
  if (status === 429) throw new CliError(text, EXIT.rateLimited, details);
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
