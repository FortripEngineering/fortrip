import { hostname } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";

import { LOGIN_HINT, request, unwrap } from "./api.ts";
import { openBrowser } from "./browser.ts";
import {
  deleteToken,
  loadStoredToken,
  resolveToken,
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

/** The token the commands send, or exit 3 with the login hint. */
export async function requireToken(apiUrl: string): Promise<string> {
  const resolved = await resolveToken(apiUrl);
  if (!resolved) {
    throw new CliError(`Not logged in to ${apiUrl}. ${LOGIN_HINT}`, EXIT.unauthenticated);
  }
  return resolved.token;
}

/** RFC 8628 device login: print the code, open the browser, poll. */
export async function login({
  apiUrl,
  openBrowser: shouldOpen,
  log,
  wait = sleep,
}: LoginOptions): Promise<unknown> {
  const start = unwrap(
    await request(apiUrl, "/api/cli/auth/device", {
      method: "POST",
      body: { label: deviceLabel(), platform: process.platform },
    }),
  ) as DeviceStart;

  log(`Confirm this code in your browser: ${start.userCode}`);
  log(`If the browser doesn't open, visit: ${start.verificationUriComplete}`);
  if (shouldOpen) openBrowser(start.verificationUriComplete);
  log("Waiting for approval…");

  let interval = start.interval;
  const deadline = Date.now() + start.expiresIn * 1_000;
  while (Date.now() < deadline) {
    await wait(interval * 1_000);
    const poll = await request(apiUrl, "/api/cli/auth/token", {
      method: "POST",
      body: { deviceCode: start.deviceCode },
    });
    if (poll.status === 200 && poll.body.success === true) {
      const { accessToken } = poll.body.data as { accessToken: string };
      await saveToken(apiUrl, accessToken);
      log("Logged in.");
      return whoami(apiUrl, accessToken);
    }
    switch (poll.body.error) {
      case "authorization_pending":
        continue;
      case "slow_down":
        interval =
          typeof poll.body.interval === "number"
            ? poll.body.interval
            : interval + 5;
        continue;
      case "access_denied":
        throw new CliError("Login was denied in the browser.", EXIT.error);
      case "expired_token":
        throw new CliError(
          "The login code expired. Run `login` again.",
          EXIT.error,
        );
      default:
        unwrap(poll);
    }
  }
  throw new CliError("The login code expired. Run `login` again.", EXIT.error);
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
