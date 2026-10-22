import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { containsCardNumber } from "../src/card-number.ts";
import { addIsoDateDays } from "../src/dates.ts";

/** A deterministic stream of digits, so a sweep is the same on every run. */
function digits(seed: number) {
  let state = seed;
  return (count: number) => {
    let out = "";
    for (let i = 0; i < count; i++) {
      state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
      out += String(state % 10);
    }
    return out;
  };
}

/** A Chinese mobile number, 1[3-9]x xxxx xxxx. */
function chineseMobile(next: (count: number) => string, index: number) {
  const body = `1${3 + (index % 7)}${next(9)}`;
  return `${body.slice(0, 3)} ${body.slice(3, 7)} ${body.slice(7)}`;
}

/** An Indian mobile number, [6-9]xxxx xxxxx. */
function indianMobile(next: (count: number) => string, index: number) {
  const body = `${6 + (index % 4)}${next(9)}`;
  return `${body.slice(0, 5)} ${body.slice(5)}`;
}

function groupsOfFour(number: string, separator: string): string {
  return number.match(/.{1,4}/g)?.join(separator) ?? number;
}

describe("containsCardNumber", () => {
  it("finds a card in one run or in groups of four split by a space or a hyphen", () => {
    for (const text of [
      "4242424242424242",
      "4242 4242 4242 4242",
      "4242-4242-4242-4242",
      "4242 4242-4242 4242",
      "４２４２　４２４２　４２４２　４２４２",
      "378282246310005", // Amex in one run
      "4222222222222", // Visa, 13 digits
      "4222 2222 2222 2",
      "2223 0031 2200 3222", // Mastercard 2-series
      "2200 0000 0000 0004", // Mir
      "8171 9999 2766 0000", // RuPay 81
      "6011 1111 1111 1117", // Discover
      "card: 5555555555554444, exp 12/30",
      "4242 4242 4242 4242 12/30",
      // A number in front of the card doesn't hide it.
      "room 12 4111 1111 1111 1111 thanks",
      "2026 4111 1111 1111 1111",
      "+86 138 0013 8000 4242 4242 4242 4242",
      // Too many digits for a phone number, so + doesn't hide it either.
      "+4242424242424242",
      "+4242 4242 4242 4242",
      "call +4242-4242-4242-4242",
    ]) {
      assert.equal(containsCardNumber(text), true, text);
    }
  });

  it("misses, by design, the rarer ways of writing one", () => {
    for (const text of [
      "3782 822463 10005", // Amex 4-6-5
      "4242.4242.4242.4242",
      "4242/4242/4242/4242",
      "4242_4242_4242_4242",
      "4242  4242  4242  4242",
      "4242 - 4242 - 4242 - 4242",
      "4242\n4242\n4242\n4242",
    ]) {
      assert.equal(containsCardNumber(text), false, text);
    }
  });

  it("leaves Luhn-invalid and non-issuer numbers alone", () => {
    for (const text of [
      "4242424242424241", // fails Luhn
      "422222222222", // 12 digits
      "42424242424242424242", // 20 digits in one run
      "1234 5678 9012 3452", // passes Luhn, no network starts with 1
      "7992739871300", // passes Luhn, starts with 7
      "2000 0000 0000 0006", // passes Luhn, 2-series outside the ranges
      "8312 3456 7890 1237", // passes Luhn, 83 is not RuPay
    ]) {
      assert.equal(containsCardNumber(text), false, text);
    }
  });

  it("never flags a stay's dates", () => {
    let start = "2026-01-01";
    for (let day = 0; day < 731; day++) {
      for (let nights = 1; nights <= 15; nights++) {
        const end = addIsoDateDays(start, nights);
        for (const text of [
          `${start} ${end}`,
          `${start} to ${end}`,
          `${start}/${end}`,
          `${start.replaceAll("-", "")} ${end.replaceAll("-", "")}`,
        ]) {
          assert.equal(containsCardNumber(text), false, text);
        }
      }
      start = addIsoDateDays(start, 1);
    }
  });

  it("never flags Chinese or Indian mobile numbers, one or two at a time", () => {
    const next = digits(20_261_021);
    for (let i = 0; i < 2_000; i++) {
      const one = chineseMobile(next, i);
      const two = chineseMobile(next, i + 3);
      const india = indianMobile(next, i);
      const india2 = indianMobile(next, i + 1);
      for (const text of [
        `+86 ${one}`,
        `+86${one.replaceAll(" ", "")}`,
        `＋８６ ${one}`,
        `86 ${one}`,
        `${one} ${two}`,
        `${one}  ${two}`,
        `${one.replaceAll(" ", "")} ${two.replaceAll(" ", "")}`,
        `call ${one} or ${two}`,
        `+91 ${india}`,
        `${india} / ${india2}`,
        `${india} ${india2}`,
        `${india.replace(" ", "")}\n${india2.replace(" ", "")}`,
      ]) {
        assert.equal(containsCardNumber(text), false, text);
      }
    }
  });

  it("never flags an international number written after +", () => {
    const next = digits(4_930);
    for (let i = 0; i < 2_000; i++) {
      // +49 30 …, +44 20 …, +61 4 …: country codes that start like a card,
      // and 12 to 15 digits in all.
      const country = ["4930", "4420", "614", "5511", "3906"][i % 5]!;
      const number = `${country}${next(15 - country.length - (i % 4))}`;
      for (const text of [`+${number}`, `+${groupsOfFour(number, " ")}`]) {
        assert.equal(containsCardNumber(text), false, text);
      }
    }
  });

  it("never flags room or booking numbers listed with / or one per line", () => {
    const next = digits(3_442);
    for (let i = 0; i < 2_000; i++) {
      const rooms = [next(4), next(4), next(4), next(4)];
      for (const text of [
        rooms.join("/"),
        rooms.join(", "),
        rooms.join("\n"),
        rooms.join(" / "),
        `${next(8)}\n${next(8)}`,
      ]) {
        assert.equal(containsCardNumber(text), false, text);
      }
    }
  });

  it("never flags 13–19 digit references that start like no card", () => {
    const next = digits(42);
    for (let i = 0; i < 2_000; i++) {
      const lead = ["0", "1", "7", "9", "83"][i % 5];
      const text = `${lead}${next(12 + (i % 6))}`;
      assert.equal(containsCardNumber(text), false, text);
    }
  });

  it("finds generated cards of every network, joined or in groups of four", () => {
    const next = digits(7);
    const leads = ["4", "51", "2221", "2204", "34", "6011", "81", "35"];
    for (let i = 0; i < 2_000; i++) {
      const lead = leads[i % leads.length]!;
      const body = `${lead}${next(15 - lead.length)}`;
      const card = body + luhnCheckDigit(body);
      for (const text of [
        card,
        groupsOfFour(card, " "),
        groupsOfFour(card, "-"),
        `Room 12, card ${groupsOfFour(card, " ")}`,
      ]) {
        assert.equal(containsCardNumber(text), true, text);
      }
    }
  });

  it("with minDigits 16, still finds every card of 16 to 19 digits", () => {
    const next = digits(16);
    const leads = ["4", "51", "2221", "2204", "6011", "81", "35", "62"];
    for (let i = 0; i < 2_000; i++) {
      const lead = leads[i % leads.length]!;
      const length = 16 + (i % 4);
      const body = `${lead}${next(length - 1 - lead.length)}`;
      const card = body + luhnCheckDigit(body);
      for (const text of [
        card,
        groupsOfFour(card, " "),
        groupsOfFour(card, "-"),
        `+${card}`,
        `+${groupsOfFour(card, " ")}`,
      ]) {
        assert.equal(containsCardNumber(text, 16), true, text);
      }
    }
  });

  it("with minDigits 16, never flags a phone number, though 13 to 15 digits can look like a card", () => {
    const next = digits(15);
    const leads = ["62", "4930", "39", "5511", "6012", "3531", "81"];
    for (let i = 0; i < 2_000; i++) {
      // Country code and number without the +, built to pass the card check.
      const lead = leads[i % leads.length]!;
      const length = 13 + (i % 3);
      const body = `${lead}${next(length - 1 - lead.length)}`;
      const phone = body + luhnCheckDigit(body);
      assert.equal(containsCardNumber(phone), true, phone);
      for (const text of [
        phone,
        groupsOfFour(phone, " "),
        groupsOfFour(phone, "-"),
        `00${phone}`,
        `+${phone}`,
        `+${groupsOfFour(phone, " ")}`,
      ]) {
        assert.equal(containsCardNumber(text, 16), false, text);
      }
    }
  });
});

function luhnCheckDigit(body: string): string {
  for (let check = 0; check < 10; check++) {
    const candidate = body + check;
    let sum = 0;
    for (let i = 0; i < candidate.length; i++) {
      let digit = Number(candidate[candidate.length - 1 - i]);
      if (i % 2 === 1) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }
      sum += digit;
    }
    if (sum % 10 === 0) return String(check);
  }
  throw new Error("unreachable");
}
