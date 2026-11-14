import {
  API,
  COMMAND_GROUPS,
  COMMANDS,
  type CommandGroupSpec,
  commandInvocation,
  type CommandSpec,
  GLOBAL_FLAGS,
  HTTP_ROUTES,
  orderCancel,
  type RenderedTool,
  renderToolResult,
} from "@fortrip/agent-contract";

import { unwrap } from "./api.ts";
import { authorizedRequest, login, logout, whoami } from "./auth.ts";
import { cancelRequest, check, parseCommand, parseOptions } from "./commands.ts";
import { resolveApiUrl, resolveMcpUrl } from "./credentials.ts";
import {
  CliError,
  EXIT,
  type ExitCode,
  fieldLines,
  formatError,
  localRequestId,
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
  const mode = cancelRequest(spec, rest, process.env);
  if (mode) return cancelOrder(apiUrl, spec, mode);
  const { method, path, body } = parseCommand(spec, rest, process.env);
  if (spec.tool === "pay_order") await payableInUsd(apiUrl, spec, rest);
  const data = unwrap(await authorizedRequest(apiUrl, path, { method, body }));
  return { data, text: renderToolResult(spec.tool as RenderedTool, data, "cli") };
}

/** `orders pay` sends its total in USD, the one currency a token pays in.
 *  The order is read first, so that one in another currency is not sent,
 *  and the person is told how it is paid instead. */
async function payableInUsd(apiUrl: string, spec: CommandSpec, rest: string[]): Promise<void> {
  const [orderId] = parseOptions(spec, rest).positionals as [string];
  const order = unwrap(await authorizedRequest(apiUrl, API.order(orderId), { method: "GET" }));
  const currency = (order as { total?: { currency?: unknown } } | null)?.total?.currency;
  const read = `\`${commandInvocation({ group: "orders", name: "get" })} ${orderId}\``;
  if (typeof currency !== "string") {
    throw new CliError(`Not sent: order ${orderId} shows no total to pay. Read it with ${read}.`, EXIT.error);
  }
  if (currency !== "USD") {
    throw new CliError(
      `Not sent: order ${orderId} is not in USD, and a token pays a USD order only. The user pays by the order's payment link: ${read} shows it.`,
      EXIT.error,
    );
  }
}

/** An order as `orders cancel` reads it, field by field: the read may not
 *  be in the contract's shape. */
type ReadOrder = {
  status?: unknown;
  total?: { currency?: unknown };
  cancel?: { action?: unknown; penalty?: { currency?: unknown } | null };
} | null;

/**
 * `orders cancel` with its mode, after one read of the order. `--close`
 * closes an unpaid order, and answers one already closed, or expired, as it
 * is. `--max-penalty` cancels in the currency of the order's penalty, else
 * of its total. The other mode's order (`--close` on one that can be
 * cancelled, `--max-penalty` on one that can be closed) is not sent: it is
 * refused here as the service refuses it (`modeRefused`). Any other order is
 * sent, and the service answers for it: what blocks an order can pass, and
 * an action this version does not know is not guessed at.
 */
async function cancelOrder(
  apiUrl: string,
  spec: CommandSpec,
  mode: NonNullable<ReturnType<typeof cancelRequest>>,
): Promise<Answer> {
  const { orderId, close, request } = mode;
  const order = unwrap(await authorizedRequest(apiUrl, mode.path, { method: mode.method }));
  const read = order as ReadOrder;
  const action = read?.cancel?.action;
  if (close) {
    if (read?.status === "closed" || read?.status === "expired") {
      return { data: order, text: renderToolResult("cancel_order", order, "cli") };
    }
    if (action === "cancel") throw modeRefused(orderId, order);
    // A close that is answered closed the order: one paid meanwhile is
    // refused with `order_not_cancellable`, never answered as it is.
    const data = unwrap(await authorizedRequest(apiUrl, request.path, { method: "POST", body: request.body }));
    return { data, text: renderToolResult("cancel_order", data, "cli") };
  }
  if (action === "close") throw modeRefused(orderId, order);
  const penalty = read?.cancel?.penalty?.currency;
  const currency = typeof penalty === "string" ? penalty : read?.total?.currency;
  if (typeof currency !== "string") {
    throw new CliError(`Not sent: the order ${orderId} has no currency to send the penalty in.`, EXIT.error);
  }
  const body = request.body as Record<string, unknown>;
  body.maximumPenalty = { ...(body.maximumPenalty as Record<string, unknown>), currency };
  check(spec, { ...body, orderId }, HTTP_ROUTES.cancel_order);
  const data = unwrap(await authorizedRequest(apiUrl, request.path, { method: "POST", body }));
  return { data, text: renderToolResult("cancel_order", data, "cli") };
}

/**
 * The refusal of the other mode's order, as just read: what the
 * service answers such a call, `order_not_cancellable` with the order's
 * cancel state, made here so that nothing is sent. So it reads as the
 * service's does, as text (the order's Cancel line, with the command for
 * the mode that applies) and with `--json` (the envelope), and exits as it
 * does. An order that does not say what can be done to it is not sent
 * either.
 */
function modeRefused(orderId: string, order: unknown): CliError {
  const cancel = orderCancel.safeParse((order as { cancel?: unknown } | null)?.cancel);
  if (!cancel.success) {
    const read = `\`${commandInvocation({ group: "orders", name: "get" })} ${orderId}\``;
    return new CliError(
      `Not sent: order ${orderId} doesn't show what can be done to it now. Read it with ${read}.`,
      EXIT.error,
    );
  }
  const message = "The order can't be cancelled or closed the way that was asked, and nothing was sent.";
  return new CliError(message, EXIT.error, {}, {
    error: {
      code: "order_not_cancellable",
      message,
      retryable: false,
      requestId: localRequestId(),
      details: { orderId, cancel: cancel.data },
    },
  });
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
