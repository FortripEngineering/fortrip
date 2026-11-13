import {
  API,
  COMMAND_GROUPS,
  COMMANDS,
  type CommandGroupSpec,
  commandInvocation,
  type CommandSpec,
  CURRENCIES,
  GLOBAL_FLAGS,
  HTTP_ROUTES,
  order as orderSchema,
  type RenderedTool,
  renderToolResult,
} from "@fortrip/agent-contract";

import { unwrap } from "./api.ts";
import { authorizedRequest, login, logout, whoami } from "./auth.ts";
import { cancelPreview, check, parseCommand, parseOptions } from "./commands.ts";
import { resolveApiUrl, resolveMcpUrl } from "./credentials.ts";
import {
  CliError,
  EXIT,
  type ExitCode,
  fieldLines,
  formatError,
  notices,
  usageError,
} from "./errors.ts";
import { commandHelp, groupHelp, overallHelp } from "./help.ts";
import { VERSION } from "./version.ts";

/** A global flag as typed: `--help` and `-h`. */
function globalFlag(name: string): string[] {
  const option = GLOBAL_FLAGS.find((candidate) => candidate.flag === name);
  return option ? [`--${option.flag}`, ...(option.short ? [`-${option.short}`] : [])] : [];
}

const HELP_FLAGS = globalFlag("help");
const VERSION_FLAGS = globalFlag("version");
const JSON_FLAG = "--json";

/** The command `argv` names and the arguments after its name, or the group
 *  whose help it asks for. A group's commands are typed after it
 *  (`hotels search`); a command without a group on its own (`login`). */
function findCommand(
  argv: string[],
): { spec: CommandSpec; rest: string[] } | { groupHelp: CommandGroupSpec } {
  const [word, ...afterWord] = argv;
  const group = COMMAND_GROUPS.find((candidate) => candidate.name === word);
  if (group) {
    const [name, ...rest] = afterWord;
    if (!name || name === "help" || HELP_FLAGS.includes(name)) {
      return { groupHelp: group };
    }
    const spec = COMMANDS.find(
      (candidate) => candidate.group === group.name && candidate.name === name,
    );
    if (!spec) {
      throw usageError(
        `Unknown command "${group.name} ${name}". Run \`fortrip ${group.name} --help\`.`,
      );
    }
    return { spec, rest };
  }
  const spec = COMMANDS.find(
    (candidate) => candidate.group === null && candidate.name === word,
  );
  if (spec) return { spec, rest: afterWord };
  // A group's command typed without its group (`search` for `hotels search`).
  const meant = COMMANDS.filter(
    (candidate) => candidate.group !== null && candidate.name === word,
  ).map((candidate) => `\`${commandInvocation(candidate)}\``);
  throw usageError(
    meant.length
      ? `Unknown command "${word}". Did you mean ${meant.join(" or ")}?`
      : `Unknown command "${word}". Run \`fortrip --help\`.`,
  );
}

/** What a command printed or answers: text it wrote itself, or an answer
 *  to print as text, or as JSON with `--json`. */
type Answer = { data: unknown; text: string } | undefined;

async function run(argv: string[]): Promise<Answer> {
  const [command] = argv;
  if (!command || command === "help" || HELP_FLAGS.includes(command)) {
    process.stdout.write(overallHelp());
    return undefined;
  }
  if (VERSION_FLAGS.includes(command)) {
    process.stdout.write(`${VERSION}\n`);
    return undefined;
  }
  const found = findCommand(argv);
  if ("groupHelp" in found) {
    process.stdout.write(groupHelp(found.groupHelp));
    return undefined;
  }
  const { spec, rest } = found;
  if (wantsHelp(rest)) {
    process.stdout.write(commandHelp(spec));
    return undefined;
  }

  const apiUrl = resolveApiUrl();
  const log = (line: string) => process.stderr.write(`${line}\n`);
  if (spec.group === null) {
    switch (spec.name) {
      case "login": {
        const { values } = parseOptions(spec, rest);
        if (process.env.FORTRIP_TOKEN) {
          log("Note: FORTRIP_TOKEN is set and takes precedence over this login.");
        }
        return account(await login({ apiUrl, openBrowser: !values["no-browser"], log }));
      }
      case "logout": {
        parseOptions(spec, rest);
        const data = await logout(apiUrl);
        return { data, text: `Logged out of ${apiUrl}.` };
      }
      case "whoami":
        parseOptions(spec, rest);
        return account(await whoami(apiUrl));
      case "mcp": {
        parseOptions(spec, rest);
        // Loaded only here: the other commands needn't pay for the MCP SDK.
        const mcpUrl = resolveMcpUrl(apiUrl);
        const { runMcpBridge } = await import("./mcp-bridge.ts");
        await runMcpBridge(mcpUrl, apiUrl);
        return undefined;
      }
    }
  }
  const preview = cancelPreview(spec, rest, process.env);
  if (preview) return cancelOrder(apiUrl, spec, preview);
  const { method, path, body } = parseCommand(spec, rest, process.env);
  if (spec.tool === "pay_order" && body) await inOrderCurrency(apiUrl, spec, rest, body);
  const data = unwrap(await authorizedRequest(apiUrl, path, { method, body }));
  return { data, text: renderToolResult(spec.tool as RenderedTool, data, "cli") };
}

/** `orders pay`'s total is in the order's currency: read the order for it,
 *  set it on the total, and check the request again before it is sent. */
async function inOrderCurrency(
  apiUrl: string,
  spec: CommandSpec,
  rest: string[],
  body: Record<string, unknown>,
): Promise<void> {
  const [orderId] = parseOptions(spec, rest).positionals as [string];
  const order = unwrap(await authorizedRequest(apiUrl, API.order(orderId), { method: "GET" }));
  const currency = (order as { total?: { currency?: unknown } } | null)?.total?.currency;
  if (typeof currency !== "string" || !(CURRENCIES as readonly string[]).includes(currency)) {
    throw new CliError(
      `Not sent: the order ${orderId} has no total.currency in USD or CNY to pay in.`,
      EXIT.error,
    );
  }
  body.total = { ...(body.total as Record<string, unknown>), currency };
  check(spec, { ...body, orderId }, HTTP_ROUTES.pay_order, new Map());
}

/** An order as `orders cancel` reads it, field by field: the read may not
 *  be in the contract's shape. */
type ReadOrder = {
  status?: unknown;
  total?: { currency?: unknown };
  payment?: { status?: unknown };
  cancel?: { action?: unknown; penalty?: { currency?: unknown } | null };
} | null;

/**
 * `orders cancel`, after one read of the order: without `--max-penalty` or
 * `--close`, or with `--max-penalty` on an unpaid order, it says what the
 * order allows and exits 2. `--close` closes an unpaid order, and answers
 * an expired one as it is. `--max-penalty` cancels in the currency of the
 * order's penalty, else of its total.
 */
async function cancelOrder(
  apiUrl: string,
  spec: CommandSpec,
  preview: NonNullable<ReturnType<typeof cancelPreview>>,
): Promise<Answer> {
  const { flag, orderId, close, request } = preview;
  const order = unwrap(await authorizedRequest(apiUrl, preview.path, { method: preview.method }));
  const read = order as ReadOrder;
  const closable = read?.cancel?.action === "close";
  if (!request || (!close && closable)) throw usageError(notCancelled(spec, flag, orderId, order));
  if (close) {
    if (read?.status === "expired") return { data: order, text: renderToolResult("cancel_order", order, "cli") };
    if (!closable) {
      if (read?.cancel?.action === "cancel") {
        throw usageError(
          `Not closed: the order is paid. To cancel it under its terms, show the user cancel.penalty and, once they agree, run \`${commandInvocation(spec)} ${orderId} ${flag} <amount>\`.`,
        );
      }
      throw new CliError(["Not closed: nothing was sent.", ...orderLines(order)].join("\n"), EXIT.error);
    }
    // A close that is answered closed the order: one paid meanwhile is
    // refused with `order_not_cancellable`, never answered as it is.
    const data = unwrap(await authorizedRequest(apiUrl, request.path, { method: "POST", body: request.body }));
    return { data, text: renderToolResult("cancel_order", data, "cli") };
  }
  const penalty = read?.cancel?.penalty?.currency;
  const currency = typeof penalty === "string" ? penalty : read?.total?.currency;
  if (typeof currency !== "string") {
    throw new CliError(`Not sent: the order ${orderId} has no currency to send the penalty in.`, EXIT.error);
  }
  const body = request.body as Record<string, unknown>;
  body.maximumPenalty = { ...(body.maximumPenalty as Record<string, unknown>), currency };
  check(spec, { ...body, orderId }, HTTP_ROUTES.cancel_order, new Map());
  const data = unwrap(await authorizedRequest(apiUrl, request.path, { method: "POST", body }));
  return { data, text: renderToolResult("cancel_order", data, "cli") };
}

/** An order's hotel and Cancel lines, as `orders get` prints them. */
function orderLines(order: unknown): string[] {
  return renderToolResult("get_order", order, "cli")
    .split("\n")
    .filter((text) => text.startsWith("Hotel: ") || text.startsWith("Cancel: "));
}

/** What `orders cancel` says instead of cancelling: the order's hotel and
 *  Cancel lines and, when it can be cancelled now, the consent step and the
 *  command with the order's own penalty, or, when it can be closed, the
 *  command that closes it. */
function notCancelled(spec: CommandSpec, flag: string, orderId: string, order: unknown): string {
  const parsed = orderSchema.safeParse(order);
  const cancel = parsed.success ? parsed.data.cancel : undefined;
  const next =
    cancel?.action === "close"
      ? [
          `Only once the user says they no longer want this order, run \`${commandInvocation(spec)} ${orderId} --close\`.`,
        ]
      : cancel?.action === "cancel" && cancel.penalty
        ? [
            `Show the user the stay, this penalty and this refund, and ask them to confirm. Only after a clear yes, run \`${commandInvocation(spec)} ${orderId} ${flag} ${cancel.penalty.amount}\`.`,
          ]
        : cancel
          ? []
          : [`${commandInvocation(spec)} needs ${flag}, the penalty the user agreed to.`];
  return ["Not cancelled: nothing was sent.", ...orderLines(order), ...next].join("\n");
}

/** `whoami`, and `login` once signed in: the account,
 *  `{ userId, email, name, apiUrl }`. */
function account(data: unknown): Answer {
  const { apiUrl, userId, email, name } = data as Record<string, unknown>;
  const given = (value: unknown) => value ?? "not given";
  return {
    data,
    text: [
      `Signed in to ${apiUrl}.`,
      ...fieldLines({ userId, email: given(email), name: given(name) }),
    ].join("\n"),
  };
}

/** `--help` or `-h` anywhere before `--`. */
function wantsHelp(args: string[]): boolean {
  for (const arg of args) {
    if (arg === "--") return false;
    if (HELP_FLAGS.includes(arg)) return true;
  }
  return false;
}

/** `argv` without `--json`, which any command takes anywhere before `--`,
 *  and whether it was there. */
function takeJson(argv: string[]): { json: boolean; argv: string[] } {
  const end = argv.indexOf("--");
  const before = end === -1 ? argv : argv.slice(0, end);
  const after = end === -1 ? [] : argv.slice(end);
  const kept = before.filter((arg) => arg !== JSON_FLAG);
  return { json: kept.length < before.length, argv: [...kept, ...after] };
}

async function main(): Promise<ExitCode> {
  const { json, argv } = takeJson(process.argv.slice(2));
  try {
    const answer = await run(argv);
    if (answer !== undefined) {
      const { data, text } = answer;
      if (json) {
        const output =
          data && typeof data === "object" && !Array.isArray(data) ? { ...data, ...notices } : data;
        process.stdout.write(`${JSON.stringify(output)}\n`);
      } else {
        process.stdout.write(`${[text, ...fieldLines(notices)].join("\n")}\n`);
      }
    }
    return EXIT.ok;
  } catch (error) {
    const failure =
      error instanceof CliError
        ? error
        : new CliError((error as Error)?.message ?? String(error), EXIT.error);
    process.stderr.write(`${formatError(failure, json)}\n`);
    return failure.exitCode;
  }
}

process.exitCode = await main();
