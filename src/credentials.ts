import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

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
}

/** Tokens are keyed by API URL, so a token minted for one server is never
 *  sent to another (e.g. a `FORTRIP_API_URL` pointed somewhere else). */
interface CredentialsFile {
  tokens: Record<string, StoredToken>;
  pending: Record<string, PendingLogin>;
}

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
    const parsed = JSON.parse(await readFile(path, "utf8")) as CredentialsFile;
    return { tokens: parsed?.tokens ?? {}, pending: parsed?.pending ?? {} };
  } catch {
    return { tokens: {}, pending: {} };
  }
}

async function writeCredentials(path: string, file: CredentialsFile): Promise<void> {
  if (
    Object.keys(file.tokens).length === 0 &&
    Object.keys(file.pending).length === 0
  ) {
    await rm(path, { force: true });
    return;
  }
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
  // `mode` only applies when the file is created.
  await chmod(path, 0o600);
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
  const path = credentialsPath(env);
  const file = await readCredentials(path);
  file.tokens[apiUrl] = { accessToken, createdAt: new Date().toISOString() };
  delete file.pending[apiUrl];
  await writeCredentials(path, file);
}

export async function deleteToken(
  apiUrl: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const path = credentialsPath(env);
  const file = await readCredentials(path);
  delete file.tokens[apiUrl];
  await writeCredentials(path, file);
}

/** The unexpired pending login for this API URL, if any. */
export async function loadPendingLogin(
  apiUrl: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<PendingLogin | null> {
  const pending = (await readCredentials(credentialsPath(env))).pending[apiUrl];
  return pending && Date.parse(pending.expiresAt) > Date.now() ? pending : null;
}

export async function savePendingLogin(
  apiUrl: string,
  pending: PendingLogin | null,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const path = credentialsPath(env);
  const file = await readCredentials(path);
  if (pending) file.pending[apiUrl] = pending;
  else delete file.pending[apiUrl];
  await writeCredentials(path, file);
}
