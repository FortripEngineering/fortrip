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
  tryLoginLock,
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
 * The token the commands send. Without one, a pending device login the user
 * has approved is finished; otherwise exit 3 with `loginUrl`, so an agent
 * that can't sit in `login` can hand the link to the user and rerun.
 */
export async function requireToken(
  apiUrl: string,
): Promise<{ token: string; source: "env" | "file" }> {
  const started = new Date().toISOString();
  const resolved = await resolveToken(apiUrl);
  if (resolved) return resolved;
  return { token: await finishOrStartLogin(apiUrl, started), source: "file" };
}

/**
 * One command at a time polls the pending logins or starts a new one; the
 * others wait for it and use what it found, so commands run in parallel
 * share one link and don't poll a login twice within its interval (which
 * would earn `slow_down`).
 */
async function finishOrStartLogin(apiUrl: string, started: string): Promise<string> {
  let release: (() => Promise<void>) | null;
  while (!(release = await tryLoginLock())) {
    const saved = await loadStoredToken(apiUrl);
    if (saved) return saved;
    await sleep(250);
  }
  try {
    const approved = await pollPendingLogins(apiUrl, started);
    if (approved) return approved;
    let pending = (await loadPendingLogins(apiUrl)).at(-1);
    if (!pending) {
      const start = await startDeviceLogin(apiUrl);
      const now = new Date();
      pending = {
        deviceCode: start.deviceCode,
        userCode: start.userCode,
        loginUrl: start.verificationUriComplete,
        expiresAt: new Date(now.getTime() + start.expiresIn * 1_000).toISOString(),
        interval: start.interval,
        checkedAt: now.toISOString(),
      };
      await addPendingLogin(apiUrl, pending);
    }
    // `fortrip login` may have saved a token meanwhile.
    const saved = await loadStoredToken(apiUrl);
    if (saved) return saved;
    throw loginRequired(apiUrl, pending);
  } finally {
    await release();
  }
}

/**
 * Polls each pending login and saves the token of the first one approved:
 * the user may have approved any link they were shown. A login known to be
 * unapproved since after this command started is skipped. Waits out each
 * login's interval, and polls once more after a `slow_down`. Returns that
 * token, or one another command saved.
 */
async function pollPendingLogins(
  apiUrl: string,
  started: string,
): Promise<string | null> {
  const saved = await loadStoredToken(apiUrl);
  if (saved) return saved;
  for (let login of await loadPendingLogins(apiUrl)) {
    if (login.checkedAt !== undefined && login.checkedAt > started) continue;
    for (let attempt = 0; attempt < 2; attempt++) {
      const wait = nextPollAt(login) - Date.now();
      if (wait > 0) await sleep(wait);
      const result = await exchange(apiUrl, login.deviceCode);
      // The server spaces polls by when it handled them; this is no earlier.
      const now = new Date().toISOString();
      if (result.status === "ok") {
        await saveToken(apiUrl, result.accessToken);
        return result.accessToken;
      }
      if (result.status === "slow_down") {
        const interval = result.interval ?? intervalOf(login) + 5;
        login = { ...login, lastPolledAt: now, interval };
        await updatePendingLogin(apiUrl, login.deviceCode, { lastPolledAt: now, interval });
        continue;
      }
      await updatePendingLogin(
        apiUrl,
        login.deviceCode,
        result.status === "authorization_pending"
          ? { lastPolledAt: now, checkedAt: now }
          : null, // denied, expired or already redeemed
      );
      break;
    }
  }
  return loadStoredToken(apiUrl);
}

/** Seconds between polls, kept to a sane range in case the file was edited. */
function intervalOf(login: PendingLogin): number {
  const { interval } = login;
  return typeof interval === "number" && Number.isFinite(interval)
    ? Math.min(Math.max(interval, 0), 60)
    : DEFAULT_INTERVAL_SECONDS;
}

/** One interval after the last poll, and never more than one interval away
 *  (a clock step can date the last poll in the future). */
function nextPollAt(login: PendingLogin): number {
  const last = Date.parse(login.lastPolledAt ?? "");
  if (!Number.isFinite(last)) return 0;
  return Math.min(last, Date.now()) + intervalOf(login) * 1_000;
}

/**
 * A request with the user's token. A saved token the server rejects
 * (revoked, or unused for 90 days) is forgotten and a new login started,
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
      `FORTRIP_TOKEN was rejected by ${apiUrl} (revoked, expired or invalid). It replaces the saved login: the user has to set a valid token or unset FORTRIP_TOKEN to sign in through the browser.`,
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
  await deleteToken(apiUrl, process.env, token);
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
