import { setTimeout as sleep } from "node:timers/promises";

import { API, type AuthConfig, authConfig } from "@fortrip/agent-contract";

import { type ApiResponse, postForm, request, unwrap } from "./api.ts";
import { openBrowser } from "./browser.ts";
import {
  addPendingLogin,
  deleteSession,
  ensureCredentialsDir,
  loadPendingLogins,
  loadRecoveredSessions,
  loadSession,
  type PendingLogin,
  type Session,
  saveSession,
  tryLoginLock,
  updatePendingLogin,
} from "./credentials.ts";
import { CliError, EXIT, notices } from "./errors.ts";

/** RFC 8628's default poll interval, for logins saved without one. */
const DEFAULT_INTERVAL_SECONDS = 5;
/** How long a command waits for another that holds the login lock. A holder
 *  normally needs one interval plus a slow_down; this bounds a holder stuck
 *  on an unreachable server, which each waiter would otherwise repeat. */
const LOGIN_WAIT_MS = 30_000;
/** A pending login with less time left than this gets a fresh one to show. */
const SHOWABLE_FOR_MS = 120_000;
/** An access token with less time left than this is refreshed before use. */
const REFRESH_BEFORE_MS = 60_000;
/** Revoking the session a sign-in replaced is a courtesy to the server:
 *  it doesn't keep the command waiting longer than this. */
const REVOKE_REPLACED_TIMEOUT_MS = 5_000;
const DEVICE_CODE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
/** The token endpoint's answers to a device-code poll that aren't a token
 *  (RFC 8628 §3.5); the last four end the login. */
const POLL_ANSWERS = [
  "authorization_pending",
  "slow_down",
  "access_denied",
  "expired_token",
  "invalid_grant",
  "invalid_client",
] as const;

interface DeviceStart {
  deviceCode: string;
  userCode: string;
  loginUrl: string;
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
  | { status: "ok"; session: Session }
  | { status: (typeof POLL_ANSWERS)[number] };

type OAuthAnswer = { status: number; body: Record<string, unknown> };

/** Options tests use to avoid real waiting. */
export interface SignInOptions {
  /** How long to wait for another command that is signing in. */
  loginWaitMs?: number;
}

/** A character that can't go in an HTTP header value: a control character,
 *  or one past Latin-1. */
const UNSENDABLE_TOKEN = /[\x00-\x1f\x7f]|[^\x00-\xff]/;

/** The answer to a `FORTRIP_TOKEN` that has one: the same exit code as for
 *  one the server turns down. It names the variable and never says what it
 *  held: the error `fetch` throws for such a value quotes it, and that would
 *  reach stderr and, in the bridge, the MCP client. */
function unsendableToken(): CliError {
  return new CliError(
    "FORTRIP_TOKEN contains a line break or another character that can't be sent in a request header. Set it to the token alone, or unset it.",
    EXIT.unauthenticated,
    { tokenSource: "FORTRIP_TOKEN" },
  );
}

/**
 * The token the commands send: `FORTRIP_TOKEN` as it is, else the saved
 * session's, refreshed first when it has less than a minute left. Without a
 * session, a pending device login the user has approved is finished;
 * otherwise exit 3 with `loginUrl`, so an agent that can't sit in `login`
 * can hand the link to the user and rerun.
 */
export async function requireToken(
  apiUrl: string,
  options: SignInOptions = {},
): Promise<{ token: string; source: "env" | "file" }> {
  const { token, source } = await currentToken(apiUrl, options);
  return { token, source };
}

/** `fresh`: the token was issued during this call, so a refresh wouldn't
 *  make the server think better of it. */
async function currentToken(
  apiUrl: string,
  options: SignInOptions,
): Promise<{ token: string; source: "env" | "file"; fresh: boolean }> {
  const fromEnv = process.env.FORTRIP_TOKEN?.trim();
  if (fromEnv) {
    if (UNSENDABLE_TOKEN.test(fromEnv)) throw unsendableToken();
    return { token: fromEnv, source: "env", fresh: false };
  }
  const started = new Date().toISOString();
  const session = await loadSession(apiUrl);
  if (session && session.expiresAt - Date.now() >= REFRESH_BEFORE_MS) {
    return { token: session.accessToken, source: "file", fresh: false };
  }
  const token = session
    ? await refreshSession(apiUrl, session.accessToken)
    : await finishOrStartLogin(apiUrl, { started, ...options });
  return { token, source: "file", fresh: true };
}

interface SignIn extends SignInOptions {
  /** When the command started, as an ISO string. */
  started: string;
  /** A saved access token the server just turned down: not an answer here. */
  rejected?: string;
}

/**
 * One command at a time polls the pending logins or starts a new one; the
 * others wait for it and use what it found, so commands run in parallel
 * share one link and don't poll a login twice within its interval (which
 * would earn `slow_down`).
 */
async function finishOrStartLogin(apiUrl: string, signIn: SignIn): Promise<string> {
  const config = await loadAuthConfig(apiUrl);
  const lock = await takeLoginLock(
    signIn.loginWaitMs ?? LOGIN_WAIT_MS,
    () => savedToken(apiUrl, signIn),
    async () => {
      const pending = (await loadPendingLogins(apiUrl)).at(-1);
      return pending && isShowable(pending)
        ? loginRequired(apiUrl, pending, signIn)
        : busy(apiUrl);
    },
  );
  if (typeof lock === "string") return lock;
  try {
    const approved = await pollPendingLogins(apiUrl, config, signIn);
    if (approved) return approved;
    let pending = (await loadPendingLogins(apiUrl)).at(-1);
    // Keep polling an older login, but show one the user has time to open.
    if (!pending || !isShowable(pending)) {
      const start = await startDeviceLogin(config);
      const now = new Date();
      pending = {
        deviceCode: start.deviceCode,
        userCode: start.userCode,
        loginUrl: start.loginUrl,
        expiresAt: new Date(now.getTime() + start.expiresIn * 1_000).toISOString(),
        interval: start.interval,
        checkedAt: now.toISOString(),
      };
      await addPendingLogin(apiUrl, pending);
    }
    // `fortrip login` may have saved a session meanwhile.
    const saved = await savedToken(apiUrl, signIn);
    if (saved) return saved;
    throw loginRequired(apiUrl, pending, signIn);
  } finally {
    await lock();
  }
}

/**
 * Takes the login lock, waiting while another command holds it. While it
 * waits, `found` can end the wait with what that command saved; after
 * `waitMs` it throws what `giveUp` returns.
 */
async function takeLoginLock<T>(
  waitMs: number,
  found: () => Promise<T | null>,
  giveUp: () => Promise<CliError> | CliError,
): Promise<(() => Promise<void>) | T> {
  const giveUpAt = Date.now() + waitMs;
  for (;;) {
    const release = await tryLoginLock();
    if (release) return release;
    const result = await found();
    if (result !== null) return result;
    if (Date.now() > giveUpAt) throw await giveUp();
    await sleep(250);
  }
}

function busy(apiUrl: string): CliError {
  return new CliError(`Another fortrip command is still signing in to ${apiUrl}.`, EXIT.error, {
    retryable: true,
  });
}

/** A login link is worth showing while it has a couple of minutes left. */
function isShowable(login: PendingLogin): boolean {
  return Date.parse(login.expiresAt) - Date.now() >= SHOWABLE_FOR_MS;
}

async function savedToken(apiUrl: string, { rejected }: SignIn): Promise<string | null> {
  const saved = (await loadSession(apiUrl))?.accessToken ?? null;
  return saved !== rejected ? saved : null;
}

/**
 * Polls each pending login and saves the session of the first one approved:
 * the user may have approved any link they were shown. A login known to be
 * unapproved since after this command started is skipped (a time in the
 * future is a clock step, not knowledge). Waits out each login's interval,
 * and polls once more after a `slow_down`. Returns that session's access
 * token, or one another command saved.
 */
async function pollPendingLogins(
  apiUrl: string,
  config: AuthConfig,
  signIn: SignIn,
): Promise<string | null> {
  const saved = await savedToken(apiUrl, signIn);
  if (saved) return saved;
  const now = new Date().toISOString();
  for (let login of await loadPendingLogins(apiUrl)) {
    const { checkedAt } = login;
    if (checkedAt !== undefined && checkedAt > signIn.started && checkedAt <= now) {
      continue;
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      const wait = nextPollAt(login) - Date.now();
      if (wait > 0) await sleep(wait);
      // An answer of "pending" covers approvals up to the moment it was
      // asked, not up to when it arrived.
      const asked = new Date().toISOString();
      const result = await exchange(config, login.deviceCode);
      // The server spaces polls by when it handled them; this is no earlier.
      const lastPolledAt = new Date().toISOString();
      if (result.status === "ok") {
        try {
          const { replaced } = await saveSession(apiUrl, result.session);
          await revokeReplaced(config, replaced, result.session);
        } catch (error) {
          noteUnsaved(error);
        }
        return result.session.accessToken;
      }
      if (result.status === "slow_down") {
        const interval = intervalOf(login) + 5;
        login = { ...login, lastPolledAt, interval };
        await updatePendingLogin(apiUrl, login.deviceCode, { lastPolledAt, interval });
        continue;
      }
      await updatePendingLogin(
        apiUrl,
        login.deviceCode,
        result.status === "authorization_pending"
          ? { lastPolledAt, checkedAt: asked }
          : null, // denied, expired or already redeemed
      );
      break;
    }
  }
  return savedToken(apiUrl, signIn);
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
 * Refreshes the saved session whose access token is `stale`, and returns
 * the access token to use. It runs under the login lock and re-reads the
 * file first: when another command has refreshed (or signed in) meanwhile,
 * that session is used, so a refresh token the server rotates is never
 * spent twice (R2). A server that returns no new refresh token leaves the
 * old one in use.
 *
 * A refresh the server refuses (`invalid_grant`) ends the session: the
 * command signs in again, exiting 3 with `loginUrl` like any other, and the
 * old session stays saved until a new one replaces it (R1). A network error
 * or a 5xx is retryable and never starts a sign-in.
 */
export async function refreshSession(apiUrl: string, stale: string): Promise<string> {
  const started = new Date().toISOString();
  const config = await loadAuthConfig(apiUrl);
  const lock = await takeLoginLock(
    LOGIN_WAIT_MS,
    async () => {
      const session = await loadSession(apiUrl);
      return session && session.accessToken !== stale ? session.accessToken : null;
    },
    () => busy(apiUrl),
  );
  if (typeof lock === "string") return lock;
  let token: string | null;
  try {
    token = await refreshLocked(apiUrl, config, stale);
  } finally {
    await lock();
  }
  return token ?? finishOrStartLogin(apiUrl, { started, rejected: stale });
}

/** The refresh itself, under the login lock; null when the session is over. */
async function refreshLocked(
  apiUrl: string,
  config: AuthConfig,
  stale: string,
): Promise<string | null> {
  const session = await loadSession(apiUrl);
  if (!session) return null;
  if (session.accessToken !== stale) return session.accessToken;
  // The server issued no refresh token with this session.
  if (!session.refreshToken) return null;
  const answer = await postForm(config.tokenEndpoint, {
    grant_type: "refresh_token",
    refresh_token: session.refreshToken,
    client_id: session.clientId,
  });
  const next = sessionFrom(answer, session.clientId, session.refreshToken);
  if (!next) {
    if (answer.body.error === "invalid_grant" || answer.body.error === "invalid_client") {
      return null;
    }
    throw oauthFailure(`Refreshing the sign-in to ${apiUrl}`, answer);
  }
  let saved: Session | null = next;
  try {
    // A sign-in or logout meanwhile wins over this refresh.
    ({ saved } = await saveSession(apiUrl, next, process.env, stale));
  } catch (error) {
    noteUnsaved(error);
  }
  return (saved ?? next).accessToken;
}

/** A session the server issued but the file didn't take: the command uses
 *  it, and its JSON output says where it was kept. */
function noteUnsaved(error: unknown): void {
  notices.warning = (error as Error).message;
  if (error instanceof CliError && error.details.recoveryFile) {
    notices.recoveryFile = error.details.recoveryFile;
  }
}

/**
 * A request with the user's token. A 401 gets one refresh and a retry; if
 * the server still turns the token down, the command signs in again
 * (finishing an approved login, or exiting 3 with `loginUrl`). The saved
 * session is kept until a new one replaces it: a 401 can also come from a
 * passing problem on the server's side (R1). No other answer, a 503
 * included, starts a sign-in.
 */
export async function authorizedRequest(
  apiUrl: string,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<ApiResponse> {
  const auth = await currentToken(apiUrl, {});
  let token = auth.token;
  let response = await request(apiUrl, path, { ...init, token });
  if (response.status !== 401) return response;
  if (auth.source === "env") {
    throw new CliError(
      `${apiUrl} didn't accept FORTRIP_TOKEN. If this keeps happening, the user should replace it, or unset it to sign in through the browser.`,
      EXIT.unauthenticated,
      { status: 401, tokenSource: "FORTRIP_TOKEN" },
    );
  }
  if (!auth.fresh) {
    token = await refreshSession(apiUrl, token);
    response = await request(apiUrl, path, { ...init, token });
    if (response.status !== 401) return response;
  }
  token = await finishOrStartLogin(apiUrl, {
    started: new Date().toISOString(),
    rejected: token,
  });
  return request(apiUrl, path, { ...init, token });
}

/** RFC 8628 device login: print the code, open the browser, poll. */
export async function login({
  apiUrl,
  openBrowser: shouldOpen,
  log,
  wait = sleep,
}: LoginOptions): Promise<unknown> {
  // A directory that can't be written, or a credentials file that can't be
  // read, fails here, not after the user has approved.
  await ensureCredentialsDir();
  await loadSession(apiUrl);
  const config = await loadAuthConfig(apiUrl);
  const start = await startDeviceLogin(config);

  log(`Confirm this code in your browser: ${start.userCode}`);
  log(`If the browser doesn't open, visit: ${start.loginUrl}`);
  if (shouldOpen) openBrowser(start.loginUrl);
  log("Waiting for approval…");

  const expired = () =>
    new CliError("The login code expired. Run `login` again.", EXIT.error);
  let interval = start.interval;
  const deadline = Date.now() + start.expiresIn * 1_000;
  while (Date.now() < deadline) {
    await wait(interval * 1_000);
    const result = await exchange(config, start.deviceCode);
    switch (result.status) {
      case "ok": {
        const { replaced } = await saveSession(apiUrl, result.session);
        await revokeReplaced(config, replaced, result.session);
        log("Logged in.");
        return whoami(apiUrl, result.session.accessToken);
      }
      case "authorization_pending":
        continue;
      case "slow_down":
        interval += 5;
        continue;
      case "access_denied":
        throw new CliError("Login was denied in the browser.", EXIT.error);
      case "invalid_client":
        throw new CliError(
          `The sign-in server doesn't accept the client ${apiUrl}'s sign-in config names (invalid_client).`,
          EXIT.error,
        );
      case "expired_token":
      case "invalid_grant":
        throw expired();
    }
  }
  throw expired();
}

/** Where and how to sign in to `apiUrl`: its public sign-in config. */
async function loadAuthConfig(apiUrl: string): Promise<AuthConfig> {
  const parsed = authConfig.safeParse(unwrap(await request(apiUrl, API.authConfig)));
  if (!parsed.success) {
    throw new CliError(`${apiUrl} sent a sign-in config this CLI can't read.`, EXIT.error);
  }
  return parsed.data;
}

async function startDeviceLogin(config: AuthConfig): Promise<DeviceStart> {
  const answer = await postForm(config.deviceAuthorizationEndpoint, {
    client_id: config.clientId,
    scope: config.scopes,
  });
  const { device_code, user_code, verification_uri, verification_uri_complete, expires_in, interval } =
    answer.body;
  if (
    !isOk(answer.status) ||
    typeof device_code !== "string" ||
    typeof user_code !== "string" ||
    typeof verification_uri !== "string" ||
    typeof expires_in !== "number"
  ) {
    throw oauthFailure("Starting a sign-in", answer);
  }
  return {
    deviceCode: device_code,
    userCode: user_code,
    loginUrl:
      typeof verification_uri_complete === "string" ? verification_uri_complete : verification_uri,
    interval: typeof interval === "number" ? interval : DEFAULT_INTERVAL_SECONDS,
    expiresIn: expires_in,
  };
}

/** One poll of the token endpoint; unexpected answers throw. */
async function exchange(config: AuthConfig, deviceCode: string): Promise<Exchange> {
  const answer = await postForm(config.tokenEndpoint, {
    grant_type: DEVICE_CODE_GRANT,
    device_code: deviceCode,
    client_id: config.clientId,
  });
  const session = sessionFrom(answer, config.clientId);
  if (session) return { status: "ok", session };
  const { error } = answer.body;
  const known = POLL_ANSWERS.find((code) => code === error);
  if (known) return { status: known };
  throw oauthFailure("Signing in", answer);
}

/** The session a token answer carries, or null if it isn't one. A refresh
 *  answered without a new refresh token keeps `refreshToken`. */
function sessionFrom(
  { status, body }: OAuthAnswer,
  clientId: string,
  refreshToken = "",
): Session | null {
  const { access_token, refresh_token, expires_in } = body;
  if (!isOk(status) || typeof access_token !== "string" || access_token === "") return null;
  return {
    accessToken: access_token,
    refreshToken: typeof refresh_token === "string" && refresh_token ? refresh_token : refreshToken,
    expiresAt:
      Date.now() + (typeof expires_in === "number" && expires_in > 0 ? expires_in * 1_000 : 0),
    clientId,
  };
}

function isOk(status: number): boolean {
  return status >= 200 && status < 300;
}

/** An OAuth server's error answer; a 5xx or a 429 is worth a retry. Only
 *  the error code and description are said, never the request's tokens. */
function oauthFailure(what: string, { status, body }: OAuthAnswer): CliError {
  const code = typeof body.error === "string" ? body.error : `HTTP ${status}`;
  const description =
    typeof body.error_description === "string" ? `: ${body.error_description}` : "";
  return new CliError(`${what} failed (${code}${description}).`, EXIT.error, {
    status,
    ...(status >= 500 || status === 429 ? { retryable: true } : {}),
  });
}

function loginRequired(
  apiUrl: string,
  pending: PendingLogin,
  { rejected }: SignIn,
): CliError {
  return new CliError(
    rejected
      ? `${apiUrl} didn't accept the saved sign-in (it may have been revoked or expired, or the server had a passing problem). Ask the user to open loginUrl and approve, then rerun this command. The saved sign-in is kept until then.`
      : `Not logged in to ${apiUrl}. Ask the user to open loginUrl and approve, then rerun this command.`,
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

/**
 * Revokes the refresh token of every session saved for this API URL (also
 * those kept in recovery files), then forgets them. It holds the login lock
 * and re-reads, so a session another command refreshes meanwhile is the one
 * revoked. A revocation that fails keeps everything, so logout can be rerun.
 */
export async function logout(apiUrl: string): Promise<unknown> {
  if (!(await loadSession(apiUrl))) {
    throw new CliError(`Not logged in to ${apiUrl}.`, EXIT.unauthenticated);
  }
  const config = await loadAuthConfig(apiUrl);
  const release = await takeLoginLock<never>(LOGIN_WAIT_MS, async () => null, () => busy(apiUrl));
  try {
    const sessions = [await loadSession(apiUrl), ...(await loadRecoveredSessions(apiUrl))].filter(
      (session) => session !== null,
    );
    const revoked = new Set<string>();
    for (const session of sessions) {
      if (revoked.has(session.refreshToken)) continue;
      await revoke(config, session);
      revoked.add(session.refreshToken);
    }
    // Also merges the recovery files back and removes them.
    await deleteSession(
      apiUrl,
      process.env,
      sessions.map((session) => session.accessToken),
    );
  } finally {
    await release();
  }
  return { loggedOut: true, apiUrl };
}

/** RFC 7009. A 400 or 401 says the server doesn't know the token (already
 *  revoked, or expired): forgetting it locally is still right. */
async function revoke(
  config: AuthConfig,
  session: Session,
  timeoutMs?: number,
): Promise<void> {
  const answer = await postForm(
    config.revocationEndpoint,
    {
      token: session.refreshToken,
      token_type_hint: "refresh_token",
      client_id: session.clientId,
    },
    timeoutMs,
  );
  if (!isOk(answer.status) && answer.status !== 400 && answer.status !== 401) {
    throw oauthFailure("Signing out", answer);
  }
}

/** A sign-in replaced a saved session (the server no longer took it, or
 *  `fortrip login` ran again): revoke its refresh token, best effort. A
 *  failure changes nothing for the command, and the new session's token is
 *  never the one revoked. */
async function revokeReplaced(
  config: AuthConfig,
  replaced: Session | null,
  current: Session,
): Promise<void> {
  if (!replaced?.refreshToken || replaced.refreshToken === current.refreshToken) return;
  await revoke(config, replaced, REVOKE_REPLACED_TIMEOUT_MS).catch(() => undefined);
}

export async function whoami(apiUrl: string, token?: string): Promise<unknown> {
  const data = unwrap(
    token
      ? await request(apiUrl, API.me, { token })
      : await authorizedRequest(apiUrl, API.me),
  ) as Record<string, unknown>;
  return { ...data, apiUrl };
}
