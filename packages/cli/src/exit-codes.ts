// The CLI's exit codes and how an error maps onto them. No runtime imports,
// so the docs site can render them at build time.
import type { ErrorCode } from "@fortrip/agent-contract";

export const EXIT = {
  ok: 0,
  error: 1,
  usage: 2,
  unauthenticated: 3,
  rateLimited: 4,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/** The exit code of a known error code; any other known code exits `EXIT.error`. */
export const EXIT_BY_CODE: Readonly<Partial<Record<ErrorCode, ExitCode>>> = {
  invalid_request: EXIT.usage,
  unauthenticated: EXIT.unauthenticated,
  rate_limited: EXIT.rateLimited,
};

/** The exit code of an error code this version doesn't know (or no error
 *  envelope at all), by HTTP status; any other status exits `EXIT.error`. */
export const EXIT_BY_STATUS: Readonly<Partial<Record<number, ExitCode>>> = {
  400: EXIT.usage,
  401: EXIT.unauthenticated,
  429: EXIT.rateLimited,
};
