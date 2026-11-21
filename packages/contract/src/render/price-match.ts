import type { PriceMatch } from "../outputs/price-match.ts";
import type { RenderSurface } from "../tools.ts";
import { label, money, plural, when } from "./format.ts";
import { code, joined, type Ours, ours, theirs, token } from "./third-party.ts";

/*
 * A price match, as `request_price_match` and `get_price_match` answer it:
 * one text per state. Every line begins with Fortrip's words. What someone
 * else wrote (the site's name as the user gave it, what the check wrote of
 * its steps and its note, a room's name and terms as a site gave them) is
 * in quotes; what Fortrip generates (ids, links, amounts, dates) is bare.
 * A state this build does not know says nothing of a match.
 */

const STATE_WORDS: Record<string, string> = {
  checking: "checking",
  matched: "matched",
  partial: "partly matched",
  declined: "declined",
};

const VIA_WORDS: Record<string, string> = {
  site: "read from the site's own page",
  data: "from price data for that site",
};

/** Why there is no new offer, one sentence each. */
const REASON_WORDS: Record<string, string> = {
  not_lower: "the site was not lower than Fortrip's price.",
  not_offered: "that site does not sell this room for these dates, so there is no price to match.",
  site_unreadable: "Fortrip could not see this stay's price on that site, so it could not check it.",
  site_not_credible: "Fortrip only matches well-known booking sites and the hotel's own site.",
  unsupported: "price match is not available for this offer: for now it covers USD offers of one room, and not a price already matched.",
  daily_limit: "no more checks for now; try again later.",
  monthly_limit: "price match is not available for now.",
  unfinished: "the check could not finish in time; the same request again starts a new check.",
  unavailable: "price match is not available right now.",
};

/** The call that reads the price match again, as `surface` makes it. Before
 *  a claim exists, the same request again answers the same price match. */
function lookCall(r: PriceMatch, surface: RenderSurface): Ours {
  if (r.claimId === undefined) {
    return surface === "cli"
      ? ours`run the same \`fortrip hotels price-match\` command again`
      : ours`call request_price_match again with the same arguments`;
  }
  return surface === "cli"
    ? ours`run \`fortrip hotels price-match-status ${token("id", r.claimId)}\``
    : ours`call get_price_match { claimId: ${theirs(r.claimId)} }`;
}

/** The call that orders the new offer, as `surface` makes it. */
function orderCall(offerId: string, surface: RenderSurface): Ours {
  return surface === "cli"
    ? ours`run \`fortrip orders create --offer ${token("id", offerId)}\` with the guests and the contact`
    : ours`call create_order with offer ${token("id", offerId)}`;
}

function headLine(r: PriceMatch): Ours {
  return joined(
    [
      r.claimId === undefined ? ours`Price match` : ours`Price match ${token("id", r.claimId)}`,
      label(STATE_WORDS, r.state, ours`state not recognized`),
      ours`site ${theirs(r.site)}`,
      ours`offer ${token("id", r.offerId)}, Fortrip's total ${money(r.ourTotal)}`,
    ],
    " · ",
  );
}

function seenLines(r: PriceMatch): Ours[] {
  return (r.seen ?? []).map((s) =>
    joined(
      [
        ours`Seen on ${theirs(s.site)}: ${money(s.total)}, ${label(VIA_WORDS, s.via, ours`from a source not recognized`)}`,
        s.room !== undefined && ours`room ${theirs(s.room)}`,
        s.terms !== undefined && ours`terms ${theirs(s.terms)}`,
      ],
      " · ",
    ),
  );
}

const progressLine = (r: PriceMatch): Ours[] =>
  r.progressUrl === undefined ? [] : [ours`Progress page, to share with the user: ${token("url", r.progressUrl)}`];

const noteLine = (r: PriceMatch): Ours[] =>
  r.note === undefined ? [] : [ours`Note from the check: ${theirs(r.note)}`];

/** The lines every state but checking ends its data with. */
const aboutLines = (r: PriceMatch): Ours[] => [...progressLine(r), ...noteLine(r)];

/** Fortrip's own fees at the hotel, counted in the comparison; none when
 *  absent or zero. On a match, they are why the new total is below the
 *  other site's; a partial match is above it, so it says only that. */
function ourFeesLine(r: PriceMatch): Ours[] {
  const fees = r.ourFeesAtProperty;
  if (fees === undefined || /^0+(?:\.0+)?$/.test(fees.amount)) return [];
  const due = ours`The comparison counts what is paid at the hotel: this offer also has ${money(fees)} due at the property`;
  return [
    r.state === "matched"
      ? ours`${due}, so the new total can be below the other site's total by that amount.`
      : ours`${due}.`,
  ];
}

const feeLine = (r: PriceMatch): Ours[] =>
  r.propertyFeeLeftOut === true ? [ours`A fee payable at the property is left out of this comparison.`] : [];

function checkingLines(r: PriceMatch, surface: RenderSurface): Ours[] {
  const wait =
    r.checkAgainAfterSeconds === undefined ? ours`shortly` : ours`in ${plural(r.checkAgainAfterSeconds, "second")}`;
  // A model in a chat cannot wait within its turn: without this it reads
  // the same answer again at once, over and over.
  const instead =
    r.progressUrl === undefined
      ? ours`ask the user to ask again in a few minutes`
      : ours`give the user the progress page and ask them to ask again in a few minutes`;
  // With no wait stated there is nothing to be sooner than.
  const sooner =
    r.checkAgainAfterSeconds === undefined ? ours`If you cannot wait` : ours`Do not look sooner: if you cannot wait`;
  return [
    ...progressLine(r),
    ...(r.step === undefined ? [] : [ours`Latest step: ${theirs(r.step)}`]),
    ...noteLine(r),
    ours`Look again ${wait}: ${lookCall(r, surface)}. ${sooner}, ${instead}. The check can take up to ten minutes. Until the state is matched or partial, say nothing to the user about a match or a lower price.`,
  ];
}

function matchLines(r: PriceMatch, surface: RenderSurface): Ours[] {
  const m = r.matchedOffer;
  if (m === undefined) {
    return [
      ...seenLines(r),
      ...aboutLines(r),
      ours`New offer: none in this answer; say nothing to the user about a match yet, and look again: ${lookCall(r, surface)}.`,
    ];
  }
  const other =
    r.state === "partial"
      ? [
          ours`Other site's total: ${r.otherTotal === undefined ? ours`not stated` : money(r.otherTotal)}. Fortrip's limit on a price match stopped short of it: the new offer is the lowest this price match can give.`,
        ]
      : [];
  return [
    ours`New offer: ${token("id", m.offerId)} · total ${money(m.total)} · saves ${money(m.saved)} · expires ${when(m.expiresAt, null)}`,
    ...other,
    ...ourFeesLine(r),
    ...seenLines(r),
    ours`Every other term of the new offer is as in offer ${token("id", r.offerId)}: the room, meals, cancellation and fees payable at the property.`,
    ...feeLine(r),
    ...aboutLines(r),
    ours`To book at this price: ${orderCall(m.offerId, surface)}, as for any offer, before it expires.`,
  ];
}

function declinedLines(r: PriceMatch): Ours[] {
  const why = r.reason === undefined ? ours`not stated.` : label(REASON_WORDS, r.reason, ours`a reason not recognized.`);
  return [
    ...seenLines(r),
    ours`Why: ${why}`,
    ...feeLine(r),
    ...aboutLines(r),
    ours`No new offer: offer ${token("id", r.offerId)} stays as it was.`,
  ];
}

export function renderPriceMatch(r: PriceMatch, surface: RenderSurface = "mcp"): string {
  let lines: Ours[];
  switch (r.state) {
    case "checking":
      lines = checkingLines(r, surface);
      break;
    case "matched":
    case "partial":
      lines = matchLines(r, surface);
      break;
    case "declined":
      lines = declinedLines(r);
      break;
    default:
      lines = [
        ...aboutLines(r),
        ours`State ${code(r.state, ours`not recognized`)}: say nothing to the user about a match, and look again: ${lookCall(r, surface)}.`,
      ];
  }
  return [headLine(r), ...lines].join("\n");
}
