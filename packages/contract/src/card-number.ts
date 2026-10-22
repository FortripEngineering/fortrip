/** Shown on a booking field that seems to hold a payment card number. */
export const CARD_NUMBER_MESSAGE =
  "This looks like a payment card number. Payment happens only on the payment page; if it isn't a card number, rewrite it.";

/** No phone number has more than 15 digits, country code included (E.164). */
const PHONE_MAX_DIGITS = 15;

/**
 * Whether `text` holds a payment card number in one of the two ways people
 * type one: 13–19 digits in a single run, or groups of four digits (the last
 * 1–4) split by one space or one hyphen. It must start like a card (Mir
 * 2200–2204, Mastercard 2221–2720, 3, 4, 5, 6, RuPay 81/82) and pass the
 * Luhn check. Full-width digits count (NFKC).
 *
 * Deliberately narrow, because every looser rule flagged ordinary text: no
 * joining across `/`, `.`, `_`, line breaks or double spaces (two phone
 * numbers, a list of room numbers, one number per line), and no Amex-style
 * 4-6-5 grouping (missed; a 15-digit Amex in one run is still caught). A
 * card may start at any digit group, so a room number or date in front of it
 * can't hide it. Right after `+` come a phone number's country code and
 * number, so digits there count only from 16 on, too many for a phone.
 *
 * `minDigits` is the shortest card looked for. A phone field passes 16, so a
 * phone isn't mistaken for a card there, at the cost of missing cards of
 * 13–15 digits (Amex).
 */
export function containsCardNumber(text: string, minDigits = 13): boolean {
  const normalized = text.normalize("NFKC");
  for (const start of normalized.matchAll(/(?<!\d)\d+/g)) {
    const run = start[0];
    const shortest =
      normalized[start.index - 1] === "+"
        ? Math.max(minDigits, PHONE_MAX_DIGITS + 1)
        : minDigits;
    if (run.length >= shortest && run.length <= 19) {
      if (startsLikeCard(run) && passesLuhn(run)) return true;
      continue;
    }
    if (run.length !== 4) continue;
    // Groups of four after this one, each behind a single space or hyphen.
    let digits = run;
    let at = start.index + 4;
    for (;;) {
      const next = /^[ -](\d{1,4})(?!\d)/.exec(normalized.slice(at, at + 6));
      if (!next) break;
      digits += next[1];
      at += next[0].length;
      if (digits.length > 19) break;
      if (
        digits.length >= shortest &&
        startsLikeCard(digits) &&
        passesLuhn(digits)
      ) {
        return true;
      }
      if (next[1]!.length < 4) break;
    }
  }
  return false;
}

/** Card networks' leading digits: Mir 2200–2204, Mastercard 2221–2720,
 *  Amex/Diners/JCB 3, Visa 4, Mastercard 5, Discover/UnionPay 6, RuPay
 *  81/82. */
function startsLikeCard(digits: string): boolean {
  if (digits[0]! >= "3" && digits[0]! <= "6") return true;
  if (digits.startsWith("81") || digits.startsWith("82")) return true;
  const prefix = Number(digits.slice(0, 4));
  return (
    (prefix >= 2200 && prefix <= 2204) || (prefix >= 2221 && prefix <= 2720)
  );
}

function passesLuhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let digit = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}
