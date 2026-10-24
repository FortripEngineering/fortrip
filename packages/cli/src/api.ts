import { ERROR_CODES } from "@fortrip/agent-contract";

import { CliError, EXIT, type ErrorEnvelope, type ExitCode } from "./errors.ts";
import { VERSION } from "./version.ts";

export const LOGIN_HINT = "Rerun the command to get a new sign-in link.";

/** Longer than the API's longest route (`hotels book`, 120 s), so the CLI
 *  doesn't give up, and an agent retry, just as the server is answering. */
export const REQUEST_TIMEOUT_MS = 150_000;

/** Sign-in requests (to the OAuth server) answer quickly; a shorter limit
 *  also bounds how long a command holds the login lock for one. */
export const OAUTH_TIMEOUT_MS = 30_000;

export interface ApiResponse {
  status: number;
  /** The parsed JSON; null when the answer wasn't JSON. */
  body: unknown;
  headers: Headers;
  /** The start of an answer that wasn't JSON, for the error. */
  raw?: string;
}

/** One JSON request to the Fortrip API; never throws on HTTP status.
 *  `apiUrl` may end in a path prefix, which `path` follows. */
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
  try {
    return { status: response.status, body: JSON.parse(text), headers: response.headers };
  } catch {
    return { status: response.status, body: null, headers: response.headers, raw: text.slice(0, 200) };
  }
}

/**
 * One form-encoded POST to an OAuth endpoint (RFC 6749 §3.2, RFC 8628,
 * RFC 7009), whose answers are plain JSON; never throws on HTTP status.
 * The body carries codes and tokens, so a redirect isn't followed.
 */
export async function postForm(
  url: string,
  form: Record<string, string>,
  timeoutMs = OAUTH_TIMEOUT_MS,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { origin } = new URL(url);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": `fortrip-cli/${VERSION}`,
      },
      body: new URLSearchParams(form).toString(),
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw transportError(origin, error, undefined, timeoutMs);
  }
  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    throw transportError(origin, error, response.status, timeoutMs);
  }
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {}
  const body =
    parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  return { status: response.status, body };
}

/** No answer, or the connection dropped: worth one retry. */
function transportError(
  apiUrl: string,
  error: unknown,
  status?: number,
  timeoutMs = REQUEST_TIMEOUT_MS,
): CliError {
  const message =
    (error as Error)?.name === "TimeoutError"
      ? `No response from ${apiUrl} within ${timeoutMs / 1_000} s`
      : `Could not reach ${apiUrl}: ${(error as Error)?.message ?? String(error)}`;
  return new CliError(message, EXIT.error, {
    ...(status !== undefined ? { status } : {}),
    retryable: true,
  });
}

/** Whether an answer is the v1 error envelope. */
export function isEnvelope(body: unknown): body is ErrorEnvelope {
  const error = (body as { error?: unknown } | null)?.error;
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { code?: unknown }).code === "string"
  );
}

/** The exit code of an error: by its code, or, for a code this version
 *  doesn't know (or no envelope at all), by the HTTP status. */
function exitCodeFor(code: string | undefined, status: number): ExitCode {
  if (code !== undefined && Object.hasOwn(ERROR_CODES, code)) {
    return code === "invalid_request"
      ? EXIT.usage
      : code === "unauthenticated"
        ? EXIT.unauthenticated
        : code === "rate_limited"
          ? EXIT.rateLimited
          : EXIT.error;
  }
  return status === 400
    ? EXIT.usage
    : status === 401
      ? EXIT.unauthenticated
      : status === 429
        ? EXIT.rateLimited
        : EXIT.error;
}

/**
 * The resource a 2xx answer is, or a `CliError` carrying Fortrip's error
 * envelope, whose exit code follows the CLI contract: `invalid_request` 2,
 * `unauthenticated` 3, `rate_limited` 4, anything else 1.
 */
export function unwrap(response: ApiResponse): unknown {
  const { status, body, headers, raw } = response;
  if (status >= 200 && status < 300 && body !== null) return body;
  if (status >= 300 && status < 400) {
    throw new CliError(
      `Unexpected redirect to ${headers.get("location") ?? "?"}; check FORTRIP_API_URL`,
      EXIT.error,
      { status },
    );
  }
  if (isEnvelope(body)) {
    const { code, message, retryable } = body.error;
    const text = typeof message === "string" ? message : `Request failed with status ${status}`;
    const exitCode = exitCodeFor(code, status);
    throw new CliError(
      exitCode === EXIT.unauthenticated ? LOGIN_HINT : text,
      exitCode,
      { status, ...(retryable === true ? { retryable } : {}) },
      body,
    );
  }
  // Not the API's answer: a proxy's error page, or nothing. A 5xx is a
  // platform hiccup, and a 429 may still say how long to wait.
  const retryAfter = Number(headers.get("retry-after"));
  throw new CliError(`Unexpected ${status} answer from the API`, exitCodeFor(undefined, status), {
    status,
    ...(status >= 500 ? { retryable: true } : {}),
    ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfterSeconds: retryAfter } : {}),
    ...(raw ? { raw } : {}),
  });
}
