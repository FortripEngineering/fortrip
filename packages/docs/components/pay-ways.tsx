import { PAY_INPUT_WAYS, PAY_WAYS } from "@fortrip/agent-contract";
import { Heading } from "fumadocs-ui/components/heading";

import { PAY_WAY_DOCS } from "@/lib/prose/pay-ways.ts";
import { inline } from "@/lib/reference/field-table.tsx";

import { codeList } from "./reference.tsx";

/** The ways to pay an order, in the contract's order: a line each
 *  (`summary`), or a section each with when it applies, when it charges and
 *  how (`full`). */
export function PayWays({ variant }: { variant: "summary" | "full" }) {
  if (variant === "summary") {
    return (
      <ul>
        {PAY_WAYS.map((way) => (
          <li key={way}>
            <strong>{PAY_WAY_DOCS[way].title}</strong>: {inline(PAY_WAY_DOCS[way].charge)}
          </li>
        ))}
      </ul>
    );
  }
  return PAY_WAYS.map((way) => {
    const doc = PAY_WAY_DOCS[way];
    return (
      <section key={way}>
        <Heading as="h3" id={`pay-${way.replaceAll("_", "-")}`}>
          {doc.title}
        </Heading>
        <p>{inline(doc.when)}</p>
        <p>
          <strong>Charged:</strong> {inline(doc.charge)}
        </p>
        <p>{inline(doc.body)}</p>
      </section>
    );
  });
}

/** The fields of the pay input, one of which a call sends: "`sharedPaymentToken`, `payment` and `method`". */
export function PayInputs() {
  return codeList(Object.keys(PAY_INPUT_WAYS));
}
