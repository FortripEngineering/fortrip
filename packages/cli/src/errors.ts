import { ERROR_CODES, renderError } from "@fortrip/agent-contract";

export const EXIT = {
  ok: 0,
  error: 1,
  usage: 2,
  unauthenticated: 3,
  rateLimited: 4,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/** The v1 error envelope (spec §11), as Fortrip sent it or as the CLI
 *  answers a request it refused to send. */
export interface ErrorEnvelope {
  error: { code: string; message?: unknown; [field: string]: unknown };
}

/**
 * A failure the CLI reports on stderr and exits with `exitCode`. `envelope`
 * is Fortrip's error, when there is one; `details` are the CLI's own facts
 * about it (`loginUrl`, `tokenSource`, the HTTP `status`, …).
 */
export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode: ExitCode,
    readonly details: Record<string, unknown> = {},
    readonly envelope?: ErrorEnvelope,
  ) {
    super(message);
  }
}

/** Said alongside a command's result, or its error, as extra fields
 *  (`warning`, `recoveryFile`) with `--json` and as extra lines otherwise. */
export const notices: Record<string, unknown> = {};

export function usageError(message: string): CliError {
  return new CliError(message, EXIT.usage);
}

/** `name: value` lines; a value that isn't a string is shown as JSON. */
export function fieldLines(fields: Record<string, unknown>): string[] {
  return Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => `${name}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
}

/** Facts about an error that `--json` puts in the error object itself, as
 *  Fortrip's envelope has them: `details.issues` lists the fields of a
 *  request the CLI refused to send. */
const ERROR_FIELDS = new Set(["retryable", "retryAfterSeconds", "details"]);

/** The code of a CLI's own error, by its exit code: Fortrip's code for the
 *  same kind of failure, `service_unavailable` for a retryable one (no
 *  answer, a lock held), and `cli_error` for anything else. */
function localCode(failure: CliError): string {
  switch (failure.exitCode) {
    case EXIT.usage:
      return "invalid_request";
    case EXIT.unauthenticated:
      return "unauthenticated";
    case EXIT.rateLimited:
      return "rate_limited";
    default:
      return failure.details.retryable === true ? "service_unavailable" : "cli_error";
  }
}

/** `- /pointer: message` for each issue, as the contract renders the API's. */
function issueLines(details: unknown): string[] | null {
  const issues = (details as { issues?: unknown } | null)?.issues;
  if (!Array.isArray(issues)) return null;
  return issues.map((issue: { pointer?: unknown; message?: unknown }) => `- ${issue.pointer}: ${issue.message}`);
}

/**
 * What stderr says about a failure.
 *
 * As text: Fortrip's error as the contract renders it (with the HTTP status
 * only for a code this version doesn't know), or `Error: <message>` and the
 * issues of a request the CLI refused; then the CLI's own facts and the
 * notices, one `name: value` line each.
 *
 * With `--json`, one line: `{ error, ...facts, ...notices }`, where `error`
 * is Fortrip's error object, or one shaped like it for the CLI's own
 * (`{ code, message, retryable, retryAfterSeconds?, details? }`); the other
 * facts sit beside it, as in 2.0.
 */
export function formatError(failure: CliError, json: boolean): string {
  const fromApi = failure.envelope?.error;
  const inError = (name: string) => (fromApi ? Object.hasOwn(fromApi, name) : ERROR_FIELDS.has(name));
  const own = Object.entries(failure.details);
  if (json) {
    const error = fromApi ?? {
      code: localCode(failure),
      message: failure.message,
      retryable: failure.details.retryable === true,
      ...Object.fromEntries(own.filter(([n]) => inError(n) && n !== "retryable")),
    };
    return JSON.stringify({ error, ...Object.fromEntries(own.filter(([n]) => !inError(n))), ...notices });
  }
  const lines: string[] = [];
  if (fromApi) {
    const status = failure.details.status;
    const known = Object.hasOwn(ERROR_CODES, fromApi.code);
    lines.push(renderError(failure.envelope, known || typeof status !== "number" ? undefined : status));
    // What the CLI adds to Fortrip's message, such as what to do next.
    if (failure.message !== fromApi.message) lines.push(failure.message);
    lines.push(...fieldLines(Object.fromEntries(own.filter(([n]) => !inError(n) && n !== "status"))));
  } else {
    const { details, ...facts } = failure.details;
    lines.push(`Error: ${failure.message}`, ...(issueLines(details) ?? fieldLines({ details })), ...fieldLines(facts));
  }
  lines.push(...fieldLines(notices));
  return lines.join("\n");
}
