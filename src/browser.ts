import { spawn } from "node:child_process";

/** Best effort: resolves false when nothing could be launched, so the caller
 *  can tell the person to open the printed URL themselves. */
export function openBrowser(url: string): Promise<boolean> {
  if (!canOpenBrowser()) return Promise.resolve(false);
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", '""', url.replace(/&/g, "^&")]]
        : ["xdg-open", [url]];
  return new Promise((resolve) => {
    try {
      const child = spawn(command, args, { stdio: "ignore", detached: true });
      child.once("spawn", () => {
        child.unref();
        resolve(true);
      });
      child.once("error", () => resolve(false));
    } catch {
      resolve(false);
    }
  });
}

/** False over SSH and on Linux without a display: a browser would open on
 *  another machine, or not at all. */
export function canOpenBrowser(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (env.SSH_CONNECTION || env.SSH_TTY) return false;
  if (platform === "darwin" || platform === "win32") return true;
  return Boolean(env.DISPLAY || env.WAYLAND_DISPLAY);
}
