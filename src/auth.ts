import { hostname } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";

import { request, unwrap } from "./api.ts";
import { openBrowser } from "./browser.ts";
import {
  deleteToken,
  loadPendingLogin,
  loadStoredToken,
  type PendingLogin,
  resolveToken,
  savePendingLogin,
  saveToken,
} from "./credentials.ts";
import { CliError, EXIT } from "./errors.ts";

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
 * The token the commands send. Without one, a pending device login is
 * finished if the user has approved it; otherwise exit 3 with `loginUrl`, so
 * an agent that can't sit in `login` can hand the link to the user and rerun.
 */
export async function requireToken(apiUrl: string): Promise<string> {
  const resolved = await resolveToken(apiUrl);
  if (resolved) return resolved.token;

  const pending = await loadPendingLogin(apiUrl);
  if (pending) {
    const result = await exchange(apiUrl, pending.deviceCode);
    if (result.status === "ok") {
      await saveToken(apiUrl, result.accessToken);
      return result.accessToken;
    }
    if (result.status === "authorization_pending" || result.status === "slow_down") {
      throw loginRequired(apiUrl, pending);
    }
  }

  const start = await startDeviceLogin(apiUrl);
  const fresh: PendingLogin = {
    deviceCode: start.deviceCode,
    userCode: start.userCode,
    loginUrl: start.verificationUriComplete,
    expiresAt: new Date(Date.now() + start.expiresIn * 1_000).toISOString(),
  };
  await savePendingLogin(apiUrl, fresh);
  throw loginRequired(apiUrl, fresh);
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
    `Not logged in to ${apiUrl}. Ask the user to open loginUrl and approve, then rerun this command (or run \`npx fortrip login\` in a terminal).`,
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
  const resolved = token ?? (await requireToken(apiUrl));
  const data = unwrap(
    await request(apiUrl, "/api/cli/auth/whoami", { token: resolved }),
  ) as Record<string, unknown>;
  return { ...data, apiUrl };
}

/** The host name shown on the approval page, cut to what the API accepts. */
function deviceLabel(): string {
  return hostname()
    .replace(/[^\w .@-]/g, "")
    .slice(0, 64);
}
