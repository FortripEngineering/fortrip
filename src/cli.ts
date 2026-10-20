import { request, unwrap } from "./api.ts";
import {
  BOOK_OPTIONS,
  bookBody,
  HOTEL_OPTIONS,
  hotelPath,
  parse,
  RATES_OPTIONS,
  ratesBody,
  SEARCH_OPTIONS,
  searchBody,
} from "./args.ts";
import { login, logout, requireToken, whoami } from "./auth.ts";
import { resolveApiUrl } from "./credentials.ts";
import { CliError, EXIT, type ExitCode, usageError } from "./errors.ts";
import { readGuide } from "./guide.ts";
import { VERSION } from "./version.ts";

const HELP = `fortrip ${VERSION} — search, price and book Fortrip hotels

Usage: fortrip <command> [options]

Commands:
  login [--no-browser]        Sign in through the browser (device code)
  logout                      Revoke and forget the saved token
  whoami                      Show the signed-in account
  search                      Find hotels with indicative prices
  hotel <hotelId>             Static hotel detail [--with-rooms]
  rates                       Live rooms and rates for up to 15 hotels
  book                        Create an order and get a payment link
  skill [planning]            Print the guide for AI agents (Markdown)

search:  --query <text> | --city-code <n> | --near <lat,lng,km>
         --check-in YYYY-MM-DD --check-out YYYY-MM-DD
         [--star-min n] [--star-max n] [--facility <name>]... [--price-min n]
         [--price-max n] [--sort recommended|price-asc|price-desc|star-desc|distance]
         [--page n] [--page-size n] [--currency CNY|USD]
rates:   --hotel <id>... --check-in --check-out [--rooms 1] [--adults 2]
         [--child-age n]... [--nationality CN] [--board BB]...
         [--free-cancellation] [--include-unbookable] [--max-rooms n]
         [--currency CNY|USD]
book:    --hotel <id> --room-id <id> --rate-plan <code> --check-in --check-out
         [--rooms 1] [--adults 2] [--child-age n]...
         --guest "First Last[:roomNo]"... --contact-name <name>
         --contact-phone <phone> [--contact-email <email>]
         [--special-requests <english text>]

search, rates and book also take --body '<json>' (or --body @file.json) with
the raw request body; flags override its fields.

search and rates show prices in --currency (CNY by default, or USD), converted
at Stripe's rate; book still charges the currency it returns (usually USD).

Output is JSON on stdout; errors are JSON on stderr.
Exit codes: 0 ok, 1 error, 2 invalid arguments, 3 not logged in, 4 rate limited.

Environment:
  FORTRIP_TOKEN    Use this token instead of the saved login (CI, sandboxes)
  FORTRIP_API_URL  API base URL (default https://fortrip.ai)
  FORTRIP_CURRENCY Default --currency for search and rates
`;

async function run(argv: string[]): Promise<unknown> {
  const [command, ...rest] = argv;
  if (!command || command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(HELP);
    return undefined;
  }
  if (command === "--version" || command === "-v") {
    process.stdout.write(`${VERSION}\n`);
    return undefined;
  }
  if (command === "skill") {
    const { positionals } = parse(rest, {});
    process.stdout.write(await readGuide(positionals.join(" ") || undefined));
    return undefined;
  }

  const apiUrl = resolveApiUrl();
  const log = (line: string) => process.stderr.write(`${line}\n`);
  switch (command) {
    case "login": {
      const { values } = parse(rest, { "no-browser": { type: "boolean" } });
      if (process.env.FORTRIP_TOKEN) {
        log("Note: FORTRIP_TOKEN is set and takes precedence over this login.");
      }
      return login({ apiUrl, openBrowser: !values["no-browser"], log });
    }
    case "logout":
      parse(rest, {});
      return logout(apiUrl);
    case "whoami":
      parse(rest, {});
      return whoami(apiUrl);
    case "search": {
      const { values } = parse(rest, SEARCH_OPTIONS);
      return call(apiUrl, "POST", "/api/huizhi/search", searchBody(values));
    }
    case "hotel": {
      const { values, positionals } = parse(rest, HOTEL_OPTIONS);
      return call(apiUrl, "GET", hotelPath(positionals, values));
    }
    case "rates": {
      const { values } = parse(rest, RATES_OPTIONS);
      return call(apiUrl, "POST", "/api/huizhi/rates", ratesBody(values));
    }
    case "book": {
      const { values } = parse(rest, BOOK_OPTIONS);
      const data = (await call(
        apiUrl,
        "POST",
        "/api/huizhi/bookings",
        bookBody(values),
      )) as Record<string, unknown>;
      return absolutize(apiUrl, data, ["orderUrl", "statusUrl"]);
    }
    default:
      throw usageError(`Unknown command "${command}". Run \`fortrip --help\`.`);
  }
}

async function call(
  apiUrl: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const token = await requireToken(apiUrl);
  return unwrap(await request(apiUrl, path, { method, token, body }));
}

/** The API returns site-relative order links; an agent needs full URLs. */
function absolutize(
  apiUrl: string,
  data: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> {
  const out = { ...data };
  for (const key of keys) {
    const value = out[key];
    if (typeof value === "string" && value.startsWith("/")) {
      out[key] = `${apiUrl}${value}`;
    }
  }
  return out;
}

async function main(): Promise<ExitCode> {
  try {
    const result = await run(process.argv.slice(2));
    if (result !== undefined) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    }
    return EXIT.ok;
  } catch (error) {
    const failure =
      error instanceof CliError
        ? error
        : new CliError((error as Error)?.message ?? String(error), EXIT.error);
    process.stderr.write(
      `${JSON.stringify({ error: failure.message, exitCode: failure.exitCode, ...failure.details }, null, 2)}\n`,
    );
    return failure.exitCode;
  }
}

process.exitCode = await main();
