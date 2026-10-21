import { randomBytes } from "node:crypto";
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
import { usageError } from "./errors.ts";

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
   *  when a poll answered `authorization_pending`. */
  checkedAt?: string;
}

/** Tokens are keyed by API URL, so a saved token is never sent to another
 *  server (e.g. a `FORTRIP_API_URL` pointed somewhere else). Every unexpired
 *  pending login is kept: the user may approve any link they were shown. */
interface CredentialsFile {
  tokens: Record<string, StoredToken>;
  pending: Record<string, PendingLogin[]>;
}

/** A credentials lock is held for one read and write. */
const CREDENTIALS_LOCK_STALE_MS = 10_000;
/** The login lock is held for a few requests; one can take the whole
 *  request timeout. */
const LOGIN_LOCK_STALE_MS = REQUEST_TIMEOUT_MS + 30_000;

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

async function readCredentials(path: string): Promise<CredentialsFile> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as {
      tokens?: Record<string, StoredToken>;
      pending?: Record<string, PendingLogin | PendingLogin[]>;
    };
    const pending: Record<string, PendingLogin[]> = {};
    for (const [apiUrl, logins] of Object.entries(parsed?.pending ?? {})) {
      // 0.3.0 kept a single pending login per API URL.
      pending[apiUrl] = Array.isArray(logins) ? logins : logins ? [logins] : [];
    }
    return { tokens: parsed?.tokens ?? {}, pending };
  } catch {
    return { tokens: {}, pending: {} };
  }
}

/** Read-modify-write under a lock file, so commands running in parallel
 *  don't drop each other's changes. Expired pending logins are dropped. */
async function updateCredentials(
  env: NodeJS.ProcessEnv,
  change: (file: CredentialsFile) => void,
): Promise<void> {
  const path = credentialsPath(env);
  await withLock(path, async () => {
    const file = await readCredentials(path);
    change(file);
    for (const [apiUrl, logins] of Object.entries(file.pending)) {
      const live = logins.filter((login) => !isExpired(login));
      if (live.length) file.pending[apiUrl] = live;
      else delete file.pending[apiUrl];
    }
    await writeCredentials(path, file);
  });
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

/**
 * Creates the lock file `path` naming this process, or returns null while
 * another holds it. A lock whose age is past `staleMs` either way (a clock
 * step can date it in the future), or whose process on this host is gone,
 * was abandoned and is removed for the next try. Release removes the lock
 * only while it is still this one, and never throws: a lock it leaves
 * behind is abandoned.
 */
async function tryLock(
  path: string,
  staleMs: number,
): Promise<(() => Promise<void>) | null> {
  const owner = `${process.pid} ${randomBytes(8).toString("hex")} ${hostname()}`;
  try {
    await writeFile(path, owner, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (!isHeld(error)) throw error;
    if (await isAbandoned(path, staleMs)) await rm(path, { force: true });
    return null;
  }
  return async () => {
    try {
      if ((await readFile(path, "utf8")) === owner) await rm(path, { force: true });
    } catch {}
  };
}

/** Windows also refuses to create a file another process is deleting. */
function isHeld(error: unknown): boolean {
  const { code } = error as NodeJS.ErrnoException;
  return (
    code === "EEXIST" ||
    (process.platform === "win32" &&
      (code === "EPERM" || code === "EACCES" || code === "EBUSY"))
  );
}

async function isAbandoned(path: string, staleMs: number): Promise<boolean> {
  const info = await lstat(path).catch(() => null);
  if (!info) return false;
  if (Math.abs(Date.now() - info.mtimeMs) > staleMs) return true;
  const [pid, , ...host] = (await readFile(path, "utf8").catch(() => "")).split(" ");
  // A pid means nothing in another host's (or container's) process table.
  if (host.join(" ") !== hostname()) return false;
  const holder = Number(pid);
  return Number.isSafeInteger(holder) && holder > 0 && !isRunning(holder);
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

/** Written to a temp file and renamed over the old one, so a reader never
 *  sees a half-written file. */
async function writeCredentials(path: string, file: CredentialsFile): Promise<void> {
  if (
    Object.keys(file.tokens).length === 0 &&
    Object.keys(file.pending).length === 0
  ) {
    await rm(path, { force: true });
    return;
  }
  const temp = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await writeFile(temp, `${JSON.stringify(file, null, 2)}\n`, {
      mode: 0o600,
      flag: "wx",
    });
    // `mode` is subject to the umask.
    await chmod(temp, 0o600);
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

function isExpired(login: PendingLogin): boolean {
  return !(Date.parse(login.expiresAt) > Date.now());
}

export async function loadStoredToken(
  apiUrl: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  const file = await readCredentials(credentialsPath(env));
  return file.tokens[apiUrl]?.accessToken ?? null;
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

export async function saveToken(
  apiUrl: string,
  accessToken: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  await updateCredentials(env, (file) => {
    file.tokens[apiUrl] = { accessToken, createdAt: new Date().toISOString() };
    delete file.pending[apiUrl];
  });
}

/** With `only`, deletes the saved token only if it is still that one, so a
 *  token another command saved meanwhile survives. */
export async function deleteToken(
  apiUrl: string,
  env: NodeJS.ProcessEnv = process.env,
  only?: string,
): Promise<void> {
  await updateCredentials(env, (file) => {
    if (only === undefined || file.tokens[apiUrl]?.accessToken === only) {
      delete file.tokens[apiUrl];
    }
  });
}

/** The unexpired pending logins for this API URL, oldest first. */
export async function loadPendingLogins(
  apiUrl: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<PendingLogin[]> {
  const logins = (await readCredentials(credentialsPath(env))).pending[apiUrl] ?? [];
  return logins.filter((login) => !isExpired(login));
}

export async function addPendingLogin(
  apiUrl: string,
  pending: PendingLogin,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  await updateCredentials(env, (file) => {
    file.pending[apiUrl] = [...(file.pending[apiUrl] ?? []), pending];
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
  await updateCredentials(env, (file) => {
    const logins = file.pending[apiUrl];
    if (!logins) return;
    file.pending[apiUrl] = logins.flatMap((login) =>
      login.deviceCode !== deviceCode
        ? [login]
        : changes
          ? [{ ...login, ...changes }]
          : [],
    );
  });
}
