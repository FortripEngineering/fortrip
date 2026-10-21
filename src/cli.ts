import { unwrap } from "./api.ts";
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
import { authorizedRequest, login, logout, whoami } from "./auth.ts";
import { resolveApiUrl } from "./credentials.ts";
import { CliError, EXIT, type ExitCode, usageError } from "./errors.ts";
import { readGuide } from "./guide.ts";
import { VERSION } from "./version.ts";

const FLAGS = {
  search: `  --query <text> | --city-code <n> | --near <lat,lng,km>
  --check-in YYYY-MM-DD --check-out YYYY-MM-DD
  [--star-min n] [--star-max n] [--facility <name>]... [--price-min n]
  [--price-max n] [--sort recommended|price-asc|price-desc|star-desc|distance]
  [--page n] [--page-size n] [--currency CNY|USD]`,
  rates: `  --hotel <id>... --check-in YYYY-MM-DD --check-out YYYY-MM-DD
  [--rooms 1] [--adults 2] [--child-age n]... [--nationality CN]
  [--board BB]... [--free-cancellation] [--include-unbookable]
  [--max-rooms n] [--currency CNY|USD]`,
  book: `  --hotel <id> --room-id <id> --rate-plan <code>
  --check-in YYYY-MM-DD --check-out YYYY-MM-DD --rooms <n> --adults <n>
  [--child-age n]... --guest "First Last[:roomNo]"...
  --contact-name <name> --contact-phone <phone> [--contact-email <email>]
  [--special-requests <english text>]`,
};

const BODY_NOTE = `Also takes --body '<json>' (or --body @file.json) with the raw request
body; flags override its fields.`;

const OCCUPANCY_NOTE = `--adults and --child-age are per room, and every room has the same
occupancy: 2 rooms for 4 adults is --rooms 2 --adults 2. Limits: 1-8 rooms,
1-8 adults and 0-8 children (aged 0-17) per room, 1-15 nights.`;

/** `fortrip <command> --help`. */
const USAGE: Record<string, string> = {
  login: `Usage: fortrip login [--no-browser]

Signs in through the browser with a device code and waits up to 10 minutes
for approval. Any other command starts the same login itself and exits 3
with loginUrl instead of waiting; AI agents should rely on that.
`,
  logout: `Usage: fortrip logout

Revokes the saved token on the server and deletes it locally.
`,
  whoami: `Usage: fortrip whoami

Shows the signed-in account.
`,
  search: `Usage: fortrip search [options]

Finds hotels with indicative prices: floors, not quotes.

${FLAGS.search}

${BODY_NOTE}
`,
  hotel: `Usage: fortrip hotel <hotelId> [--with-rooms]

Static hotel detail: description, policies, facilities and photos;
--with-rooms adds the room types.
`,
  rates: `Usage: fortrip rates [options]

Live rooms and rates for up to 15 hotels; takes about 15 seconds.

${FLAGS.rates}

${OCCUPANCY_NOTE}

Meal codes (--board, boardCode): RO room only, BB breakfast, HB breakfast +
dinner, FB breakfast + lunch + dinner, BL lunch, BD dinner, HBBL breakfast +
lunch, HBLD lunch + dinner, AI all inclusive. boardCount is the number of
meal portions included (BB with boardCount 1 for 2 adults covers one person).

--nationality isn't sent with the booking: a rate restricted to that
nationality may change or be refused at book.

${BODY_NOTE}
`,
  book: `Usage: fortrip book [options]

Creates the order and returns paymentUrl with the amount, currency, terms and
stay. Show those to the user and get their confirmation, then give them
paymentUrl exactly as returned. Payment happens only on that page: never ask
for or pass on card details. Rerunning with the same flags returns the same
order.

${FLAGS.book}

Use exactly the hotel, room, rate plan, dates, rooms, adults and child ages
from rates. ${OCCUPANCY_NOTE}

${BODY_NOTE}
`,
  skill: `Usage: fortrip skill [planning]

Prints the guide for AI agents (Markdown); planning covers flexible dates,
budgets, split stays and several destinations.
`,
};

const HELP = `fortrip ${VERSION} — search, price and book Fortrip hotels

Usage: fortrip <command> [options]
       fortrip <command> --help

Commands:
  login [--no-browser]        Sign in through the browser (device code)
  logout                      Revoke and forget the saved token
  whoami                      Show the signed-in account
  search                      Find hotels with indicative prices
  hotel <hotelId>             Static hotel detail [--with-rooms]
  rates                       Live rooms and rates for up to 15 hotels
  book                        Create an order and get a payment link
  skill [planning]            Print the guide for AI agents (Markdown)

search:
${FLAGS.search}
rates:
${FLAGS.rates}
book:
${FLAGS.book}

search, rates and book also take --body '<json>' (or --body @file.json) with
the raw request body; flags override its fields.

--adults and --child-age are per room: every room has the same occupancy
(2 rooms for 4 adults is --rooms 2 --adults 2).

search and rates ask for prices in --currency (CNY by default, or USD),
converted at Stripe's rate or a fixed fallback rate; the response's currency
and fx fields say which. book still charges the currency it returns (usually
USD).

Output is JSON on stdout; errors are JSON on stderr.
Exit codes: 0 ok, 1 error (retry once when stderr has "retryable": true),
2 invalid arguments, 3 not logged in, 4 rate limited.

Environment:
  FORTRIP_TOKEN    Use this token instead of the saved login (CI, sandboxes)
  FORTRIP_API_URL  API base URL (default https://fortrip.ai)
  FORTRIP_CURRENCY Default --currency for search and rates
`;

/** Links in `book` results and errors. */
const LINK_KEYS = ["paymentUrl", "statusUrl", "orderUrl"];

async function run(argv: string[]): Promise<unknown> {
  const [command, ...rest] = argv;
  if (!command || command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(HELP);
    return undefined;
  }
  const usage = Object.hasOwn(USAGE, command) ? USAGE[command] : undefined;
  if (usage && wantsHelp(rest)) {
    process.stdout.write(usage);
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
      let data: Record<string, unknown>;
      try {
        data = (await call(
          apiUrl,
          "POST",
          "/api/huizhi/bookings",
          bookBody(values),
        )) as Record<string, unknown>;
      } catch (error) {
        if (!(error instanceof CliError)) throw error;
        // A 409 for a stay already booked carries orderUrl and statusUrl.
        throw new CliError(
          error.message,
          error.exitCode,
          absolutize(apiUrl, error.details, LINK_KEYS),
        );
      }
      return paymentPage(absolutize(apiUrl, data, LINK_KEYS));
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
  return unwrap(await authorizedRequest(apiUrl, path, { method, body }));
}

/** `--help` or `-h` anywhere before `--`. */
function wantsHelp(args: string[]): boolean {
  for (const arg of args) {
    if (arg === "--") return false;
    if (arg === "--help" || arg === "-h") return true;
  }
  return false;
}

/** Older servers answer site-relative links; an agent needs full URLs. */
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

/**
 * Older servers answer a Stripe Checkout `paymentUrl`: 400+ characters
 * ending in a #fragment the session needs, which models relaying it drop.
 * The status page shows the terms and continues to Stripe, as the current
 * server's `paymentUrl` does.
 */
function paymentPage(data: Record<string, unknown>): Record<string, unknown> {
  const { paymentUrl, statusUrl } = data;
  if (typeof statusUrl !== "string" || typeof paymentUrl !== "string") return data;
  let host: string;
  try {
    host = new URL(paymentUrl).hostname;
  } catch {
    return data;
  }
  return host === "checkout.stripe.com" ? { ...data, paymentUrl: statusUrl } : data;
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
