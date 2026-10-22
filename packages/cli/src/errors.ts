export const EXIT = {
  ok: 0,
  error: 1,
  usage: 2,
  unauthenticated: 3,
  rateLimited: 4,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/** A failure the CLI reports as JSON on stderr and exits with `exitCode`. */
export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode: ExitCode,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/** Said alongside a command's JSON result, or its JSON error, as extra
 *  fields (`warning`, `recoveryFile`), so stdout and stderr stay JSON. */
export const notices: Record<string, unknown> = {};

export function usageError(message: string): CliError {
  return new CliError(message, EXIT.usage);
}
