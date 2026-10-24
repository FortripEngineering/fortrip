import { randomBytes } from "node:crypto";
import { readlinkSync } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { basename, dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { PUBLIC_ORIGINS } from "@fortrip/agent-contract";

import { REQUEST_TIMEOUT_MS } from "./api.ts";
import { CliError, EXIT, usageError } from "./errors.ts";

export const DEFAULT_API_URL: string = PUBLIC_ORIGINS.api;

/** A sign-in with one API URL, as the OAuth token endpoint issued it. */
export interface Session {
  accessToken: string;
  refreshToken: string;
  /** When the access token expires, in milliseconds since the epoch. */
  expiresAt: number;
  /** The OAuth client the tokens were issued to; a refresh names it. */
  clientId: string;
}

/** A device login started for an agent that can't wait on `login`; the next
 *  command finishes it once the user has approved in the browser. */
export interface PendingLogin {
  deviceCode: string;
  userCode: string;
  loginUrl: string;
  expiresAt: string;
  /** Seconds to leave between polls; `slow_down` raises it. */
  interval?: number;
  /** When a command last polled it, so the next one waits its turn. */
  lastPolledAt?: string;
  /** When a command last knew it was unapproved: when it was started, or
   *  when a poll that answered `authorization_pending` was sent. */
  checkedAt?: string;
}

/**
 * credentials.json, `version: 2`:
 * - `sessions`: per API URL, so a token is never sent to another server.
 * - `pendingLogins`: every unexpired pending login per API URL, since the
 *   user may approve any link they were shown.
 * Other top-level keys are written back as they were read. A file without a
 * `version` is 0.3.x's, whose tokens this version can't use: it counts as
 * empty, and the next write replaces it.
 */
interface Credentials {
  sessions: Record<string, Session>;
  logins: Record<string, PendingLogin[]>;
  other: Record<string, unknown>;
}

/** A credentials lock is held for one read and write. */
const CREDENTIALS_LOCK_STALE_MS = 10_000;
/** The login lock is held for a few requests; one can take the whole
 *  request timeout. */
const LOGIN_LOCK_STALE_MS = REQUEST_TIMEOUT_MS + 30_000;
/** The takeover guard is held for one check and removal. */
const TAKEOVER_STALE_MS = 2_000;
/** How long to wait for the credentials lock before giving up. */
const LOCK_WAIT_MS = 30_000;
/** About two seconds of retrying a rename another process blocks. */
const RENAME_RETRY_MS = [20, 50, 100, 200, 300, 400, 500, 500];

export function credentialsPath(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "fortrip", "credentials.json");
}

/** `FORTRIP_API_URL` or the production API, without a trailing slash. It
 *  may end in a path prefix (`http://localhost:3000/api/public`), which
 *  every request path follows; a query or fragment is dropped. Plain http
 *  is allowed only for localhost so a token never crosses the network
 *  unencrypted. */
export function resolveApiUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.FORTRIP_API_URL?.trim() || DEFAULT_API_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw usageError(`FORTRIP_API_URL is not a valid URL: ${raw}`);
  }
  const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocal)) {
    throw usageError("FORTRIP_API_URL must use https (http only for localhost)");
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLogin(value: unknown): value is PendingLogin {
  return (
    isObject(value) &&
    typeof value.deviceCode === "string" &&
    typeof value.userCode === "string" &&
    typeof value.loginUrl === "string" &&
    typeof value.expiresAt === "string"
  );
}

function isSession(value: unknown): value is Session {
  return (
    isObject(value) &&
    typeof value.accessToken === "string" &&
    typeof value.refreshToken === "string" &&
    typeof value.expiresAt === "number" &&
    typeof value.clientId === "string"
  );
}

/** Null when `text` isn't a credentials file this version can read. */
function parse(text: string): Credentials | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(raw)) return null;
  const { version, sessions, pendingLogins, ...other } = raw;
  if (version === undefined) return emptyCredentials();
  if (version !== 2) return null;
  const credentials: Credentials = { sessions: {}, logins: {}, other };
  for (const [apiUrl, session] of Object.entries(isObject(sessions) ? sessions : {})) {
    if (isSession(session)) credentials.sessions[apiUrl] = session;
  }
  for (const [apiUrl, list] of Object.entries(isObject(pendingLogins) ? pendingLogins : {})) {
    credentials.logins[apiUrl] = (Array.isArray(list) ? list : []).filter(isLogin);
  }
  return credentials;
}

/** The file's text. */
function serialize({ sessions, logins, other }: Credentials): string {
  const pendingLogins: Record<string, PendingLogin[]> = {};
  for (const [apiUrl, list] of Object.entries(logins)) {
    const live = list.filter((login) => !isExpired(login));
    if (live.length) pendingLogins[apiUrl] = live;
  }
  return `${JSON.stringify({ ...other, version: 2, sessions, pendingLogins }, null, 2)}\n`;
}

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * The file's text (null: no file) and contents, with the sessions kept in
 * recovery files (see `saveSession`) merged in, and those files. Every
 * writer replaces the file whole, so one that doesn't parse is damaged: an
 * error names it, and it is never taken for an empty file that a write
 * would then replace. An empty file has nothing to lose and counts as empty.
 */
async function readCredentials(
  path: string,
): Promise<{ text: string | null; credentials: Credentials; recovered: string[] }> {
  const text = await readText(path);
  const credentials = text === null || text === "" ? emptyCredentials() : parse(text);
  if (!credentials) {
    throw new CliError(
      `${path} isn't a credentials file this version of fortrip can read. Move it away (for example to ${basename(path)}.broken) and sign in again.`,
      EXIT.error,
      { file: path },
    );
  }
  const recovered = await readRecovered(path);
  for (const { sessions } of recovered) mergeSessions(credentials, sessions);
  return { text, credentials, recovered: recovered.map(({ file }) => file) };
}

function emptyCredentials(): Credentials {
  return { sessions: {}, logins: {}, other: {} };
}

/**
 * Read-modify-write under the credentials lock, so commands don't drop each
 * other's changes. Sessions kept in recovery files are merged back, and the
 * files removed, whenever the write succeeds.
 */
async function updateCredentials<T>(
  env: NodeJS.ProcessEnv,
  change: (credentials: Credentials) => T,
): Promise<T> {
  const path = credentialsPath(env);
  return withLock(path, async () => {
    const { text, credentials, recovered } = await readCredentials(path);
    const result = change(credentials);
    const next = serialize(credentials);
    if (next !== text) await replace(path, next);
    for (const file of recovered) await rm(file, { force: true });
    return result;
  });
}

/** A recovered session replaces a saved one only if it expires later, which
 *  a session issued later does. */
function mergeSessions(credentials: Credentials, sessions: Record<string, Session>): void {
  for (const [apiUrl, session] of Object.entries(sessions)) {
    const saved = credentials.sessions[apiUrl];
    if (!saved || saved.expiresAt < session.expiresAt) credentials.sessions[apiUrl] = session;
  }
}

function recoveryPrefix(path: string): string {
  return `${basename(path, ".json")}.recovered-`;
}

/** Recovery files next to the credentials file, oldest first; ones that
 *  don't parse are left alone. */
async function readRecovered(
  path: string,
): Promise<{ file: string; sessions: Record<string, Session> }[]> {
  const prefix = recoveryPrefix(path);
  const names = (await readdir(dirname(path)).catch(() => [] as string[]))
    .filter((name) => name.startsWith(prefix) && name.endsWith(".json"))
    .sort();
  const recovered = [];
  for (const name of names) {
    const file = join(dirname(path), name);
    const parsed = parse((await readText(file).catch(() => null)) ?? "");
    if (parsed) recovered.push({ file, sessions: parsed.sessions });
  }
  return recovered;
}

/** Sessions for `apiUrl` kept in recovery files, which `logout` revokes too. */
export async function loadRecoveredSessions(
  apiUrl: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Session[]> {
  return (await readRecovered(credentialsPath(env))).flatMap(({ sessions }) =>
    sessions[apiUrl] ? [sessions[apiUrl]] : [],
  );
}

/**
 * Written to a temp file and renamed over the old one, so a reader never
 * sees a half-written file. Renaming over a file another process has open
 * can fail for a moment (Windows, virus scanners): that is retried for
 * about two seconds.
 */
async function replace(path: string, text: string): Promise<void> {
  const temp = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await writeFile(temp, text, { mode: 0o600, flag: "wx" });
    // `mode` is subject to the umask.
    await chmod(temp, 0o600);
    for (let attempt = 0; ; attempt++) {
      try {
        await rename(temp, path);
        return;
      } catch (error) {
        const delay = RENAME_RETRY_MS[attempt];
        if (!isBusy(error) || delay === undefined) throw error;
        await sleep(delay);
      }
    }
  } catch (error) {
    await rm(temp, { force: true });
    const { code } = error as NodeJS.ErrnoException;
    throw new CliError(
      `Could not write ${path}: ${(error as Error).message}`,
      EXIT.error,
      isBusy(error) ? { code, retryable: true } : { code },
    );
  }
}

function isBusy(error: unknown): boolean {
  const { code } = error as NodeJS.ErrnoException;
  return code === "EPERM" || code === "EACCES" || code === "EBUSY";
}

function isExpired(login: PendingLogin): boolean {
  return !(Date.parse(login.expiresAt) > Date.now());
}

async function withLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  await ensureDir(path);
  const lock = `${path}.lock`;
  const giveUpAt = Date.now() + LOCK_WAIT_MS;
  let release: (() => Promise<void>) | null;
  while (!(release = await tryLock(lock, CREDENTIALS_LOCK_STALE_MS))) {
    if (Date.now() > giveUpAt) {
      throw new CliError(
        `Timed out waiting for ${lock}. If no other fortrip command is running, delete it.`,
        EXIT.error,
        { retryable: true, lockFile: lock },
      );
    }
    await sleep(10 + Math.random() * 40);
  }
  try {
    return await fn();
  } finally {
    await release();
  }
}

/** Codes that say a directory can't be written, as opposed to a file that
 *  is busy. */
const UNWRITABLE = ["EACCES", "EPERM", "EROFS"];

/** Creates the directory of the credentials file. When it can't be written
 *  (a read-only home, as in an agent sandbox) the error says what to do. It
 *  exits 1, "any other error" (the agent reads `error`): the arguments are
 *  fine, so not 2, and there is no link to open, so not 3. */
async function ensureDir(path: string): Promise<void> {
  const dir = dirname(path);
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await chmod(dir, 0o700);
  } catch (error) {
    const { code } = error as NodeJS.ErrnoException;
    if (!code || !UNWRITABLE.includes(code)) throw error;
    throw new CliError(
      `Can't write to ${dir}, where fortrip keeps your sign-in. Set XDG_CONFIG_HOME to a directory that can be written, or set FORTRIP_TOKEN instead of signing in.`,
      EXIT.error,
      { code, configDir: dir },
    );
  }
}

/** For `login`: fail now, not after the user has approved, if a sign-in
 *  couldn't be saved. */
export async function ensureCredentialsDir(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  await ensureDir(credentialsPath(env));
}

/** Held by the one command at a time that talks to the sign-in server:
 *  polls pending logins or starts one, refreshes a session, or revokes it
 *  on logout. Null while another command holds it. */
export async function tryLoginLock(
  env: NodeJS.ProcessEnv = process.env,
): Promise<(() => Promise<void>) | null> {
  const path = credentialsPath(env);
  await ensureDir(path);
  return tryLock(`${path}.login-lock`, LOGIN_LOCK_STALE_MS);
}

/** This process's pid namespace on Linux, where containers have their own;
 *  "" elsewhere. */
const PID_NAMESPACE = (() => {
  try {
    return readlinkSync("/proc/self/ns/pid");
  } catch {
    return "";
  }
})();

interface LockOwner {
  pid: number;
  host: string;
  pidns: string;
}

function newOwner(): string {
  return JSON.stringify({
    pid: process.pid,
    host: hostname(),
    pidns: PID_NAMESPACE,
    id: randomBytes(8).toString("hex"),
  });
}

/**
 * Creates the lock file `path`, or returns null while another process holds
 * it. Release removes the lock only while it is still this one, and never
 * throws: a lock it leaves behind is abandoned.
 *
 * An abandoned lock (see `isAbandoned`) is removed for the next try, under a
 * takeover guard, and only if it is still the lock that was judged: two
 * waiters can't both take it over, the slower one removing the faster one's
 * new lock.
 */
export async function tryLock(
  path: string,
  staleMs: number,
): Promise<(() => Promise<void>) | null> {
  const owner = newOwner();
  if (await create(path, owner)) return releaser(path, owner);
  const seen = await inspect(path);
  if (!seen || !isAbandoned(path, seen, staleMs)) return null;

  const guard = `${path}.takeover`;
  const guardOwner = newOwner();
  if (!(await create(guard, guardOwner))) {
    const held = await inspect(guard);
    if (held && isAbandoned(guard, held, TAKEOVER_STALE_MS)) {
      await rm(guard, { force: true });
    }
    return null;
  }
  try {
    const current = await inspect(path);
    if (current?.content === seen.content && current.mtimeMs === seen.mtimeMs) {
      await rm(path, { force: true });
    }
  } finally {
    await releaser(guard, guardOwner)();
  }
  return null;
}

async function create(path: string, content: string): Promise<boolean> {
  try {
    await writeFile(path, content, { flag: "wx", mode: 0o600 });
    return true;
  } catch (error) {
    // Windows also refuses to create a file another process is deleting.
    if (
      (error as NodeJS.ErrnoException).code === "EEXIST" ||
      (process.platform === "win32" && isBusy(error))
    ) {
      return false;
    }
    throw error;
  }
}

function releaser(path: string, owner: string): () => Promise<void> {
  return async () => {
    try {
      if ((await readFile(path, "utf8")) === owner) await rm(path, { force: true });
    } catch {}
  };
}

/** A lock that can't be read (say, left by `sudo`) is judged by age. */
async function inspect(
  path: string,
): Promise<{ content: string; mtimeMs: number } | null> {
  const info = await lstat(path).catch(() => null);
  if (!info) return null;
  const content = await readFile(path, "utf8").catch(() => "");
  return { content, mtimeMs: info.mtimeMs };
}

/** When this process first saw each lock it is waiting on, unchanged. */
const firstSeen = new Map<string, { content: string; mtimeMs: number; at: number }>();

/**
 * A lock is abandoned when:
 * - its file is older than `staleMs` (a newer date is never trusted to mean
 *   old: a network drive's clock can run ahead);
 * - it names a process on this host, in this pid namespace, that has ended;
 * - or this process has seen it unchanged for `staleMs` (a lock dated in the
 *   future, or one from a host or container whose pids can't be checked).
 */
function isAbandoned(
  path: string,
  { content, mtimeMs }: { content: string; mtimeMs: number },
  staleMs: number,
): boolean {
  const now = Date.now();
  if (now - mtimeMs > staleMs) return true;
  const holder = parseOwner(content);
  if (
    holder &&
    holder.host === hostname() &&
    holder.pidns === PID_NAMESPACE &&
    !isRunning(holder.pid)
  ) {
    return true;
  }
  const first = firstSeen.get(path);
  if (first?.content !== content || first.mtimeMs !== mtimeMs) {
    firstSeen.set(path, { content, mtimeMs, at: now });
    return false;
  }
  return now - first.at > staleMs;
}

function parseOwner(content: string): LockOwner | null {
  try {
    const owner: unknown = JSON.parse(content);
    return isObject(owner) &&
      Number.isSafeInteger(owner.pid) &&
      (owner.pid as number) > 0 &&
      typeof owner.host === "string" &&
      typeof owner.pidns === "string"
      ? (owner as unknown as LockOwner)
      : null;
  } catch {
    return null;
  }
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: running, under another user.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** The session for this API URL, the newest of the file and any recovery
 *  file. */
export async function loadSession(
  apiUrl: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Session | null> {
  const { credentials } = await readCredentials(credentialsPath(env));
  return credentials.sessions[apiUrl] ?? null;
}

/**
 * Saves a session. Returns the session saved for this API URL afterwards,
 * and the one this save replaced (null if none, or if nothing was saved).
 * A sign-in replaces any session and forgets this API URL's pending logins.
 * A refresh passes `replacing`, the access token it refreshed: the session
 * is saved only if that is still the saved one (a sign-in or a logout
 * meanwhile wins), and pending logins stay, since the user may still
 * approve a link they were shown.
 *
 * The server has already issued the tokens (a refresh may have spent the
 * old refresh token), so a failed write must not lose them: the session is
 * then written to a recovery file next to the credentials file, whose path
 * the error names. Reads merge it in, and the next successful write merges
 * it back.
 */
export async function saveSession(
  apiUrl: string,
  session: Session,
  env: NodeJS.ProcessEnv = process.env,
  replacing?: string,
): Promise<{ saved: Session | null; replaced: Session | null }> {
  const path = credentialsPath(env);
  try {
    return await updateCredentials(env, (credentials) => {
      const previous = credentials.sessions[apiUrl] ?? null;
      if (replacing === undefined) {
        delete credentials.logins[apiUrl];
      } else if (previous?.accessToken !== replacing) {
        return { saved: previous, replaced: null };
      }
      credentials.sessions[apiUrl] = session;
      return { saved: session, replaced: previous };
    });
  } catch (error) {
    const kept = join(
      dirname(path),
      `${recoveryPrefix(path)}${Date.now()}-${randomBytes(3).toString("hex")}.json`,
    );
    const content = `${JSON.stringify({ version: 2, sessions: { [apiUrl]: session } }, null, 2)}\n`;
    const saved = await writeFile(kept, content, { mode: 0o600, flag: "wx" }).then(
      () => true,
      () => false,
    );
    throw new CliError(
      saved
        ? `Signed in, but ${path} couldn't be updated (${(error as Error).message}). The sign-in is kept in ${kept} until the next successful save merges it back.`
        : `Signed in, but the sign-in couldn't be saved: ${(error as Error).message}`,
      EXIT.error,
      saved ? { recoveryFile: kept } : {},
    );
  }
}

/** With `only` (access tokens), deletes the saved session only if it is one
 *  of those, so a session another command saved meanwhile survives. */
export async function deleteSession(
  apiUrl: string,
  env: NodeJS.ProcessEnv = process.env,
  only?: string[],
): Promise<void> {
  await updateCredentials(env, (credentials) => {
    const saved = credentials.sessions[apiUrl]?.accessToken;
    if (only === undefined || (saved !== undefined && only.includes(saved))) {
      delete credentials.sessions[apiUrl];
    }
  });
}

/** The unexpired pending logins for this API URL, oldest first. */
export async function loadPendingLogins(
  apiUrl: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<PendingLogin[]> {
  const { credentials } = await readCredentials(credentialsPath(env));
  return (credentials.logins[apiUrl] ?? []).filter((login) => !isExpired(login));
}

export async function addPendingLogin(
  apiUrl: string,
  pending: PendingLogin,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  await updateCredentials(env, (credentials) => {
    credentials.logins[apiUrl] = [...(credentials.logins[apiUrl] ?? []), pending];
  });
}

/** Records a poll (`changes`) or, with null, forgets the login. A login
 *  that is gone already (a token was saved meanwhile) stays gone. */
export async function updatePendingLogin(
  apiUrl: string,
  deviceCode: string,
  changes: Partial<PendingLogin> | null,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  await updateCredentials(env, (credentials) => {
    const logins = credentials.logins[apiUrl];
    if (!logins) return;
    credentials.logins[apiUrl] = logins.flatMap((login) =>
      login.deviceCode !== deviceCode
        ? [login]
        : changes
          ? [{ ...login, ...changes }]
          : [],
    );
  });
}
