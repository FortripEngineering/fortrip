import { randomBytes } from "node:crypto";
import { readlinkSync } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { REQUEST_TIMEOUT_MS } from "./api.ts";
import { CliError, EXIT, usageError } from "./errors.ts";

export const DEFAULT_API_URL = "https://fortrip.ai";

interface StoredToken {
  accessToken: string;
  createdAt: string;
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
 * credentials.json, which 0.3.0 also reads and writes (without a lock, and
 * truncating it before writing):
 * - `tokens`: per API URL, so a saved token is never sent to another server.
 * - `pending`: the newest pending login per API URL, the one 0.3.0 reads.
 * - `pendingLogins`: every unexpired pending login per API URL, since the
 *   user may approve any link they were shown. 0.3.0 drops this key when it
 *   writes; the newest login survives in `pending`.
 * Other top-level keys are written back as they were read.
 */
interface Credentials {
  tokens: Record<string, StoredToken>;
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
/** About a second of re-reading a file 0.3.0 is in the middle of writing. */
const READ_RETRY_MS = [20, 50, 100, 200, 300, 400];
/** About two seconds of retrying a rename another process blocks. */
const RENAME_RETRY_MS = [20, 50, 100, 200, 300, 400, 500, 500];

export function credentialsPath(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "fortrip", "credentials.json");
}

/** `FORTRIP_API_URL` or the production site, without a trailing slash.
 *  Plain http is allowed only for localhost so a token never crosses the
 *  network unencrypted. */
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
  return url.origin;
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

/** Null when `text` isn't a credentials object (e.g. half written). */
function parse(text: string): Credentials | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(raw)) return null;
  const { tokens, pending, pendingLogins, ...other } = raw;
  const logins: Record<string, PendingLogin[]> = {};
  const add = (apiUrl: string, login: unknown) => {
    const list = (logins[apiUrl] ??= []);
    if (isLogin(login) && !list.some((known) => known.deviceCode === login.deviceCode)) {
      list.push(login);
    }
  };
  for (const [apiUrl, list] of Object.entries(isObject(pendingLogins) ? pendingLogins : {})) {
    for (const login of Array.isArray(list) ? list : []) add(apiUrl, login);
  }
  // 0.3.0 may have replaced the newest login with one it started.
  for (const [apiUrl, login] of Object.entries(isObject(pending) ? pending : {})) {
    for (const each of Array.isArray(login) ? login : [login]) add(apiUrl, each);
  }
  return {
    tokens: (isObject(tokens) ? tokens : {}) as Record<string, StoredToken>,
    logins,
    other,
  };
}

/** The file's text, or null when nothing should be on disk. */
function serialize({ tokens, logins, other }: Credentials): string | null {
  const pending: Record<string, PendingLogin> = {};
  const pendingLogins: Record<string, PendingLogin[]> = {};
  for (const [apiUrl, list] of Object.entries(logins)) {
    const live = list.filter((login) => !isExpired(login));
    const newest = live.at(-1);
    if (!newest) continue;
    pendingLogins[apiUrl] = live;
    pending[apiUrl] = newest;
  }
  if (
    Object.keys(tokens).length === 0 &&
    Object.keys(pending).length === 0 &&
    Object.keys(other).length === 0
  ) {
    return null;
  }
  return `${JSON.stringify({ ...other, tokens, pending, pendingLogins }, null, 2)}\n`;
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
 * The file's text (null: no file) and contents. A file that is there but
 * doesn't parse is most likely being written by 0.3.0, which empties it
 * first: it is read again for about a second, then reported as a retryable
 * error. It is never taken for an empty file, which a write would then
 * replace.
 */
async function readCredentials(
  path: string,
): Promise<{ text: string | null; credentials: Credentials }> {
  for (let attempt = 0; ; attempt++) {
    const text = await readText(path);
    if (text === null) return { text, credentials: { tokens: {}, logins: {}, other: {} } };
    const credentials = parse(text);
    if (credentials) return { text, credentials };
    const delay = READ_RETRY_MS[attempt];
    if (delay === undefined) {
      throw new CliError(
        `${path} is empty or not valid JSON. Another fortrip version may be writing it; retry. If this keeps happening, move the file away and sign in again.`,
        EXIT.error,
        { retryable: true },
      );
    }
    await sleep(delay);
  }
}

/**
 * Read-modify-write under the credentials lock, so commands don't drop each
 * other's changes. 0.3.0 writes without the lock: if the file changed after
 * it was read, the change is made again to what is there now, so nothing
 * 0.3.0 wrote is overwritten.
 */
async function updateCredentials(
  env: NodeJS.ProcessEnv,
  change: (credentials: Credentials) => void,
): Promise<void> {
  const path = credentialsPath(env);
  await withLock(path, async () => {
    for (let attempt = 0; ; attempt++) {
      const { text, credentials } = await readCredentials(path);
      change(credentials);
      const next = serialize(credentials);
      if (next === text) return;
      if ((await readText(path)) !== text) {
        if (attempt < 5) continue;
        throw new CliError(`${path} keeps changing; retry.`, EXIT.error, {
          retryable: true,
        });
      }
      if (next === null) await rm(path, { force: true });
      else await replace(path, next);
      return;
    }
  });
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

async function withLock(path: string, fn: () => Promise<void>): Promise<void> {
  await ensureDir(path);
  let release: (() => Promise<void>) | null;
  while (!(release = await tryLock(`${path}.lock`, CREDENTIALS_LOCK_STALE_MS))) {
    await sleep(10 + Math.random() * 40);
  }
  try {
    await fn();
  } finally {
    await release();
  }
}

async function ensureDir(path: string): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
}

/** Held by the one command at a time that polls pending logins or starts
 *  one; null while another command holds it. */
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

async function inspect(
  path: string,
): Promise<{ content: string; mtimeMs: number } | null> {
  const info = await lstat(path).catch(() => null);
  const content = await readFile(path, "utf8").catch(() => null);
  return info && content !== null ? { content, mtimeMs: info.mtimeMs } : null;
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

export async function loadStoredToken(
  apiUrl: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  const { credentials } = await readCredentials(credentialsPath(env));
  return credentials.tokens[apiUrl]?.accessToken ?? null;
}

/** `FORTRIP_TOKEN` (CI, remote sandboxes) wins over the saved login. */
export async function resolveToken(
  apiUrl: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ token: string; source: "env" | "file" } | null> {
  const fromEnv = env.FORTRIP_TOKEN?.trim();
  if (fromEnv) return { token: fromEnv, source: "env" };
  const stored = await loadStoredToken(apiUrl, env);
  return stored ? { token: stored, source: "file" } : null;
}

/**
 * Saves a token and forgets this API URL's pending logins. The server has
 * already redeemed the login, so a failed write must not lose the token: it
 * is then written to a separate file, whose path the error names.
 */
export async function saveToken(
  apiUrl: string,
  accessToken: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const token = { accessToken, createdAt: new Date().toISOString() };
  try {
    await updateCredentials(env, (credentials) => {
      credentials.tokens[apiUrl] = token;
      delete credentials.logins[apiUrl];
    });
  } catch (error) {
    const path = credentialsPath(env);
    const kept = `${path.replace(/\.json$/, "")}.recovered-${Date.now()}-${randomBytes(3).toString("hex")}.json`;
    const content = `${JSON.stringify({ tokens: { [apiUrl]: token } }, null, 2)}\n`;
    const saved = await writeFile(kept, content, { mode: 0o600, flag: "wx" }).then(
      () => true,
      () => false,
    );
    throw new CliError(
      saved
        ? `Signed in, but ${path} couldn't be updated (${(error as Error).message}). The sign-in is kept in ${kept}: replace credentials.json with it to keep it.`
        : `Signed in, but the sign-in couldn't be saved: ${(error as Error).message}`,
      EXIT.error,
      saved ? { recoveryFile: kept } : {},
    );
  }
}

/** With `only`, deletes the saved token only if it is still that one, so a
 *  token another command saved meanwhile survives. */
export async function deleteToken(
  apiUrl: string,
  env: NodeJS.ProcessEnv = process.env,
  only?: string,
): Promise<void> {
  await updateCredentials(env, (credentials) => {
    if (only === undefined || credentials.tokens[apiUrl]?.accessToken === only) {
      delete credentials.tokens[apiUrl];
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
