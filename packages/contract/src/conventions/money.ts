import { z } from "zod";

/*
 * Money is `{ amount: "132.40", currency: "USD" }`: a decimal string (never a
 * number) and an uppercase ISO 4217 code. A response Money is open (extra
 * fields pass); a request Money is strict and must be USD.
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

/** A Money a caller sends: USD only, no unknown fields. */
export const usdMoney: z.ZodType<Money> = z.strictObject(
  {
    amount: z.string({ error: amountError }).regex(/^\d+(\.\d+)?$/, {
      error: amountError,
    }),
    currency: z.literal("USD", { error: "currency must be USD" }),
  },
  {
    error: (issue) =>
      issue.code === "unrecognized_keys"
        ? `Unknown field(s): ${issue.keys.join(", ")}`
        : "Expected a Money object",
  },
);

export function formatMoney(m: Money): string {
  return `${m.currency} ${m.amount}`;
}
