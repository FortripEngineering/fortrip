/**
 * What a guest name may contain.
 *
 * The old rule was `[A-Za-z\s-]+`, carrying the comment "the supplier only
 * accepts Latin guest names". The supplier's booking endpoint actually types
 * `firstName` / `lastName` as bare strings with NO character constraint —
 * Latin is a convention its examples follow, not a documented rule. Evidence
 * the old rule was never verified: `contactName`, which travels the same
 * request, has never been pattern-checked at all.
 *
 * So the apostrophe and the period are back: `O'Brien`, `D'Angelo`,
 * `St. John`, `Jr.` are ordinary passport spellings that we were rejecting
 * before the supplier ever saw them. Curly apostrophes come in from phone
 * keyboards and normalize to straight ones rather than being refused.
 *
 * Still refused: CJK, other non-Latin scripts, and accented Latin (José,
 * Müller). Be clear about whose rule this is — **ours**. The supplier accepts
 * CJK names outright: `伟`/`张` booked successfully against its sandbox on
 * 2026-08-07. The old comment here claimed "the supplier only accepts Latin
 * guest names" and that was simply false, in whole, not just in the
 * apostrophe it also got wrong.
 *
 * We keep the restriction for a reason the supplier API can't speak to: the
 * property reads these names at check-in, most of them can't render CJK, and
 * passports carry an ASCII transliteration in the machine-readable zone (JOSE,
 * MUELLER) — that is the spelling a front desk matches. So the model
 * transliterates and the form asks the user to. If that trade is ever
 * revisited, revisit it as a product decision about hotels, not as "restoring
 * supplier parity" — parity already permits CJK.
 */

/** Straight and curly apostrophes, both accepted; curly ones normalize away. */
const CURLY_APOSTROPHES = /[‘’]/g;

/** The name itself, once trimmed: a letter, then letters and name punctuation.
 *  Leading punctuation is refused so `...` or `-Wei` can't pass as a name.
 *
 *  The hyphen MUST stay escaped. Browsers compile `pattern` with the `v`
 *  (unicodeSets) flag, under which a bare `-` anywhere in a character class is
 *  a syntax error — and an invalid `pattern` is DISCARDED, silently disabling
 *  client-side validation with no error anywhere but the devtools console.
 *  `guest-name.test.ts` compiles this with `v` to keep that honest. */
const CORE = "[A-Za-z][A-Za-z '‘’.\\-]*";

/**
 * HTML `pattern` body — implicitly anchored by the browser, and applied to the
 * RAW field value, which is why it is looser than `guestNameRe` rather than
 * identical to it.
 *
 * Two things force the slack. Browsers skip `pattern` only when a value is the
 * empty string, so `"   "` is validated — and a `CORE`-only pattern would
 * refuse it. That breaks the reveal affordance outright: a user who opens a
 * row, types a name, then deletes it leaving one stray space has no Remove
 * button and no way forward, stranded on the payment screen by the very
 * mechanism that was supposed to be the undo. Allowing an all-blank value
 * hands that row to `collectGuestsFromForm`, which drops it — the undo works.
 * Surrounding whitespace is allowed for the same reason a pasted `" Wei"`
 * should not be rejected in the browser when `normalizeGuestName` would trim it
 * server-side anyway (the old `[A-Za-z\s\-]+` accepted it; refusing it here
 * would be a regression).
 *
 * The cost is deliberate: a required lead row holding only spaces passes the
 * browser and is caught server-side ("Room 1 needs at least one guest name.").
 * That trade favours the common case — stray whitespace while erasing — over
 * the rare one, someone typing nothing but spaces into a required field.
 */
export const GUEST_NAME_PATTERN = `\\s*|\\s*${CORE}\\s*`;

/** Server-side check, applied AFTER `normalizeGuestName`, so it sees no
 *  surrounding whitespace and can be strict. Deliberately not derived from
 *  `GUEST_NAME_PATTERN` — they validate different values at different stages.
 *  `guest-name.test.ts` pins the relationship that actually matters: anything
 *  the browser accepts is, once normalized, either empty or accepted here. */
export const guestNameRe = new RegExp(`^${CORE}$`);

/** Shown as the `title` on every guest-name input, so a rejected value
 *  explains itself. Names the first-character rule because the pattern enforces
 *  it and a Dutch `'t Hooft` would otherwise be refused with no explanation. */
export const GUEST_NAME_TITLE =
  "Latin letters as in the passport — start with a letter; spaces, hyphens, apostrophes and periods are fine after that. Transliterate accents (Müller → Mueller).";

/** The server's answer to a name `guestNameRe` refuses: what to type
 *  instead, for a caller that can't see the form's `title`. */
export const GUEST_NAME_MESSAGE =
  "Guest names must use Latin letters as on the passport (e.g. ZHANG, Wei; Müller → Mueller).";

/** Collapse whitespace and straighten curly apostrophes. Applied server-side so
 *  both booking surfaces store one spelling of the same name. */
export function normalizeGuestName(value: string): string {
  return value.replace(CURLY_APOSTROPHES, "'").replace(/\s+/g, " ").trim();
}
