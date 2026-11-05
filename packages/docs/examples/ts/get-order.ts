// Read an order, and print the link to pay it (payment_link) when it awaits payment.
// Needs FORTRIP_TOKEN, a Fortrip access token (see device-login).
import process from "node:process";

const token = process.env.FORTRIP_TOKEN;
if (!token) throw new Error("Set FORTRIP_TOKEN to a Fortrip access token");

const response = await fetch("https://api.fortrip.ai/v1/orders/ord_Wr4tY7uI0oPa3SdF6gHj", {
  method: "GET",
  headers: {
    Authorization: `Bearer ${token}`,
  },
  signal: AbortSignal.timeout(60_000),
});
if (!response.ok) {
  console.error(response.status, await response.text());
  process.exit(1);
}
const order = await response.json();
if (!order.payment?.url) {
  console.error("The order has no payment link: it is not awaiting payment, or read it again.");
  process.exit(1);
}
console.log(order.payment.url);
