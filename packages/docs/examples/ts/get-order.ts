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
});
const order = await response.json();
if (!response.ok) {
  console.error(order);
  process.exit(1);
}
console.log(order.payment.url);
