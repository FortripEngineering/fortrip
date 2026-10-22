#!/usr/bin/env node

// src/errors.ts
var EXIT = {
  ok: 0,
  error: 1,
  usage: 2,
  unauthenticated: 3,
  rateLimited: 4
};
var CliError = class extends Error {
  constructor(message, exitCode, details = {}) {
    super(message);
    this.exitCode = exitCode;
    this.details = details;
  }
  exitCode;
  details;
};
function usageError(message) {
  return new CliError(message, EXIT.usage);
}

// src/version.ts
import { readFileSync } from "fs";
var VERSION = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")
).version;

// src/api.ts
var LOGIN_HINT = "Run `npx fortrip login` first.";
var REQUEST_TIMEOUT_MS = 12e4;
async function request(apiUrl, path, {
  method = "GET",
  token,
  body
} = {}) {
  let response;
  try {
    response = await fetch(`${apiUrl}${path}`, {
      method,
      headers: {
        accept: "application/json",
        "user-agent": `fortrip-cli/${VERSION}`,
        ...body !== void 0 ? { "content-type": "application/json" } : {},
        ...token ? { authorization: `Bearer ${token}` } : {}
      },
      body: body !== void 0 ? JSON.stringify(body) : void 0,
      // A redirect to another origin would drop the Authorization header and
      // look like a logout; surface it instead.
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch (error) {
    throw new CliError(
      `Could not reach ${apiUrl}: ${error.message}`,
      EXIT.error
    );
  }
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = null;
  }
  const isObject = parsed !== null && typeof parsed === "object";
  return {
    status: response.status,
    body: isObject ? parsed : { error: `Unexpected ${response.status} response`, raw: text.slice(0, 200) },
    headers: response.headers
  };
}
function unwrap(response) {
  const { status, body, headers } = response;
  if (status >= 200 && status < 300 && body.success === true) return body.data;
  const { success: _success, error, message, ...rest } = body;
  const text = typeof error === "string" ? error : typeof message === "string" ? message : `Request failed with status ${status}`;
  const details = { status, ...rest };
  if (status === 401) {
    throw new CliError(`${text}. ${LOGIN_HINT}`, EXIT.unauthenticated, details);
  }
  if (status === 429) {
    const retryAfter = Number(headers.get("retry-after"));
    throw new CliError(text, EXIT.rateLimited, {
      ...details,
      ...Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfterSeconds: retryAfter } : {}
    });
  }
  if (status === 400) throw new CliError(text, EXIT.usage, details);
  if (status >= 300 && status < 400) {
    throw new CliError(
      `Unexpected redirect to ${headers.get("location") ?? "?"}; check FORTRIP_API_URL`,
      EXIT.error,
      details
    );
  }
  throw new CliError(text, EXIT.error, details);
}

// src/args.ts
import { readFileSync as readFileSync2 } from "fs";
import { parseArgs } from "util";
var BODY_OPTION = { body: { type: "string" } };
var CURRENCY_OPTION = { currency: { type: "string" } };
function parse(argv, options) {
  try {
    return parseArgs({ args: argv, options, allowPositionals: true, strict: true });
  } catch (error) {
    throw usageError(error.message);
  }
}
function baseBody(values) {
  const raw = values.body;
  if (typeof raw !== "string") return {};
  let text = raw;
  if (raw.startsWith("@")) {
    try {
      text = readFileSync2(raw.slice(1), "utf8");
    } catch (error) {
      throw usageError(`Cannot read --body file: ${error.message}`);
    }
  }
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
  }
  throw usageError("--body must be a JSON object");
}
function num(flag, value) {
  if (value === void 0) return void 0;
  const parsed = Number(value);
  if (value.trim() === "" || !Number.isFinite(parsed)) {
    throw usageError(`--${flag} must be a number, got "${value}"`);
  }
  return parsed;
}
function nums(flag, values) {
  if (!values?.length) return void 0;
  return values.flatMap((value) => value.split(",")).map((value) => num(flag, value.trim()));
}
function str(value) {
  return typeof value === "string" ? value : void 0;
}
function list(value) {
  return Array.isArray(value) && value.length ? value : void 0;
}
function currency(values, base, env) {
  const flag = str(values.currency)?.trim().toUpperCase();
  if (flag === "") throw usageError("--currency must not be empty");
  if (flag) return flag;
  if (base.currency !== void 0) return void 0;
  return env.FORTRIP_CURRENCY?.trim().toUpperCase() || void 0;
}
function merge(base, overrides) {
  const body = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== void 0) body[key] = value;
  }
  return body;
}
var SEARCH_OPTIONS = {
  ...BODY_OPTION,
  ...CURRENCY_OPTION,
  query: { type: "string", short: "q" },
  "city-code": { type: "string" },
  near: { type: "string" },
  "check-in": { type: "string" },
  "check-out": { type: "string" },
  "star-min": { type: "string" },
  "star-max": { type: "string" },
  facility: { type: "string", multiple: true },
  "price-min": { type: "string" },
  "price-max": { type: "string" },
  sort: { type: "string" },
  page: { type: "string" },
  "page-size": { type: "string" }
};
function searchBody(values, env = process.env) {
  const base = baseBody(values);
  let near;
  const nearRaw = str(values.near);
  if (nearRaw !== void 0) {
    const [lat, lng, radiusKm] = nearRaw.split(",").map((part) => part.trim());
    if (!lat || !lng || !radiusKm) {
      throw usageError("--near must be lat,lng,radiusKm (e.g. 13.75,100.5,5)");
    }
    near = {
      lat: num("near", lat),
      lng: num("near", lng),
      radiusKm: num("near", radiusKm)
    };
  }
  return merge(base, {
    query: str(values.query),
    cityCode: num("city-code", str(values["city-code"])),
    near,
    checkIn: str(values["check-in"]),
    checkOut: str(values["check-out"]),
    starMin: num("star-min", str(values["star-min"])),
    starMax: num("star-max", str(values["star-max"])),
    facilities: list(values.facility),
    priceMin: num("price-min", str(values["price-min"])),
    priceMax: num("price-max", str(values["price-max"])),
    sortBy: str(values.sort),
    page: num("page", str(values.page)),
    pageSize: num("page-size", str(values["page-size"])),
    currency: currency(values, base, env)
  });
}
var HOTEL_OPTIONS = {
  "with-rooms": { type: "boolean" }
};
function hotelPath(positionals, values) {
  const [id, ...extra] = positionals;
  if (!id || extra.length || !/^\d+$/.test(id)) {
    throw usageError("Usage: fortrip hotel <hotelId> [--with-rooms]");
  }
  return `/api/huizhi/hotels/${id}${values["with-rooms"] ? "?include=rooms" : ""}`;
}
var STAY_OPTIONS = {
  "check-in": { type: "string" },
  "check-out": { type: "string" },
  rooms: { type: "string" },
  adults: { type: "string" },
  "child-age": { type: "string", multiple: true }
};
function stayFields(values, base) {
  return {
    checkIn: str(values["check-in"]),
    checkOut: str(values["check-out"]),
    rooms: num("rooms", str(values.rooms)) ?? (base.rooms === void 0 ? 1 : void 0),
    adults: num("adults", str(values.adults)) ?? (base.adults === void 0 ? 2 : void 0),
    childrenAges: nums("child-age", list(values["child-age"]))
  };
}
var RATES_OPTIONS = {
  ...BODY_OPTION,
  ...CURRENCY_OPTION,
  ...STAY_OPTIONS,
  hotel: { type: "string", multiple: true },
  nationality: { type: "string" },
  board: { type: "string", multiple: true },
  "free-cancellation": { type: "boolean" },
  "include-unbookable": { type: "boolean" },
  "max-rooms": { type: "string" }
};
function ratesBody(values, env = process.env) {
  const base = baseBody(values);
  return merge(base, {
    hotelIds: nums("hotel", list(values.hotel)),
    ...stayFields(values, base),
    nationality: str(values.nationality)?.toUpperCase(),
    boardCodes: list(values.board)?.flatMap(
      (code) => code.split(",").map((part) => part.trim().toUpperCase())
    ),
    freeCancellation: values["free-cancellation"] ? true : void 0,
    bookableOnly: values["include-unbookable"] ? false : void 0,
    maxRoomsPerHotel: num("max-rooms", str(values["max-rooms"])),
    currency: currency(values, base, env)
  });
}
var BOOK_OPTIONS = {
  ...BODY_OPTION,
  ...STAY_OPTIONS,
  hotel: { type: "string" },
  "room-id": { type: "string" },
  "rate-plan": { type: "string" },
  guest: { type: "string", multiple: true },
  "contact-name": { type: "string" },
  "contact-phone": { type: "string" },
  "contact-email": { type: "string" },
  "special-requests": { type: "string" }
};
function parseGuest(value) {
  const match = value.trim().match(/^(.+?)(?::(\d+))?$/);
  const words = match?.[1]?.trim().split(/\s+/) ?? [];
  if (words.length < 2) {
    throw usageError(
      `--guest must be "First Last" or "First Last:roomNo", got "${value}"`
    );
  }
  return {
    firstName: words.slice(0, -1).join(" "),
    lastName: words.at(-1),
    roomNo: match?.[2] ? Number(match[2]) : 1
  };
}
function bookBody(values) {
  const base = baseBody(values);
  return merge(base, {
    hotelId: num("hotel", str(values.hotel)),
    roomId: str(values["room-id"]),
    ratePlanCode: str(values["rate-plan"]),
    ...stayFields(values, base),
    guests: list(values.guest)?.map(parseGuest),
    contactName: str(values["contact-name"]),
    contactPhone: str(values["contact-phone"]),
    contactEmail: str(values["contact-email"]),
    specialRequests: str(values["special-requests"])
  });
}

// src/auth.ts
import { hostname } from "os";
import { setTimeout as sleep } from "timers/promises";

// src/browser.ts
import { spawn } from "child_process";
function openBrowser(url) {
  const [command, args] = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", '""', url.replace(/&/g, "^&")]] : ["xdg-open", [url]];
  try {
    const child = spawn(command, args, { stdio: "ignore", detached: true });
    child.on("error", () => {
    });
    child.unref();
  } catch {
  }
}

// src/credentials.ts
import { chmod, mkdir, readFile, rm, writeFile } from "fs/promises";
import { homedir } from "os";
import { dirname, join } from "path";
var DEFAULT_API_URL = "https://fortrip.ai";
function credentialsPath(env = process.env) {
  const base = env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "fortrip", "credentials.json");
}
function resolveApiUrl(env = process.env) {
  const raw = env.FORTRIP_API_URL?.trim() || DEFAULT_API_URL;
  let url;
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
async function readCredentials(path) {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    return { tokens: parsed?.tokens ?? {}, pending: parsed?.pending ?? {} };
  } catch {
    return { tokens: {}, pending: {} };
  }
}
async function writeCredentials(path, file) {
  if (Object.keys(file.tokens).length === 0 && Object.keys(file.pending).length === 0) {
    await rm(path, { force: true });
    return;
  }
  await mkdir(dirname(path), { recursive: true, mode: 448 });
  await writeFile(path, `${JSON.stringify(file, null, 2)}
`, { mode: 384 });
  await chmod(path, 384);
}
async function loadStoredToken(apiUrl, env = process.env) {
  const file = await readCredentials(credentialsPath(env));
  return file.tokens[apiUrl]?.accessToken ?? null;
}
async function resolveToken(apiUrl, env = process.env) {
  const fromEnv = env.FORTRIP_TOKEN?.trim();
  if (fromEnv) return { token: fromEnv, source: "env" };
  const stored = await loadStoredToken(apiUrl, env);
  return stored ? { token: stored, source: "file" } : null;
}
async function saveToken(apiUrl, accessToken, env = process.env) {
  const path = credentialsPath(env);
  const file = await readCredentials(path);
  file.tokens[apiUrl] = { accessToken, createdAt: (/* @__PURE__ */ new Date()).toISOString() };
  delete file.pending[apiUrl];
  await writeCredentials(path, file);
}
async function deleteToken(apiUrl, env = process.env) {
  const path = credentialsPath(env);
  const file = await readCredentials(path);
  delete file.tokens[apiUrl];
  await writeCredentials(path, file);
}
async function loadPendingLogin(apiUrl, env = process.env) {
  const pending = (await readCredentials(credentialsPath(env))).pending[apiUrl];
  return pending && Date.parse(pending.expiresAt) > Date.now() ? pending : null;
}
async function savePendingLogin(apiUrl, pending, env = process.env) {
  const path = credentialsPath(env);
  const file = await readCredentials(path);
  if (pending) file.pending[apiUrl] = pending;
  else delete file.pending[apiUrl];
  await writeCredentials(path, file);
}

// src/auth.ts
async function requireToken(apiUrl) {
  const resolved = await resolveToken(apiUrl);
  if (resolved) return resolved.token;
  const pending = await loadPendingLogin(apiUrl);
  if (pending) {
    const result = await exchange(apiUrl, pending.deviceCode);
    if (result.status === "ok") {
      await saveToken(apiUrl, result.accessToken);
      return result.accessToken;
    }
    if (result.status === "authorization_pending" || result.status === "slow_down") {
      throw loginRequired(apiUrl, pending);
    }
  }
  const start = await startDeviceLogin(apiUrl);
  const fresh = {
    deviceCode: start.deviceCode,
    userCode: start.userCode,
    loginUrl: start.verificationUriComplete,
    expiresAt: new Date(Date.now() + start.expiresIn * 1e3).toISOString()
  };
  await savePendingLogin(apiUrl, fresh);
  throw loginRequired(apiUrl, fresh);
}
async function login({
  apiUrl,
  openBrowser: shouldOpen,
  log,
  wait = sleep
}) {
  const start = await startDeviceLogin(apiUrl);
  log(`Confirm this code in your browser: ${start.userCode}`);
  log(`If the browser doesn't open, visit: ${start.verificationUriComplete}`);
  if (shouldOpen) openBrowser(start.verificationUriComplete);
  log("Waiting for approval\u2026");
  let interval = start.interval;
  const deadline = Date.now() + start.expiresIn * 1e3;
  while (Date.now() < deadline) {
    await wait(interval * 1e3);
    const result = await exchange(apiUrl, start.deviceCode);
    switch (result.status) {
      case "ok":
        await saveToken(apiUrl, result.accessToken);
        log("Logged in.");
        return whoami(apiUrl, result.accessToken);
      case "authorization_pending":
        continue;
      case "slow_down":
        interval = result.interval ?? interval + 5;
        continue;
      case "access_denied":
        throw new CliError("Login was denied in the browser.", EXIT.error);
      case "expired_token":
        throw new CliError(
          "The login code expired. Run `login` again.",
          EXIT.error
        );
    }
  }
  throw new CliError("The login code expired. Run `login` again.", EXIT.error);
}
async function startDeviceLogin(apiUrl) {
  return unwrap(
    await request(apiUrl, "/api/cli/auth/device", {
      method: "POST",
      body: { label: deviceLabel(), platform: process.platform }
    })
  );
}
async function exchange(apiUrl, deviceCode) {
  const poll = await request(apiUrl, "/api/cli/auth/token", {
    method: "POST",
    body: { deviceCode }
  });
  if (poll.status === 200 && poll.body.success === true) {
    const { accessToken } = poll.body.data;
    return { status: "ok", accessToken };
  }
  switch (poll.body.error) {
    case "authorization_pending":
    case "access_denied":
    case "expired_token":
      return { status: poll.body.error };
    case "slow_down":
      return {
        status: "slow_down",
        interval: typeof poll.body.interval === "number" ? poll.body.interval : void 0
      };
    default:
      unwrap(poll);
      throw new CliError(`Unexpected login response ${poll.status}`, EXIT.error);
  }
}
function loginRequired(apiUrl, pending) {
  return new CliError(
    `Not logged in to ${apiUrl}. Ask the user to open loginUrl and approve, then rerun this command (or run \`npx fortrip login\` in a terminal).`,
    EXIT.unauthenticated,
    {
      loginUrl: pending.loginUrl,
      userCode: pending.userCode,
      expiresInSeconds: Math.max(
        0,
        Math.round((Date.parse(pending.expiresAt) - Date.now()) / 1e3)
      )
    }
  );
}
async function logout(apiUrl) {
  const token = await loadStoredToken(apiUrl);
  if (!token) {
    throw new CliError(`Not logged in to ${apiUrl}.`, EXIT.unauthenticated);
  }
  const response = await request(apiUrl, "/api/cli/auth/revoke", {
    method: "POST",
    token
  });
  if (response.status !== 401) unwrap(response);
  await deleteToken(apiUrl);
  return { loggedOut: true, apiUrl };
}
async function whoami(apiUrl, token) {
  const resolved = token ?? await requireToken(apiUrl);
  const data = unwrap(
    await request(apiUrl, "/api/cli/auth/whoami", { token: resolved })
  );
  return { ...data, apiUrl };
}
function deviceLabel() {
  return hostname().replace(/[^\w .@-]/g, "").slice(0, 64);
}

// src/guide.ts
import { readFile as readFile2 } from "fs/promises";
var GUIDES = {
  main: "../AGENT_GUIDE.md",
  planning: "../guides/planning.md"
};
async function readGuide(topic = "main") {
  const path = GUIDES[topic];
  if (!path) throw usageError("Usage: fortrip skill [planning]");
  const guide = await readFile2(new URL(path, import.meta.url), "utf8");
  return guide.replaceAll("fortrip@latest", `fortrip@${VERSION}`);
}

// src/cli.ts
var HELP = `fortrip ${VERSION} \u2014 search, price and book Fortrip hotels

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

search and rates ask for prices in --currency (CNY by default, or USD),
converted at Stripe's rate or a fixed fallback rate; the response's currency
and fx fields say which. book still charges the currency it returns (usually
USD).

Output is JSON on stdout; errors are JSON on stderr.
Exit codes: 0 ok, 1 error, 2 invalid arguments, 3 not logged in, 4 rate limited.

Environment:
  FORTRIP_TOKEN    Use this token instead of the saved login (CI, sandboxes)
  FORTRIP_API_URL  API base URL (default https://fortrip.ai)
  FORTRIP_CURRENCY Default --currency for search and rates
`;
async function run(argv) {
  const [command, ...rest] = argv;
  if (!command || command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(HELP);
    return void 0;
  }
  if (command === "--version" || command === "-v") {
    process.stdout.write(`${VERSION}
`);
    return void 0;
  }
  if (command === "skill") {
    const { positionals } = parse(rest, {});
    process.stdout.write(await readGuide(positionals.join(" ") || void 0));
    return void 0;
  }
  const apiUrl = resolveApiUrl();
  const log = (line) => process.stderr.write(`${line}
`);
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
      const data = await call(
        apiUrl,
        "POST",
        "/api/huizhi/bookings",
        bookBody(values)
      );
      return absolutize(apiUrl, data, ["orderUrl", "statusUrl"]);
    }
    default:
      throw usageError(`Unknown command "${command}". Run \`fortrip --help\`.`);
  }
}
async function call(apiUrl, method, path, body) {
  const token = await requireToken(apiUrl);
  return unwrap(await request(apiUrl, path, { method, token, body }));
}
function absolutize(apiUrl, data, keys) {
  const out = { ...data };
  for (const key of keys) {
    const value = out[key];
    if (typeof value === "string" && value.startsWith("/")) {
      out[key] = `${apiUrl}${value}`;
    }
  }
  return out;
}
async function main() {
  try {
    const result = await run(process.argv.slice(2));
    if (result !== void 0) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}
`);
    }
    return EXIT.ok;
  } catch (error) {
    const failure = error instanceof CliError ? error : new CliError(error?.message ?? String(error), EXIT.error);
    process.stderr.write(
      `${JSON.stringify({ error: failure.message, exitCode: failure.exitCode, ...failure.details }, null, 2)}
`
    );
    return failure.exitCode;
  }
}
process.exitCode = await main();
