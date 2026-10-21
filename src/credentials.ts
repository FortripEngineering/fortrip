import { randomBytes } from "node:crypto";
import {
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

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
}

/** Tokens are keyed by API URL, so a saved token is never sent to another
 *  server (e.g. a `FORTRIP_API_URL` pointed somewhere else). Every unexpired
 *  pending login is kept: commands run in parallel each start one, and the
 *  user may approve whichever link the agent showed. */
interface CredentialsFile {
  tokens: Record<string, StoredToken>;
  pending: Record<string, PendingLogin[]>;
}

/** A lock older than this was left by a process that died holding it. */
const LOCK_STALE_MS = 10_000;

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
  const dir = dirname(path);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  const lock = `${path}.lock`;
  for (;;) {
    try {
      await (await open(lock, "wx", 0o600)).close();
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const age = await stat(lock).then(
        (lockStat) => Date.now() - lockStat.mtimeMs,
        () => 0,
      );
      if (age > LOCK_STALE_MS) await rm(lock, { force: true });
      else await sleep(10 + Math.random() * 40);
    }
  }
  try {
    await fn();
  } finally {
    await rm(lock, { force: true });
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
