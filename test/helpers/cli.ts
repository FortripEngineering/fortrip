import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

/** 0.3.0 as published (test/fixtures/fortrip-0.3.0/bin/cli.js is `tsup`'s
 *  build of the v0.3.0 tag), and this version from source. */
const VERSIONS = {
  "0.3.0": ["test/fixtures/fortrip-0.3.0/bin/cli.js"],
  current: ["--import", "tsx", "src/cli.ts"],
};

export function cli(
  version: keyof typeof VERSIONS,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return exec(process.execPath, [...VERSIONS[version], ...args], { env }).then(
    ({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
    (error: { code: number; stdout: string; stderr: string }) => error,
  );
}
