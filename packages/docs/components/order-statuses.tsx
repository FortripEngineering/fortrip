import { ORDER_STATUSES, PAYMENT_STATUSES } from "@fortrip/agent-contract";

import { ORDER_STATUS_DOCS, PAYMENT_STATUS_DOCS } from "@/lib/prose/order-statuses.ts";
import { inline } from "@/lib/reference/field-table.tsx";

import { Table } from "./reference.tsx";

function StatusTable<S extends string>({ statuses, docs }: { statuses: readonly S[]; docs: Record<S, string> }) {
  return (
    <Table head={["Status", "Meaning"]}>
      {statuses.map((status) => (
        <tr key={status}>
          <td>
            <code>{status}</code>
          </td>
          <td>{inline(docs[status])}</td>
        </tr>
      ))}
    </Table>
  );
}

/** The order's `status`, each with what it means, in the contract's order. */
export function OrderStatuses() {
  return <StatusTable statuses={ORDER_STATUSES} docs={ORDER_STATUS_DOCS} />;
}

/** The order's `payment.status`, each with what it means, in the contract's order. */
export function PaymentStatuses() {
  return <StatusTable statuses={PAYMENT_STATUSES} docs={PAYMENT_STATUS_DOCS} />;
}
