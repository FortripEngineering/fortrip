// Pay an order with a Stripe shared payment token.
// Needs FORTRIP_TOKEN, a Fortrip access token (see device-login).
import process from "node:process";

const token = process.env.FORTRIP_TOKEN;
if (!token) throw new Error("Set FORTRIP_TOKEN to a Fortrip access token");

const body = {
  "sharedPaymentToken": "spt_ExampleTokenFromTheUsersLinkWallet",
  "total": {
    "amount": "132.40",
    "currency": "USD"
  }
};

const response = await fetch("https://api.fortrip.ai/v1/orders/ord_Wr4tY7uI0oPa3SdF6gHj/pay", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(body),
});
const result = await response.json();
if (!response.ok) {
  console.error(result);
  process.exit(1);
}
console.log(JSON.stringify(result, null, 2));
