import { hostname } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";

import { type ApiResponse, request, unwrap } from "./api.ts";
import { openBrowser } from "./browser.ts";
import {
  addPendingLogin,
  deleteToken,
  loadPendingLogins,
  loadStoredToken,
  type PendingLogin,
  resolveToken,
  saveToken,
  updatePendingLogin,
} from "./credentials.ts";
import { CliError, EXIT } from "./errors.ts";

/** RFC 8628's default poll interval, for logins saved without one. */
const DEFAULT_INTERVAL_SECONDS = 5;

interface DeviceStart {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  interval: number;
  expiresIn: number;
}

export interface LoginOptions {
  apiUrl: string;
  openBrowser: boolean;
  log: (line: string) => void;
  /** Injected by tests to skip real waiting. */
  wait?: (ms: number) => Promise<unknown>;
}

type Exchange =
  | { status: "ok"; accessToken: string }
  | { status: "authorization_pending" }
  | { status: "slow_down"; interval?: number }
  | { status: "access_denied" | "expired_token" };

/**
 * The token the commands send. Without one, pending device logins are
 * finished if the user has approved one; otherwise exit 3 with `loginUrl`,
 * so an agent that can't sit in `login` can hand the link to the user and
 * rerun.
 */
export async function requireToken(
  apiUrl: string,
): Promise<{ token: string; source: "env" | "file" }> {
  const resolved = await resolveToken(apiUrl);
  if (resolved) return resolved;

  const approved = await finishPendingLogin(apiUrl);
  if (approved) return { token: approved, source: "file" };

  let pending = (await loadPendingLogins(apiUrl)).at(-1);
  if (!pending) {
    const start = await startDeviceLogin(apiUrl);
    pending = {
      deviceCode: start.deviceCode,
      userCode: start.userCode,
      loginUrl: start.verificationUriComplete,
      expiresAt: new Date(Date.now() + start.expiresIn * 1_000).toISOString(),
      interval: start.interval,
    };
    await addPendingLogin(apiUrl, pending);
  }
  // Another command may have finished a login meanwhile.
  const saved = await loadStoredToken(apiUrl);
  if (saved) return { token: saved, source: "file" };
  throw loginRequired(apiUrl, pending);
}

/**
 * Polls every pending login for this API URL, including those other
 * commands started, and saves the token of the first one approved. Waits
 * out each login's interval rather than earn a `slow_down`; a login that
 * answers `slow_down` anyway (another command polled it just before) gets
 * one more poll. Returns that token, or one another command saved meanwhile.
 */
async function finishPendingLogin(apiUrl: string): Promise<string | null> {
  let logins = await loadPendingLogins(apiUrl);
  for (let round = 0; round < 2 && logins.length; round++) {
    const slowed: PendingLogin[] = [];
    for (const login of logins.sort((a, b) => nextPollAt(a) - nextPollAt(b))) {
      const saved = await waitForPoll(apiUrl, login);
      if (saved) return saved;
      const lastPolledAt = new Date().toISOString();
      const result = await exchange(apiUrl, login.deviceCode);
      switch (result.status) {
        case "ok":
          await saveToken(apiUrl, result.accessToken);
          return result.accessToken;
        case "authorization_pending":
          await updatePendingLogin(apiUrl, login.deviceCode, { lastPolledAt });
          break;
        case "slow_down": {
          const interval = result.interval ?? intervalOf(login) + 5;
          await updatePendingLogin(apiUrl, login.deviceCode, {
            lastPolledAt,
            interval,
          });
          slowed.push({ ...login, lastPolledAt, interval });
          break;
        }
        default:
          // Denied, expired, or already redeemed by another command.
          await updatePendingLogin(apiUrl, login.deviceCode, null);
      }
    }
    logins = slowed;
  }
  return loadStoredToken(apiUrl);
}

function intervalOf(login: PendingLogin): number {
  return login.interval ?? DEFAULT_INTERVAL_SECONDS;
}

/** When `login` may be polled again: one interval after the last poll. */
function nextPollAt(login: PendingLogin): number {
  const last = Date.parse(login.lastPolledAt ?? "");
  return Number.isFinite(last) ? last + intervalOf(login) * 1_000 : 0;
}

/** Sleeps until `login` may be polled, checking each second whether another
 *  command saved a token meanwhile, which it then returns. */
async function waitForPoll(
  apiUrl: string,
  login: PendingLogin,
): Promise<string | null> {
  // Never longer than one interval, whatever the clock said last time.
  const due = Math.min(nextPollAt(login), Date.now() + intervalOf(login) * 1_000);
  for (;;) {
    const saved = await loadStoredToken(apiUrl);
    if (saved) return saved;
    const left = due - Date.now();
    if (left <= 0) return null;
    await sleep(Math.min(left, 1_000));
  }
}

/**
 * A request with the user's token. A saved token the server rejects
 * (revoked, or deleted on the server) is forgotten and a new login started,
 * so the agent gets a `loginUrl` instead of a dead end. A rejected
 * `FORTRIP_TOKEN` is the user's to fix.
 */
export async function authorizedRequest(
  apiUrl: string,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<ApiResponse> {
  const auth = await requireToken(apiUrl);
  const response = await request(apiUrl, path, { ...init, token: auth.token });
  if (response.status !== 401) return response;
  if (auth.source === "env") {
    throw new CliError(
      `FORTRIP_TOKEN was rejected by ${apiUrl} (revoked or invalid). It replaces the saved login: the user has to set a valid token or unset FORTRIP_TOKEN to sign in through the browser.`,
      EXIT.unauthenticated,
      { status: 401, tokenSource: "FORTRIP_TOKEN" },
    );
  }
  await deleteToken(apiUrl, process.env, auth.token);
  // Exits 3 with a new loginUrl, unless another command signed in meanwhile.
  const fresh = await requireToken(apiUrl);
  return request(apiUrl, path, { ...init, token: fresh.token });
}

/** RFC 8628 device login: print the code, open the browser, poll. */
export async function login({
  apiUrl,
  openBrowser: shouldOpen,
  log,
  wait = sleep,
}: LoginOptions): Promise<unknown> {
  const start = await startDeviceLogin(apiUrl);

  log(`Confirm this code in your browser: ${start.userCode}`);
  log(`If the browser doesn't open, visit: ${start.verificationUriComplete}`);
  if (shouldOpen) openBrowser(start.verificationUriComplete);
  log("Waiting for approval…");

  let interval = start.interval;
  const deadline = Date.now() + start.expiresIn * 1_000;
  while (Date.now() < deadline) {
    await wait(interval * 1_000);
    const result = await exchange(apiUrl, start.deviceCode);
    switch (result.status) {
      case "ok":
        await saveToken(apiUrl, result.accessToken);
        log("Logged in.");
        return whoami(apiUrl, result.accessToken);
      case "authorization_pending":
        continue;
      case "slow_down":
        interval = result.interval ?? interval + 5;
        continue;
      case "access_denied":
        throw new CliError("Login was denied in the browser.", EXIT.error);
      case "expired_token":
        throw new CliError(
          "The login code expired. Run `login` again.",
          EXIT.error,
        );
    }
  }
  throw new CliError("The login code expired. Run `login` again.", EXIT.error);
}

async function startDeviceLogin(apiUrl: string): Promise<DeviceStart> {
  return unwrap(
    await request(apiUrl, "/api/cli/auth/device", {
      method: "POST",
      body: { label: deviceLabel(), platform: process.platform },
    }),
  ) as DeviceStart;
}

/** One poll of the token endpoint; unexpected errors throw via `unwrap`. */
async function exchange(apiUrl: string, deviceCode: string): Promise<Exchange> {
  const poll = await request(apiUrl, "/api/cli/auth/token", {
    method: "POST",
    body: { deviceCode },
  });
  if (poll.status === 200 && poll.body.success === true) {
    const { accessToken } = poll.body.data as { accessToken: string };
    return { status: "ok", accessToken };
  }
  switch (poll.body.error) {
    case "authorization_pending":
    case "access_denied":
    case "expired_token":
      return { status: poll.body.error };
    case "slow_down":
      return {
        status: "slow_down",
        interval: typeof poll.body.interval === "number" ? poll.body.interval : undefined,
      };
    default:
      unwrap(poll);
      throw new CliError(`Unexpected login response ${poll.status}`, EXIT.error);
  }
}

function loginRequired(apiUrl: string, pending: PendingLogin): CliError {
  return new CliError(
    `Not logged in to ${apiUrl}. Ask the user to open loginUrl and approve, then rerun this command.`,
    EXIT.unauthenticated,
    {
      loginUrl: pending.loginUrl,
      userCode: pending.userCode,
      expiresInSeconds: Math.max(
        0,
        Math.round((Date.parse(pending.expiresAt) - Date.now()) / 1_000),
      ),
    },
  );
}

/** Revokes the saved token for this API URL on the server, then forgets it. */
export async function logout(apiUrl: string): Promise<unknown> {
  const token = await loadStoredToken(apiUrl);
  if (!token) {
    throw new CliError(`Not logged in to ${apiUrl}.`, EXIT.unauthenticated);
  }
  const response = await request(apiUrl, "/api/cli/auth/revoke", {
    method: "POST",
    token,
  });
  // 401: already revoked or unknown — forgetting it locally is still right.
  if (response.status !== 401) unwrap(response);
  await deleteToken(apiUrl);
  return { loggedOut: true, apiUrl };
}

export async function whoami(apiUrl: string, token?: string): Promise<unknown> {
  const path = "/api/cli/auth/whoami";
  const data = unwrap(
    token
      ? await request(apiUrl, path, { token })
      : await authorizedRequest(apiUrl, path),
  ) as Record<string, unknown>;
  return { ...data, apiUrl };
}

/** The host name shown on the approval page, cut to what the API accepts. */
function deviceLabel(): string {
  return hostname()
    .replace(/[^\w .@-]/g, "")
    .slice(0, 64);
}
