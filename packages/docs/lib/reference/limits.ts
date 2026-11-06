import { type LIMITS, RATE_LIMITS, type RateLimitScope, type ToolName } from "@fortrip/agent-contract";

type Limits = typeof LIMITS;

const n = (value: number) => value.toLocaleString("en-US");

/** Each contract limit as a table row: what it limits, its value, and where
 *  it applies; `null` for a limit shown in another's row. Keyed by limit, so
 *  a limit the contract gains fails the typecheck until it has a place. */
const ROWS: Record<keyof Limits, ((l: Limits) => [string, string, string]) | null> = {
  rooms: (l) => ["Rooms", `1–${l.rooms}`, "Per search, offers call or order."],
  adultsPerRoom: (l) => ["Adults per room", `1–${l.adultsPerRoom}`, "Per room."],
  childrenPerRoom: (l) => [
    "Children per room",
    `0–${l.childrenPerRoom}`,
    "Per room, each with an age.",
  ],
  childAgeMax: (l) => ["Child age", `0–${l.childAgeMax}`, "Years, at check-in."],
  nightsFortrip: null,
  nightsSupplier: (l) => [
    "Nights per stay",
    String(l.nightsSupplier),
    `Search, offers and orders answer \`stay_unsupported\` for a longer stay (\`invalid_request\` past ${l.nightsFortrip}); split it into consecutive stays, each its own order.`,
  ],
  offersHotels: (l) => [
    "Hotels per offers call",
    String(l.offersHotels),
    "`hotelIds` in one offers request.",
  ],
  offersPerHotelDefault: (l) => [
    "Offers per hotel",
    `1–${l.offersPerHotelMax}, default ${l.offersPerHotelDefault}`,
    "`limitPerHotel`: a spread of choices (the cheapest, the cheapest free to cancel, the cheapest with breakfast, other rooms), listed cheapest first.",
  ],
  offersPerHotelMax: null,
  pageSizeDefault: (l) => [
    "Page size",
    `1–${l.pageSizeMax}, default ${l.pageSizeDefault}`,
    "`limit`: hotels per search page, orders per list page.",
  ],
  pageSizeMax: null,
  textLength: (l) => ["Search text", `1–${l.textLength} characters`, "`text` in a search."],
  radiusMetersMax: (l) => [
    "Search radius",
    `1–${n(l.radiusMetersMax)} m, default ${n(l.radiusMetersDefault)} m`,
    "`radiusMeters`. The default applies to towns, neighbourhoods, small islands and points; a whole area has no radius unless one is given.",
  ],
  radiusMetersDefault: null,
  amenityFilters: (l) => [
    "Amenity filters",
    `up to ${l.amenityFilters}`,
    "`filters.amenities` in a search.",
  ],
  guestName: (l) => [
    "Guest name",
    `${l.guestName} characters`,
    "Each first or last name, in Latin letters.",
  ],
  contactFirstName: (l) => [
    "Contact first name",
    `${l.contactFirstName} characters`,
    "`contact.firstName` of an order.",
  ],
  contactLastName: (l) => [
    "Contact last name",
    `${l.contactLastName} characters`,
    "`contact.lastName` of an order.",
  ],
  contactPhoneMin: (l) => [
    "Contact phone",
    `${l.contactPhoneMin}–${l.contactPhoneMax} characters`,
    "`contact.phone`, with its country code.",
  ],
  contactPhoneMax: null,
  specialRequests: (l) => [
    "Special requests",
    `${l.specialRequests} characters`,
    "In English; the hotel doesn't guarantee them.",
  ],
  poolLimit: (l) => [
    "Hotels priced for a price sort or filter",
    n(l.poolLimit),
    "Over an area or text with more matches, the search answers `search_too_broad` with its localities; over a radius, it prices the nearest ones.",
  ],
  candidatesShown: (l) => [
    "Candidates shown",
    String(l.candidatesShown),
    "Places listed by `destination_ambiguous`.",
  ],
  candidatesCounted: (l) => [
    "Candidates counted",
    `up to ${l.candidatesCounted}`,
    "`candidatesTotal` of `destination_ambiguous`.",
  ],
  localitiesShown: (l) => [
    "Localities listed",
    String(l.localitiesShown),
    "`localities` of an area search or `search_too_broad`, by match count.",
  ],
  tokenPaymentMaxUsd: (l) => [
    "Token payment",
    `up to $${n(l.tokenPaymentMaxUsd)}`,
    "An order's total payable with a shared payment token (Link's cap on a spend request); a larger order's `payment.methods` has no `stripe_shared_payment_token` entry.",
  ],
  payMinMinutesLeft: (l) => [
    "Time left to offer a Link token or Alipay or WeChat Pay",
    `${l.payMinMinutesLeft} minutes`,
    "Once less is left before the order's `payment.expiresAt`, `payment.methods` offers no token and no Alipay or WeChat Pay payment can be opened.",
  ],
  payCutoffMinutes: (l) => [
    "Time left to pay",
    `${l.payCutoffMinutes} minutes`,
    "Once less is left before the order's `payment.expiresAt`, `pay_order` answers `order_not_payable`, by Link token or by Alipay or WeChat Pay.",
  ],
  tokensPerOrder: (l) => [
    "Tokens per order",
    String(l.tokensPerOrder),
    "Shared payment tokens one order can take, declined ones included; past it, `payment_method_unavailable`.",
  ],
  wechatCodeMinutes: (l) => [
    "WeChat Pay code",
    `${l.wechatCodeMinutes} minutes`,
    "How long a WeChat Pay code in `payment.methods` lasts after it is made.",
  ],
  ordersPerStay: (l) => [
    "Orders per stay",
    String(l.ordersPerStay),
    "Orders one account can make for one stay (the same room, rate, dates and party); past it, `order_exists`.",
  ],
};

/** The rows of the limits table. Takes the limits as an argument so a test
 *  can see that every one is read. */
export function limitRows(limits: Limits): Array<[string, string, string]> {
  return Object.values(ROWS).flatMap((row) => (row ? [row(limits)] : []));
}

/** Each operation in prose. Keyed by tool, so a tool the contract gains
 *  fails the typecheck until it has a name. */
export const OPERATION_NAMES: Record<ToolName, string> = {
  search_hotels: "search",
  get_hotel: "hotel details",
  get_hotel_offers: "offers",
  book_hotel: "order creation",
  get_order: "order reads",
  list_orders: "order lists",
  cancel_order: "order cancellations",
  pay_order: "order payments",
};

/** The scopes the contract names (its type also admits any other string). */
type Scope = RateLimitScope extends infer S ? (S extends string ? (string extends S ? never : S) : never) : never;

/** What the contract doesn't say about a rate limit: the tools whose calls
 *  count against it, and whether they are refused (in production) while the
 *  limiter is down. Keyed by scope, so a scope the contract gains fails the
 *  typecheck until it is described. */
const SCOPES: Record<Scope, { operations: ToolName[]; failClosed: boolean }> = {
  search: { operations: ["search_hotels"], failClosed: false },
  offers: { operations: ["get_hotel_offers"], failClosed: false },
  hotel: { operations: ["get_hotel"], failClosed: false },
  orders_create: { operations: ["book_hotel"], failClosed: true },
  orders_read: { operations: ["get_order", "list_orders"], failClosed: false },
  orders_cancel: { operations: ["cancel_order"], failClosed: true },
  orders_pay: { operations: ["pay_order"], failClosed: true },
};

export interface RateLimitRow {
  scope: Scope;
  perMinute: number;
  /** The tools whose calls count against it. */
  operations: ToolName[];
  /** Refused when the limiter is down (in production). */
  failClosed: boolean;
}

/** The per-user limits the API enforces (spec §13), from the contract's
 *  `RATE_LIMITS`. */
export function rateLimitRows(): RateLimitRow[] {
  return (Object.keys(SCOPES) as Scope[]).map((scope) => {
    const { limit, windowSeconds } = RATE_LIMITS[scope];
    if (windowSeconds !== 60) throw new Error(`${scope} is not per minute`);
    return { scope, perMinute: limit, ...SCOPES[scope] };
  });
}

/** The operations refused while the rate limiter is down, as the subject
 *  of "…, which answer(s) 503": "a, which answers", "a and b, which
 *  answer", "a, b and c, which answer". */
export function failClosedClause(): string {
  const names = rateLimitRows()
    .filter((row) => row.failClosed)
    .flatMap((row) => row.operations.map((name) => OPERATION_NAMES[name]));
  return names.length > 1
    ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}, which answer`
    : `${names.join("")}, which answers`;
}
