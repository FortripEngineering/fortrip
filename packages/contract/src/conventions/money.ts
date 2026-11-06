import { z } from "zod";

import { CURRENCIES } from "../limits.ts";

/*
 * Money is `{ amount: "132.40", currency: "USD" }`: a decimal string (never a
 * number) and an uppercase ISO 4217 code. A response Money is open (extra
 * fields pass); a request Money is strict and in USD or CNY, except one that
 * echoes a returned Money, which is checked as a response Money.
 */

export type Money = { amount: string; currency: string };

const amountError = "amount must be a decimal string such as 132.40";
const currencyError = "currency must be a 3-letter uppercase ISO 4217 code";

export const money: z.ZodType<Money> = z.looseObject({
  amount: z.string({ error: amountError }).regex(/^\d+(\.\d+)?$/, {
    error: amountError,
  }),
  currency: z.string({ error: currencyError }).regex(/^[A-Z]{3}$/, {
    error: currencyError,
  }),
});

/**
 * A Money a caller sends: USD or CNY, no unknown fields. `name` is the field
 * it is the value of, which the refusal names.
 */
export function requestMoney(name: string): z.ZodType<Money> {
  return z.strictObject(
    {
      amount: z
        .string({ error: amountError })
        .regex(/^\d+(\.\d+)?$/, { error: amountError })
        .describe("Decimal string such as 132.40, never a number."),
      currency: z
        .enum(CURRENCIES, { error: "currency must be USD or CNY" })
        .describe("USD or CNY."),
    },
    {
      error: (issue) =>
        issue.code === "unrecognized_keys"
          ? `Unknown field(s): ${issue.keys.join(", ")}`
          : `${name} must be Money: { amount: "132.40", currency: "USD" or "CNY" }`,
    },
  );
}

/**
 * A Money a caller sends back exactly as it was returned: checked as a
 * response Money, so in any currency. `name` is the field it is the value
 * of, which the refusal names.
 */
export function echoedMoney(name: string): z.ZodType<Money> {
  return z.looseObject(
    {
      amount: z
        .string({ error: amountError })
        .regex(/^\d+(\.\d+)?$/, { error: amountError })
        .describe("Decimal string such as 132.40, never a number."),
      currency: z
        .string({ error: currencyError })
        .regex(/^[A-Z]{3}$/, { error: currencyError })
        .describe("3-letter uppercase ISO 4217 code, as returned."),
    },
    { error: `${name} must be Money as returned: { amount: "132.40", currency: "USD" }` },
  );
}

export function formatMoney(m: Money): string {
  return `${m.currency} ${m.amount}`;
}
